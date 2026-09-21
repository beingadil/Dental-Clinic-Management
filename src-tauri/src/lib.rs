use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
#[cfg(windows)]
use winreg::enums::HKEY_CURRENT_USER;
#[cfg(windows)]
use winreg::RegKey;

/// The single real SQLite database file used by the desktop build.
/// The web engine (sql.js) exports/imports these exact bytes, so the
/// file format is identical between browser and desktop builds.
/// The Rust side intentionally does NOT hold an open connection — the
/// webview engine owns the data; here we only manage the file safely.
struct DbState {
    path: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
struct DbLoadResult {
    path: String,
    existed: bool,
}

#[derive(Serialize)]
struct SaveResult {
    path: String,
    bytes: usize,
}

/// Directory entries for the auto-backup rotation UI (name + modified time).
#[derive(Serialize)]
struct BackupFileInfo {
    name: String,
    modified: String,
}

/// Lists the automatic `.bak` rotation files next to the database.
#[tauri::command]
fn backup_list(state: State<DbState>) -> Result<Vec<BackupFileInfo>, String> {
    let path = {
        let path_lock = state.path.lock().unwrap();
        path_lock
            .as_ref()
            .ok_or_else(|| "database not loaded".to_string())?
            .clone()
    };
    let dir = path.parent().ok_or_else(|| "no parent dir".to_string())?;
    let prefix = format!(
        "{}.sqlite.",
        path.file_stem().and_then(|s| s.to_str()).unwrap_or("dental_solutions")
    );
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) && name.ends_with(".bak") {
                let modified = e
                    .metadata()
                    .and_then(|m| m.modified())
                    .map(|t| {
                        let secs = t
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        format!("{secs}")
                    })
                    .unwrap_or_default();
                out.push(BackupFileInfo { name, modified });
            }
        }
    }
    Ok(out)
}

/// Deletes one automatic backup file by name (rotation only).
#[tauri::command]
fn backup_delete(state: State<DbState>, name: String) -> Result<(), String> {
    let path = {
        let path_lock = state.path.lock().unwrap();
        path_lock
            .as_ref()
            .ok_or_else(|| "database not loaded".to_string())?
            .clone()
    };
    let dir = path.parent().ok_or_else(|| "no parent dir".to_string())?;
    // Refuse anything that isn't a plain .bak file name.
    if name.contains('\\') || name.contains('/') || name.contains("..") || !name.ends_with(".bak") {
        return Err("invalid backup file name".to_string());
    }
    fs::remove_file(dir.join(&name)).map_err(|e| format!("delete failed: {e}"))
}

fn resolve_db_path(app: &AppHandle, override_path: Option<String>) -> Result<PathBuf, String> {
    if let Some(p) = override_path {
        return Ok(PathBuf::from(p));
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create app data dir: {e}"))?;
    Ok(dir.join("dental_solutions.sqlite"))
}

/// Opens (creating if needed) the real SQLite file and remembers its path.
#[tauri::command]
fn db_load(
    app: AppHandle,
    state: State<DbState>,
    path: Option<String>,
) -> Result<DbLoadResult, String> {
    let db_path = resolve_db_path(&app, path)?;
    let existed = db_path.exists();
    // Validate + normalize the file (creates it if missing, enables FK),
    // then close: the sql.js engine in the webview owns all SQL work.
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("cannot open database file: {e}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    drop(conn);

    *state.path.lock().unwrap() = Some(db_path.clone());

    Ok(DbLoadResult {
        path: db_path.to_string_lossy().to_string(),
        existed,
    })
}

/// Returns the raw database file as base64 so the sql.js engine can load it.
#[tauri::command]
fn db_read_bytes(state: State<DbState>) -> Result<String, String> {
    let path_lock = state.path.lock().unwrap();
    let path = path_lock
        .as_ref()
        .ok_or_else(|| "database not loaded".to_string())?;
    let bytes = fs::read(path).map_err(|e| format!("cannot read database file: {e}"))?;
    Ok(base64_encode(&bytes))
}

/// Durably writes engine bytes to the real file (atomic tmp + replace + fsync).
#[tauri::command]
fn db_save_bytes(state: State<DbState>, bytes_b64: String) -> Result<SaveResult, String> {
    let path = {
        let path_lock = state.path.lock().unwrap();
        path_lock
            .as_ref()
            .ok_or_else(|| "database not loaded".to_string())?
            .clone()
    };

    let bytes = base64_decode(&bytes_b64)?;
    let tmp = path.with_extension("sqlite.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("cannot create temp file: {e}"))?;
        f.write_all(&bytes)
            .map_err(|e| format!("cannot write temp file: {e}"))?;
        f.sync_all()
            .map_err(|e| format!("cannot flush temp file: {e}"))?;
    }
    // Atomic replace: rename over the live file — the DB never exists in a
    // half-written state (Windows rename uses MOVEFILE_REPLACE_EXISTING).
    // Fall back to remove+rename only if the filesystem refuses the overwrite
    // (e.g. an antivirus scanner briefly holding the target).
    if fs::rename(&tmp, &path).is_err() {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("cannot replace database file: {e}"))?;
        }
        fs::rename(&tmp, &path).map_err(|e| format!("cannot finalize database file: {e}"))?;
    }

    Ok(SaveResult {
        path: path.to_string_lossy().to_string(),
        bytes: bytes.len(),
    })
}

/// Copies the live database file to a timestamped backup next to it.
#[tauri::command]
fn db_backup_file(state: State<DbState>, dest: Option<String>) -> Result<String, String> {
    let path = {
        let path_lock = state.path.lock().unwrap();
        path_lock
            .as_ref()
            .ok_or_else(|| "database not loaded".to_string())?
            .clone()
    };

    let target = match dest {
        Some(d) => PathBuf::from(d),
        None => {
            let stamp = chrono_like_stamp();
            path.with_extension(format!("sqlite.{stamp}.bak"))
        }
    };
    fs::copy(&path, &target).map_err(|e| format!("backup copy failed: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

/// SHA-256 of any file — used to verify offline update packages and backups.
#[tauri::command]
fn file_sha256(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("cannot read file: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

/// Minimal local-time filename stamp (YYYYMMDD-HHMMSS) without a chrono dep.
fn chrono_like_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}{mo:02}{d:02}-{h:02}{m:02}{s:02}")
}

// ---- minimal base64 (std-only, avoids another dependency) ----
const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

fn base64_decode(text: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Result<u32, String> {
        match c {
            b'A'..=b'Z' => Ok((c - b'A') as u32),
            b'a'..=b'z' => Ok((c - b'a' + 26) as u32),
            b'0'..=b'9' => Ok((c - b'0' + 52) as u32),
            b'+' => Ok(62),
            b'/' => Ok(63),
            b'=' => Ok(0), // padding — ignored via the chunk-length logic below
            _ => Err("invalid base64".into()),
        }
    }
    let clean: Vec<u8> = text.bytes().filter(|b| !b" \n\r\t".contains(b)).collect();
    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    for chunk in clean.chunks(4) {
        if chunk.len() != 4 {
            return Err("invalid base64 length".into());
        }
        let n = (val(chunk[0])? << 18)
            | (val(chunk[1])? << 12)
            | (val(chunk[2])? << 6)
            | val(chunk[3])?;
        out.push((n >> 16) as u8);
        if chunk[2] != b'=' {
            out.push((n >> 8) as u8);
        }
        if chunk[3] != b'=' {
            out.push(n as u8);
        }
    }
    Ok(out)
}

/// Opens a URL in the user's default system browser. Used by the in-app
/// update flow so the new installer downloads outside the sandboxed webview.
/// Only https URLs on known-good hosts are allowed — this is not a general
/// file/URL launcher.
#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    const ALLOWED_HOSTS: [&str; 3] = [
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    ];
    if !url.starts_with("https://") {
        return Err("Only https URLs can be opened".into());
    }
    let host = url
        .trim_start_matches("https://")
        .split(&['/', '?', ':'][..])
        .next()
        .unwrap_or("")
        .to_lowercase();
    if !ALLOWED_HOSTS.contains(&host.as_str()) {
        return Err(format!("URL host is not allowed: {host}"));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

const TRUSTED_UPDATE_HOSTS: [&str; 3] = [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
];

fn is_trusted_download_url(raw: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw) else { return false };
    if url.scheme() != "https" {
        return false;
    }
    match url.host_str() {
        Some(h) => TRUSTED_UPDATE_HOSTS.contains(&h.to_ascii_lowercase().as_str()),
        None => false,
    }
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.text().await.map_err(|e| format!("read failed: {e}"))
}

/// The expected checksum must be confirmed by the release's published
/// SHA256SUMS.txt: when the manifest provides one, both sources have to agree
/// exactly; the sums file is the authority either way. Any absence,
/// unparsable entry, or disagreement fails closed — no install, ever.
async fn resolve_expected_checksum(
    client: &reqwest::Client,
    version: &str,
    provided: Option<&str>,
) -> Result<String, String> {
    if let Some(c) = provided {
        if !(c.len() == 7 + 64 && c.starts_with("sha256:")) {
            return Err("Provided update checksum is malformed — refusing to install.".into());
        }
    }
    let sums_url = format!(
        "https://github.com/beingadil/Dental-Clinic-Management/releases/download/v{version}/SHA256SUMS.txt"
    );
    let text = fetch_text(client, &sums_url).await.map_err(|_| {
        "Checksum file (SHA256SUMS.txt) is unavailable for this release — refusing to auto-install."
            .to_string()
    })?;
    let mut sums_hash: Option<String> = None;
    for line in text.lines() {
        if !line.to_ascii_lowercase().contains("-setup.exe") {
            continue;
        }
        let hash = line.trim().split_whitespace().next().unwrap_or("");
        if hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            sums_hash = Some(hash.to_ascii_lowercase());
            break;
        }
    }
    let sums = sums_hash.ok_or_else(|| {
        "Checksum file has no installer entry — refusing to auto-install.".to_string()
    })?;
    if let Some(c) = provided {
        let provided_hex = c[7..].to_ascii_lowercase();
        if provided_hex != sums {
            return Err(format!(
                "Manifest checksum ({}) and release checksum file ({}) disagree — update aborted.",
                &provided_hex[..12],
                &sums[..12]
            ));
        }
    }
    Ok(sums)
}

#[derive(Clone, Serialize)]
struct UpdateProgress {
    version: String,
    received: u64,
    total: u64,
}

/// Downloads and installs an update entirely on the native side:
///
/// 1. streams the installer from a trusted GitHub release host to a temp file,
///    emitting `update://progress` events (the release-asset CDN sends no CORS
///    headers, so this must NOT run in the webview; it also keeps multi-MB
///    payloads out of it),
/// 2. verifies SHA-256 while streaming — fail closed, nothing executes on a
///    missing or mismatched checksum,
/// 3. takes a safety backup of the live database,
/// 4. launches the NSIS installer silently and exits so it can replace files.
#[tauri::command]
async fn update_install(
    app: AppHandle,
    state: State<'_, DbState>,
    version: String,
    download_url: Option<String>,
    expected_checksum: Option<String>,
) -> Result<bool, String> {
    // The version lands in the staged filename — never allow path characters.
    let version_ok = version.len() <= 32
        && version
            .split('.')
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
    if !version_ok {
        return Err("Refusing to install: invalid version string".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let url = download_url
        .filter(|u| is_trusted_download_url(u))
        .ok_or_else(|| "Update source is not a trusted release host — refusing to download.".to_string())?;

    let expected = resolve_expected_checksum(&client, &version, expected_checksum.as_deref()).await?;

    // Stream to a temp file, hashing as we go.
    let dir = std::env::temp_dir().join("dental-solutions-update");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let staged = dir.join(format!("Dental.Solutions_{}_x64-setup.exe", version));

    let mut res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Download failed (HTTP {}) for a trusted host", res.status()));
    }
    let total = res.content_length().unwrap_or(0);

    let mut file = fs::File::create(&staged).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let _ = app.emit("update://progress", UpdateProgress { version: version.clone(), received, total });
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("Download interrupted: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("cannot write staged update: {e}"))?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        // Throttle IPC traffic — the pill only needs a few updates per second.
        if last_emit.elapsed() >= std::time::Duration::from_millis(250) {
            last_emit = std::time::Instant::now();
            let _ = app.emit(
                "update://progress",
                UpdateProgress { version: version.clone(), received, total },
            );
        }
    }
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);

    // Verify BEFORE executing anything.
    if received == 0 {
        let _ = fs::remove_file(&staged);
        return Err("Downloaded installer is empty — update aborted.".into());
    }
    let actual = hex::encode(hasher.finalize());
    if actual != expected {
        let _ = fs::remove_file(&staged);
        return Err(format!(
            "Checksum mismatch (expected {}, got {}) — update aborted, nothing was installed.",
            &expected[..12],
            &actual[..12]
        ));
    }

    // Refuse to auto-install over a database save that never reached disk.
    if state.path.lock().unwrap().is_none() {
        return Err("Database not loaded — refusing to update now; try again after the app has saved its data.".into());
    }

    // Take a safety backup of the live database before the installer runs,
    // so a failed NSIS run can never take clinic data with it.
    let db_path = state.path.lock().unwrap().clone().unwrap();
    let backup = db_path.with_extension(format!(
        "sqlite.pre-update-{}-{}.bak",
        version,
        chrono_like_stamp()
    ));
    if let Err(e) = fs::copy(&db_path, &backup) {
        return Err(format!("Could not back up the database before updating: {e}"));
    }

    let _ = fs::write(
        dir.join("last-update.log"),
        format!(
            "{}: verified {} ({} bytes) — installing\n",
            version,
            &actual[..12],
            received
        ),
    );

    // Launch the silent NSIS install via a detached waiter script. NSIS
    // cannot replace the files of a running app, so the ordering matters:
    // the waiter waits for THIS process to exit, then runs the installer
    // (no file locks), waits for it to finish, and relaunches the app from
    // its install location on the new version. CREATE_NEW_PROCESS_GROUP
    // detaches the waiter from our console/job so it outlives our exit;
    // CREATE_NO_WINDOW keeps it invisible.
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("cannot resolve app executable for relaunch: {e}"))?;
    // Relaunch the INSTALLED exe, not necessarily the one that is running:
    // when the updater is triggered from a dev build or a portable copy,
    // current_exe points outside the install dir and the freshly installed
    // files would never be launched. The NSIS uninstall registry
    // (HKCU, per-user install) holds the authoritative InstallLocation.
    let reg = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Dental Solutions")
        .ok()
        .and_then(|k| k.get_value::<String, _>("InstallLocation").ok());
    let exe_name = current_exe
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "dental-solutions.exe".into());
    let relaunch_target = reg
        .map(|dir| PathBuf::from(dir).join(&exe_name))
        .filter(|p| p.exists())
        .unwrap_or(current_exe);
    let script = format!(
        "Wait-Process -Id {} -ErrorAction SilentlyContinue; $p = Start-Process -FilePath '{}' -ArgumentList '/S' -PassThru -WindowStyle Hidden; Wait-Process -Id $p.Id; Start-Sleep -Milliseconds 800; Start-Process -FilePath '{}'",
        std::process::id(),
        staged.display(),
        relaunch_target.display()
    );
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
        .creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Could not start the installer: {e}"))?;
    std::thread::sleep(std::time::Duration::from_millis(300));
    app.exit(0);
    // Unreachable in practice — exit(0) tears down the runtime before the
    // response resolves.
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DbState {
            path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            db_load,
            db_read_bytes,
            db_save_bytes,
            db_backup_file,
            backup_list,
            backup_delete,
            file_sha256,
            open_external,
            update_install
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
