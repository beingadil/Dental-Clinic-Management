//! Native file export for the desktop shell.
//!
//! Why this exists: the web build can hand a file to the user with a Blob URL
//! and a synthetic `<a download>` click. The Tauri shell cannot — it routes the
//! WebView2 download event to a Rust-side save dialog, and until this command
//! the app registered no handler for it. Every "download" in the app therefore
//! produced no file *and no error* on desktop: the job slip HTML, every CSV
//! export, the PDF export and the database backup.
//!
//! The path itself is chosen by the frontend through the dialog plugin's
//! `save()` (already permitted by `dialog:default`, which grants `allow-save`),
//! matching how `saveAsPdf` already works. That dialog filter is a UX
//! convenience, NOT a security boundary — the webview can pass any path, so
//! this command enforces its own boundary instead: an extension allowlist
//! (a compromised webview can no longer drop `.exe`/`.bat`/`.ps1`/`.dll` or a
//! startup-folder payload) plus refusal to write over a directory.
//!
//! A directory cannot be enforced — the user picks where exports land, and
//! confining that would break the feature. Remote-code-execution classes of
//! attack are closed by the extension gate; the remaining risk (overwriting a
//! `.csv`/`.pdf` the user already had) is the same trust we place in the
//! Save As dialog itself, and is accepted deliberately.
//!
//! Write is temp-file + rename, like `db_save_bytes`: a half-written export
//! that looks complete is worse than a failed one, and Windows `rename` over an
//! existing file uses MOVEFILE_REPLACE_EXISTING. The remove+retry covers an
//! antivirus scanner or Excel holding the target open.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde::Serialize;

#[derive(Serialize)]
pub struct ExportResult {
    pub path: String,
    pub bytes: usize,
}

/// Extensions the app exports, lower-cased, without the dot. Enforced here
/// because the dialog's filter is UX-only — the webview can pass any path.
/// Every entry is a deliberate permission: adding one is a decision to let a
/// compromised webview write that file type anywhere the user can.
const ALLOWED_EXPORT_EXTENSIONS: [&str; 8] = [
    "csv",
    "xlsx",
    "pdf",
    "html",
    "sql",
    "dentalbackup",
    "json",
    "txt",
];

/// Extension (lower-cased, without dot) of the file name portion of `path`,
/// or None when the name has no usable extension.
fn export_extension(path: &std::path::Path) -> Option<String> {
    path.file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| n.rsplit('.').next().map(|e| e.to_ascii_lowercase()))
}

/// Write `bytes_b64` to `path`, which the frontend obtained from the native
/// save dialog. Returns the path written and the byte count.
#[tauri::command]
pub fn save_file_bytes(path: String, bytes_b64: String) -> Result<ExportResult, String> {
    let bytes = base64_decode(&bytes_b64)?;
    let target = PathBuf::from(&path);

    let ext = export_extension(&target).ok_or_else(|| {
        "Refusing to write a file without a recognised extension — choose a destination ending in .csv, .xlsx, .pdf, .html, .sql, .json, .txt or .dentalbackup.".to_string()
    })?;
    if !ALLOWED_EXPORT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "Refusing to write a .{ext} file — this export type is not supported by the app."
        ));
    }
    if target.is_dir() {
        return Err("Refusing to overwrite a directory.".into());
    }

    let tmp = target.with_extension("dsexport.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("cannot create temp file: {e}"))?;
        f.write_all(&bytes)
            .map_err(|e| format!("cannot write temp file: {e}"))?;
        f.sync_all()
            .map_err(|e| format!("cannot flush temp file: {e}"))?;
    }

    if fs::rename(&tmp, &target).is_err() {
        // Target is locked or the filesystem refused the replace; retry once
        // after clearing the way. Never leave the temp file behind.
        let _ = fs::remove_file(&target);
        if let Err(e) = fs::rename(&tmp, &target) {
            let _ = fs::remove_file(&tmp);
            return Err(format!("cannot write export: {e}"));
        }
    }

    Ok(ExportResult {
        path: target.to_string_lossy().to_string(),
        bytes: bytes.len(),
    })
}

/// Decode standard base64 (whitespace tolerated) into bytes.
///
/// The frontend base64-encodes with `btoa`, so the alphabet is standard and
/// padding is always present.
fn base64_decode(text: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Result<u32, String> {
        match c {
            b'A'..=b'Z' => Ok((c - b'A') as u32),
            b'a'..=b'z' => Ok((c - b'a' + 26) as u32),
            b'0'..=b'9' => Ok((c - b'0' + 52) as u32),
            b'+' => Ok(62),
            b'/' => Ok(63),
            b'=' => Ok(0),
            _ => Err("invalid base64".into()),
        }
    }
    let clean: Vec<u8> = text.bytes().filter(|b| !b" \n\r\t".contains(b)).collect();
    if clean.len() % 4 != 0 {
        return Err("invalid base64 length".into());
    }
    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    for chunk in clean.chunks(4) {
        let n = (val(chunk[0])? << 18) | (val(chunk[1])? << 12) | (val(chunk[2])? << 6) | val(chunk[3])?;
        out.push((n >> 16) as u8);
        out.push((n >> 8) as u8);
        out.push(n as u8);
    }
    // Trim the padding tail to the true byte length.
    let pad = clean.iter().rev().take_while(|&&b| b == b'=').count();
    out.truncate(out.len() - pad);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_extension_gate_accepts_supported_types() {
        for (name, want) in [
            ("report.csv", true),
            ("statement.XLSX", true),
            ("job-slip.html", true),
            ("dental-db.dentalbackup", true),
            ("export.sql", true),
            ("invoice.pdf", true),
            ("notes.txt", true),
            ("data.json", true),
        ] {
            let p = std::path::PathBuf::from(name);
            let ext = export_extension(&p).unwrap();
            assert_eq!(ALLOWED_EXPORT_EXTENSIONS.contains(&ext.as_str()), want, "{name}");
        }
    }

    #[test]
    fn export_extension_gate_rejects_executables_and_shell_files() {
        for name in [
            "payload.exe",
            "script.bat",
            "run.ps1",
            "lib.dll",
            "macro.xlsm", // xlsx yes, macro-enabled no — exports never produce it
            "evil.msi",
            "no-extension",
            "", // empty path
        ] {
            let p = std::path::PathBuf::from(name);
            let allowed = export_extension(&p)
                .map(|e| ALLOWED_EXPORT_EXTENSIONS.contains(&e.as_str()))
                .unwrap_or(false);
            assert!(!allowed, "{name} must not be writable as an export");
        }
    }

    #[test]
    fn decodes_plain_base64() {
        // "Dental Solutions" -> base64
        let got = base64_decode("RGVudGFsIFNvbHV0aW9ucw==").unwrap();
        assert_eq!(got, b"Dental Solutions");
    }

    #[test]
    fn accepts_a_full_unpadded_block() {
        // "Dental" is exactly 8 base64 chars, no padding — must decode to 6 bytes.
        assert_eq!(base64_decode("RGVudGFs").unwrap(), b"Dental");
    }

    #[test]
    fn tolerates_whitespace_from_wrapped_payloads() {
        let got = base64_decode("RGVudGFs\nIFNvbHV0\r\n aW9ucw==").unwrap();
        assert_eq!(got, b"Dental Solutions");
    }

    #[test]
    fn rejects_bad_length_and_alphabet() {
        assert!(base64_decode("RGVudGF").is_err()); // 7 chars, not a multiple of 4
        assert!(base64_decode("!!!!").is_err()); // outside the alphabet
    }

    #[test]
    fn decodes_single_padding_byte_correctly() {
        // "a" -> "YQ==" must yield exactly one byte, not three.
        assert_eq!(base64_decode("YQ==").unwrap(), b"a");
        // "ab" -> "YWI="
        assert_eq!(base64_decode("YWI=").unwrap(), b"ab");
    }
}