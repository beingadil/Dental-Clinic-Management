//! Save-as-PDF for the app's print modals — Windows only, no native dependency.
//!
//! The desktop app hosts its UI in WebView2. CoreWebView2_16 exposes
//! `PrintToPdfStream`, which renders the current document — including the
//! active `@media print` layout — into an in-memory PDF stream. One command
//! therefore serves every print surface: what the browser print dialog would
//! produce is what lands in the user's chosen file. Page margins come from
//! the shared print CSS (`printStyles.css` / `index.css` `@page` rules).
//!
//! Threading: WebView2 objects have thread affinity to the main STA where
//! the controller was created. The flow therefore runs entirely on the main
//! thread inside `Webview::with_webview`'s closure, and
//! `PrintToPdfStreamCompletedHandler::wait_for_async_operation` pumps the
//! Windows message loop while waiting for the async print. The tauri command
//! thread blocks on a channel with a 30 s timeout.

use std::sync::mpsc;
use std::time::Duration;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2_16, ICoreWebView2Environment6, ICoreWebView2PrintSettings,
    COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
};
use webview2_com::PrintToPdfStreamCompletedHandler;
use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
use windows::Win32::System::Com::{IStream, STGM_CREATE, STGM_WRITE};
use windows_core::{Error as WinError, HRESULT, Interface as _, PCWSTR};

const SAVE_TIMEOUT: Duration = Duration::from_secs(30);

/// A4 in inches — WebView2's default paper otherwise follows the (absent)
/// default printer, which can yield Letter. The app's documents are A4.
const A4_WIDTH_IN: f64 = 8.27;
const A4_HEIGHT_IN: f64 = 11.69;

const E_FAIL: HRESULT = HRESULT(-2147467259i32); // 0x80004005

/// Blocking `PrintToPdfStream` for the given platform handles. Must run on
/// the main thread (the closure of `with_webview` guarantees that).
fn print_to_pdf_blocking(
    controller: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    environment: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment,
    pdf_path: String,
) -> Result<(), String> {
    unsafe {
        let webview: ICoreWebView2 = controller
            .CoreWebView2()
            .map_err(|e| format!("CoreWebView2: {e}"))?;

        let print_api: ICoreWebView2_16 = webview
            .cast()
            .map_err(|_| {
                "WebView2 runtime is too old for Save-as-PDF (CoreWebView2_16 missing)".to_string()
            })?;

        let env6: ICoreWebView2Environment6 = environment
            .cast()
            .map_err(|_| {
                "WebView2 runtime is too old for print settings (Environment6 missing)".to_string()
            })?;
        let settings: ICoreWebView2PrintSettings = env6
            .CreatePrintSettings()
            .map_err(|e| format!("CreatePrintSettings: {e}"))?;

        settings
            .SetPageWidth(A4_WIDTH_IN)
            .map_err(|e| format!("page width: {e}"))?;
        settings
            .SetPageHeight(A4_HEIGHT_IN)
            .map_err(|e| format!("page height: {e}"))?;
        settings
            .SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)
            .map_err(|e| format!("orientation: {e}"))?;
        settings
            .SetScaleFactor(1.0)
            .map_err(|e| format!("scale: {e}"))?;
        settings
            .SetShouldPrintBackgrounds(true)
            .map_err(|e| format!("backgrounds: {e}"))?;
        settings
            .SetShouldPrintHeaderAndFooter(false)
            .map_err(|e| format!("header/footer: {e}"))?;

        let _unused_stream: IStream =
            CreateStreamOnHGlobal(HGLOBAL(std::ptr::null_mut()), true)
                .map_err(|e| format!("stream: {e}"))?;

        let print_api = print_api.clone();
        let settings = settings.clone();
        let target_path = pdf_path.clone();
        PrintToPdfStreamCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| {
                print_api
                    .PrintToPdfStream(&settings, &handler)
                    .map_err(|e| webview2_com::Error::WindowsError(e.into()))
            }),
            Box::new(move |hr, out_stream: Option<IStream>| {
                hr?;
                let out = out_stream.ok_or_else(|| WinError::from_hresult(E_FAIL))?;
                copy_stream_to_file(&out, &target_path)
            }),
        )
        .map_err(|e| format!("PrintToPdfStream: {e}"))?;
    }
    Ok(())
}

/// Copy the whole PDF stream into `path` via a Win32 file stream.
unsafe fn copy_stream_to_file(src: &IStream, path: &str) -> windows_core::Result<()> {
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();

    // CREATEFILE2_* option flags live in Win32::Storage::FileSystem, which we
    // deliberately do not pull in; SHCreateStreamOnFileEx's grfmode (STGM)
    // plus FILE_ATTRIBUTE_NORMAL (0x80) are all we need.
    let file_stream: IStream = windows::Win32::UI::Shell::SHCreateStreamOnFileEx(
        PCWSTR::from_raw(wide.as_ptr()),
        (STGM_CREATE | STGM_WRITE).0,
        0x80, // FILE_ATTRIBUTE_NORMAL
        true,
        None,
    )?;

    const CHUNK: usize = 256 * 1024;
    let mut buf = vec![0u8; CHUNK];
    loop {
        let mut read: u32 = 0;
        src.Read(buf.as_mut_ptr().cast(), CHUNK as u32, Some(&mut read))
            .ok()?;
        if read == 0 {
            break;
        }
        let mut written: u32 = 0;
        file_stream
            .Write(buf.as_ptr().cast(), read, Some(&mut written))
            .ok()?;
        if written != read {
            return Err(WinError::from_hresult(E_FAIL));
        }
    }
    Ok(())
}

/// Tauri command: the file dialog runs on the JS side (dialog plugin); this
/// receives the chosen absolute path and renders the CURRENT document —
/// the open print modal — into it.
#[tauri::command]
pub fn save_webview_as_pdf(
    webview: tauri::Webview<tauri::Wry>,
    path: String,
) -> Result<String, String> {
    if !path.to_ascii_lowercase().ends_with(".pdf") {
        return Err("File name must end with .pdf".into());
    }

    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let pdf_path = path.clone();

    webview
        .with_webview(move |platform| {
            let result = print_to_pdf_blocking(
                platform.controller(),
                platform.environment(),
                pdf_path,
            );
            let _ = tx.send(result);
        })
        .map_err(|e| format!("cannot access webview: {e}"))?;

    match rx.recv_timeout(SAVE_TIMEOUT) {
        Ok(Ok(())) => Ok(path),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("Saving the PDF timed out".into()),
    }
}


