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
pub mod pdf_save;
pub mod file_export;
mod app_patch;
pub use app_patch::apply_app_patch;
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

/// Resolves the one database file this app is allowed to touch.
///
/// There is deliberately no caller-supplied override. `Connection::open`
/// CREATES a missing file, so a `path` argument was an arbitrary-file-write
/// primitive handed to the webview, and nothing in `src/` ever passed one —
/// `loadSnapshot` calls `db_load({})` and the restore flow reads the chosen
/// `.dentalbackup` through the webview file input and writes the bytes back
/// through `db_save_bytes`, which still targets this same path. Restoring a
/// backup therefore never needed a path override, and re-introducing one
/// would only widen the attack surface.
fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create app data dir: {e}"))?;
    Ok(dir.join("dental_solutions.sqlite"))
}

/// Opens (creating if needed) the real SQLite file and remembers its path.
#[tauri::command]
fn db_load(app: AppHandle, state: State<DbState>) -> Result<DbLoadResult, String> {
    let db_path = resolve_db_path(&app)?;
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
    // Write to the temp file first, cleaning it up on ANY error so a
    // half-written .tmp never lingers in the app data directory.
    {
        let mut f = fs::File::create(&tmp).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("cannot create temp file: {e}")
        })?;
        if let Err(e) = f.write_all(&bytes) {
            let _ = fs::remove_file(&tmp);
            return Err(format!("cannot write temp file: {e}"));
        }
        if let Err(e) = f.sync_all() {
            let _ = fs::remove_file(&tmp);
            return Err(format!("cannot flush temp file: {e}"));
        }
    }
    // Atomic replace: rename over the live file — the DB never exists in a
    // half-written state (Windows rename uses MOVEFILE_REPLACE_EXISTING).
    // Fall back to remove+rename only if the filesystem refuses the overwrite
    // (e.g. an antivirus scanner briefly holding the target). Note: between
    // remove_file and the second rename there is a brief window where the
    // database file does not exist; this fallback is only used when the
    // filesystem refuses an in-place rename.
    if fs::rename(&tmp, &path).is_err() {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("cannot replace database file: {e}"))?;
        }
        fs::rename(&tmp, &path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("cannot finalize database file: {e}")
        })?;
    }

    Ok(SaveResult {
        path: path.to_string_lossy().to_string(),
        bytes: bytes.len(),
    })
}

/// Copies the live database file to a timestamped backup next to it.
#[tauri::command]
fn db_backup_file(state: State<DbState>) -> Result<String, String> {
    let path = {
        let path_lock = state.path.lock().unwrap();
        path_lock
            .as_ref()
            .ok_or_else(|| "database not loaded".to_string())?
            .clone()
    };

    // The target is always beside the database, for the same reason
    // `resolve_db_path` takes no caller path: this used to accept a `dest`
    // that went straight into PathBuf, and `fs::copy` to an attacker-chosen
    // path overwrites whatever is there with the clinic's database. Nothing in
    // src/ ever passed one — the scheduler calls this bare, and BackupTab
    // exports through `save_file_bytes` with the native save dialog, which is
    // where a user-chosen destination belongs.
    let stamp = chrono_like_stamp();
    let target = path.with_extension(format!("sqlite.{stamp}.bak"));
    let tmp = path.with_extension(format!("sqlite.{stamp}.bak.tmp"));
    let bytes = fs::read(&path).map_err(|e| format!("backup copy failed: {e}"))?;
    {
        let mut f = fs::File::create(&tmp).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("backup copy failed: {e}")
        })?;
        f.write_all(&bytes)
            .map_err(|e| {
                let _ = fs::remove_file(&tmp);
                format!("backup copy failed: {e}")
            })?;
        f.sync_all()
            .map_err(|e| {
                let _ = fs::remove_file(&tmp);
                format!("backup copy failed: {e}")
            })?;
    }
    fs::rename(&tmp, &target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("backup copy failed: {e}")
    })?;
    Ok(target.to_string_lossy().to_string())
}

/// SHA-256 of a file inside an approved directory — used to verify offline
/// update packages and backup integrity. Restricted to the app's database
/// directory (backups live there) and the staged-update temp dir; an
/// unrestricted read-hash primitive would let a compromised webview probe
/// arbitrary files on disk.
#[tauri::command]
fn file_sha256(state: State<DbState>, path: String) -> Result<String, String> {
    let requested = PathBuf::from(&path);
    let mut allowed_dirs: Vec<PathBuf> = Vec::new();
    if let Some(db_path) = state.path.lock().unwrap().clone() {
        if let Some(dir) = db_path.parent() {
            allowed_dirs.push(dir.to_path_buf());
        }
    }
    allowed_dirs.push(std::env::temp_dir().join("dental-solutions-update"));

    let canonical = requested
        .canonicalize()
        .map_err(|e| format!("cannot resolve file: {e}"))?;
    let in_allowed = allowed_dirs.iter().any(|dir| {
        dir.canonicalize().ok().map(|c| canonical.starts_with(&c)).unwrap_or(false)
    });
    if !in_allowed {
        return Err("file_sha256: path is outside approved directories".into());
    }

    let bytes = fs::read(&canonical).map_err(|e| format!("cannot read file: {e}"))?;
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
    // Parse once, properly — string-splitting the authority lets
    // "https://github.com:@evil.example/" through with host "github.com".
    let Ok(parsed) = reqwest::Url::parse(&url) else {
        return Err("URL is not parseable".into());
    };
    if parsed.scheme() != "https" {
        return Err("Only https URLs can be opened".into());
    }
    let host = parsed
        .host_str()
        .map(|h| h.to_ascii_lowercase())
        .ok_or_else(|| format!("URL host is not allowed: {url}"))?;
    if !ALLOWED_HOSTS.contains(&host.as_str()) {
        return Err(format!("URL host is not allowed: {host}"));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Raw-githubhost names. Every entry here can be used to download — you'd
/// review any new host carefully.
const TRUSTED_UPDATE_HOSTS: [&str; 4] = [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    // gh-pages via the raw host is how `update-patch.json` and other metadata
    // live; the individual gh-pages branch cannot be fetched from here (Tauri
    // has no Pages URL knowledge), so the raw mirror is the canonical route.
    "raw.githubusercontent.com",
];

pub(crate) fn is_trusted_download_url(raw: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw) else { return false };
    if url.scheme() != "https" {
        return false;
    }
    match url.host_str() {
        Some(h) => TRUSTED_UPDATE_HOSTS.contains(&h.to_ascii_lowercase().as_str()),
        None => false,
    }
}

/// Fetch raw text — shared with app_patch (hot patches).
pub(crate) async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
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
/// Parses the installer entry out of a release's SHA256SUMS.txt. Extracted so
/// the parser is unit-testable offline (audit #26). First line containing
/// `-setup.exe` whose hash field is 64 hex chars wins; anything else is
/// ignored. Returns None when no such line exists.
fn parse_sums_installer_hash(text: &str) -> Option<String> {
    for line in text.lines() {
        if !line.to_ascii_lowercase().contains("-setup.exe") {
            continue;
        }
        let hash = line.trim().split_whitespace().next().unwrap_or("");
        if hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

/// Version strings land in the staged filename, so the staging gate rejects
/// anything but digits, dots and the filename-legal prerelease characters
/// (hyphen/dot/alphanumerics), capped at 32 bytes. The 'v' prefix is NOT
/// accepted here — CI stamps the manifest with the bare tag, so a v here is
/// always an error, not a variant to accommodate.
fn is_valid_version_string(version: &str) -> bool {
    if version.len() > 32 {
        return false;
    }
    let (core, pre) = match version.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (version, None),
    };
    let mut part_count = 0usize;
    for part in core.split('.') {
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
        part_count += 1;
    }
    if part_count == 0 {
        return false;
    }
    if let Some(p) = pre {
        if p.is_empty()
            || !p
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        {
            return false;
        }
    }
    true
}

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
    let sums = parse_sums_installer_hash(&text).ok_or_else(|| {
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
    /// Coarse lifecycle step: `downloading` | `verifying` | `backup` | `ready`.
    /// The webview installer UI renders this as a step list, so the user can see
    /// what the updater is doing instead of an opaque spinner.
    stage: String,
}

/// Emits one `update://progress` event. Failures are non-fatal by design — the
/// event is cosmetic UI, the update itself must not fail because of it.
fn emit_progress(app: &AppHandle, version: &str, received: u64, total: u64, stage: &str) {
    let _ = app.emit(
        "update://progress",
        UpdateProgress {
            version: version.to_string(),
            received,
            total,
            stage: stage.to_string(),
        },
    );
}

/// Reads and validates the stage receipt written by `update_install`.
fn read_stage_receipt() -> serde_json::Value {
    let dir = std::env::temp_dir().join("dental-solutions-update");
    fs::read_to_string(dir.join("stage-receipt.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(|r: &serde_json::Value| {
            r.get("magic").and_then(|m| m.as_str()) == Some(STAGE_RECEIPT_MAGIC)
        })
        .unwrap_or(serde_json::Value::Null)
}

/// SHA-256 of an already-staged installer file, hex-encoded.
fn hash_file(path: &std::path::Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hex::encode(hasher.finalize()))
}

/// The one directory the updater owns on disk. Everything the updater writes
/// (staged installer, receipt, log) lives here, and nowhere else.
fn staging_dir() -> PathBuf {
    std::env::temp_dir().join("dental-solutions-update")
}

/// Canonicalize `candidate` and require it to live inside the staging dir.
///
/// update_apply EXECUTES (and update_discard DELETES) a path that arrives via
/// a JSON file in %TEMP%. Without confinement, any process able to write that
/// file can name an arbitrary executable and the updater would run it. The
/// canonicalized prefix check closes the "different file, same receipt" path.
fn confined_staged_path(candidate: &str) -> Result<PathBuf, String> {
    let dir = staging_dir();
    let dir_canon = dir.canonicalize().unwrap_or_else(|_| dir.clone());
    let canonical = PathBuf::from(candidate)
        .canonicalize()
        .map_err(|e| format!("cannot resolve staged installer: {e}"))?;
    if !canonical.starts_with(&dir_canon) {
        return Err(
            "Staged installer is outside the update staging directory — refusing to use it."
                .into(),
        );
    }
    Ok(canonical)
}

/// Stages an update on the native side — it does NOT install and does NOT exit:
///
/// 1. streams the installer from a trusted GitHub release host to a temp file,
///    emitting `update://progress` events (the release-asset CDN sends no CORS
///    headers, so this must NOT run in the webview; it also keeps multi-MB
///    payloads out of it),
/// 2. verifies SHA-256 while streaming — fail closed, nothing is kept on a
///    missing or mismatched checksum,
/// 3. takes a safety backup of the live database,
/// 4. writes the stage receipt and returns the staged installer details.
///
/// Applying the update is a separate, explicit step (`update_apply`) so the app
/// only closes when the user asked for it — the updater must never decide to
/// quit a clinic's running application on its own.
#[tauri::command]
async fn update_install(
    app: AppHandle,
    state: State<'_, DbState>,
    version: String,
    download_url: Option<String>,
    expected_checksum: Option<String>,
) -> Result<serde_json::Value, String> {
    // The version lands in the staged filename — never allow path characters.
    if !is_valid_version_string(&version) {
        return Err("Refusing to install: invalid version string".into());
    }

    // 600s covers the installer with enormous headroom: the bundle is ~4 MB, so
    // even a 100 kbps link finishes in well under a minute. This used to be
    // raised to an hour, which was only needed when the installer briefly
    // embedded the WebView2 runtime (~210 MB) and demanded 2.81 Mbps to
    // finish inside the budget. That variant was reverted to keep the
    // installer small; the timeout went back with it.
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
    emit_progress(&app, &version, received, total, "downloading");
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
            emit_progress(&app, &version, received, total, "downloading");
        }
    }
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);

    emit_progress(&app, &version, received, total, "verifying");

    // Verify BEFORE keeping anything on disk.
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

    /* #13 — when this build enforces Authenticode (a signed release channel),
       the installer must also verify. Placed before the database backup so a
       rejected file leaves nothing behind. When AUTHENTICODE_REQUIRED is
       false (today), the update chain is protected by SHA256SUMS.txt alone. */
    if AUTHENTICODE_REQUIRED {
        if let Err(e) = verify_authenticode(&staged) {
            let _ = fs::remove_file(&staged);
            return Err(e);
        }
    }

    // Refuse to auto-install over a database save that never reached disk.
    if state.path.lock().unwrap().is_none() {
        return Err("Database not loaded — refusing to update now; try again after the app has saved its data.".into());
    }

// Take a safety backup of the live database before the installer runs,
    // so a failed NSIS run can never take clinic data with it.
    emit_progress(&app, &version, received, total, "backup");
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
            "{}: verified {} ({} bytes) — staged, waiting for restart approval\n",
            version,
            &actual[..12],
            received
        ),
    );

    let current_exe = std::env::current_exe()
        .map_err(|e| format!("cannot resolve app executable for relaunch: {e}"))?;
    let relaunch_target = installed_relaunch_target(&current_exe);

    // Machine-readable stage receipt — it is the boot-time source of truth for
    // "did the staged install land?" and the input `update_apply` reads to find
    // the staged installer. A silent write failure here is what produced the
    // false 'Install awaiting completion' banner (verified on this machine:
    // last-update.log exists, the receipt does not). Surface failures.
    let running_version = app.package_info().version.to_string();
    let receipt = build_stage_receipt(
        &version,
        &format!("sha256:{actual}"),
        received,
        &staged.display().to_string(),
        &relaunch_target.display().to_string(),
        &running_version,
    );
    let receipt_path = dir.join("stage-receipt.json");
    if let Err(e) = fs::write(&receipt_path, serde_json::to_string_pretty(&receipt).unwrap_or_default()) {
        // Returning here is the whole point: the UI must not offer "Restart &
        // Apply" for a staged update whose receipt does not exist — boot
        // would find no staged update and report failure, or worse, strand
        // the installer silently.
        return Err(format!(
            "Update staged but its receipt could not be written to {receipt_path:?}: {e}. Check that the temp directory is writable, then try again."
        ));
    }

    emit_progress(&app, &version, received, total, "ready");
    Ok(receipt)
}

/// Relaunch the INSTALLED exe, not necessarily the one that is running: when
/// the updater is triggered from a dev build or a portable copy, `current_exe`
/// points outside the install dir and the freshly installed files would never
/// be launched. The NSIS uninstall registry (HKCU, per-user install) holds the
/// authoritative InstallLocation.
#[cfg(windows)]
fn installed_relaunch_target(current_exe: &std::path::Path) -> PathBuf {
    let reg = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Dental Solutions")
        .ok()
        .and_then(|k| k.get_value::<String, _>("InstallLocation").ok());
    let exe_name = current_exe
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "dental-solutions.exe".into());
    reg.map(|dir| PathBuf::from(dir).join(&exe_name))
        .filter(|p| p.exists())
        .unwrap_or_else(|| current_exe.to_path_buf())
}

#[cfg(not(windows))]
fn installed_relaunch_target(current_exe: &std::path::Path) -> PathBuf {
    current_exe.to_path_buf()
}

/// App directory of the running install — the dir whose `dist/` is served to
/// the webview. Source of truth is the NSIS InstallLocation (the authoritative
/// dir the uninstaller knows); fallback is the running exe's dir (portable and
/// dev builds).
pub(crate) fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let reg = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Dental Solutions")
            .ok()
            .and_then(|k| k.get_value::<String, _>("InstallLocation").ok())
            .map(PathBuf::from)
            .filter(|dir| dir.is_dir());
        if let Some(dir) = reg {
            return Ok(dir);
        }
    }
    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot resolve app directory: {e}"))?;
    Ok(exe
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "cannot resolve app directory".to_string())?)
}

/// sha256 hex digest of `bytes` — used by hot-patch verification and tests.
pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Absolute path to Windows PowerShell, or `None` if it is not installed.
///
/// `Command::new("powershell")` looks the name up on the child's PATH. That
/// lookup is the whole reason the updater used to fail with "program not
/// found": a PATH that omits `%SystemRoot%\System32\WindowsPowerShell\v1.0`
/// (a trimmed service account, a sanitised launcher environment, a shell that
/// rewrote PATH) leaves nothing to resolve, and the update aborted with an
/// error that named the installer rather than the missing interpreter. The
/// installer's location is fixed by Windows, so resolve it directly.
#[cfg(windows)]
fn powershell_exe() -> Option<PathBuf> {
    let roots: Vec<PathBuf> = std::env::var("SystemRoot")
        .map(PathBuf::from)
        .into_iter()
        .chain(std::env::var("WINDIR").map(PathBuf::from))
        .chain([PathBuf::from(r"C:\Windows")])
        .collect();

    for root in roots {
        // The native view first, then the redirected one, so a 32-bit build
        // still finds PowerShell where WOW64 did not leave it.
        for base in [
            root.join("Sysnative").join("WindowsPowerShell").join("v1.0"),
            root.join("System32").join("WindowsPowerShell").join("v1.0"),
        ] {
            let candidate = base.join("powershell.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Escapes a path for embedding in a PowerShell single-quoted string literal.
/// A `'` in a path (legal on NTFS, and present in some user profile names)
/// would otherwise close the literal early and turn the waiter script into a
/// syntax error, reported to the operator as a failed install.
#[cfg(windows)]
fn ps_quote(path: &std::path::Path) -> String {
    path.display().to_string().replace('\'', "''")
}

/// Spawns a detached waiter that runs the silent NSIS installer AFTER this
/// process exits, then relaunches the app on the new version.
///
/// NSIS cannot replace the files of a running app, so the ordering matters:
/// the waiter waits for THIS process to exit, then runs the installer (no file
/// locks), waits for it to finish, and starts the app again.
/// CREATE_NEW_PROCESS_GROUP detaches the waiter from our console/job so it
/// outlives our exit; CREATE_NO_WINDOW keeps it invisible.
#[cfg(windows)]
fn spawn_install_waiter(staged: &std::path::Path, relaunch_target: &std::path::Path) -> Result<(), String> {
    let shell = powershell_exe().ok_or_else(|| {
        "Windows PowerShell was not found on this machine, so the update cannot be installed \
         automatically. Download the installer from the releases page and run it yourself."
            .to_string()
    })?;
    let script = format!(
        "Wait-Process -Id {} -ErrorAction SilentlyContinue; $p = Start-Process -FilePath '{}' -ArgumentList '/S /UPDATE' -PassThru -WindowStyle Hidden; Wait-Process -Id $p.Id; Start-Sleep -Milliseconds 800; Start-Process -FilePath '{}'",
        std::process::id(),
        ps_quote(staged),
        ps_quote(relaunch_target)
    );
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    Command::new(&shell)
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
        .creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| {
            format!(
                "Could not start the update helper ({}) : {e}. You can install this update by \
                 downloading the installer from the releases page instead.",
                shell.display()
            )
        })
}

#[cfg(not(windows))]
fn spawn_install_waiter(
    _staged: &std::path::Path,
    _relaunch_target: &std::path::Path,
) -> Result<(), String> {
    Err("Silent auto-install is only implemented on Windows.".into())
}

/// Whether this build refuses installers that are not Authenticode-signed.
///
/// Deliberately a compile-time CONSTANT, not a runtime/env toggle: enforcement
/// must be flipped in the same deliberate release that first signs the builds
/// (paired with the CI "Sign the NSIS installer" step, which activates when the
/// WINDOWS_PFX_BASE64/WINDOWS_PFX_PASSWORD repository secrets exist). Enabling
/// this before a signed release would brick every client's auto-update — that
/// is why signing activates with secrets and enforcement activates with this
/// one-line flip, both in a release that says so in the changelog. While false,
/// updates stay protected by the SHA256SUMS.txt chain exactly as before.
const AUTHENTICODE_REQUIRED: bool = false;

/// Verifies the Authenticode signature of `path` via PowerShell's
/// Get-AuthenticodeSignature — the same check an administrator would run by
/// hand. Fail closed: any error or any non-'Valid' status aborts the install.
/// Only used when AUTHENTICODE_REQUIRED is compiled in.
#[cfg(windows)]
fn verify_authenticode(path: &std::path::Path) -> Result<(), String> {
    let shell = powershell_exe().ok_or_else(|| {
        "Windows PowerShell was not found on this machine, so the installer signature cannot be verified."
            .to_string()
    })?;
    let script = format!(
        "$s = Get-AuthenticodeSignature -FilePath '{}'; if ($s.Status -eq 'Valid') {{ exit 0 }} else {{ Write-Output $s.Status.ToString(); exit 1 }}",
        ps_quote(path)
    );
    let out = Command::new(&shell)
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("Could not run the signature check: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let status = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Err(format!(
        "Installer signature check failed{} — refusing to install an unsigned or tampered installer.",
        if status.is_empty() { String::new() } else { format!(" ({status})") }
    ))
}

#[cfg(not(windows))]
fn verify_authenticode(_path: &std::path::Path) -> Result<(), String> {
    Err("Signature verification is only implemented on Windows.".into())
}

/// Applies a staged update and closes the app — the ONLY path that exits.
///
/// Called exclusively from the user's "Restart & Apply Updates" action: the
/// updater must never decide by itself to close a clinic's running app. The
/// staged file is confined to the staging directory and re-verified against
/// the release's published SHA256SUMS.txt — NOT against the hash stored in
/// the receipt, which is self-referential (the receipt would be trusted to
/// vouch for itself). Any absence or disagreement fails closed — no install,
/// ever, including offline.
#[tauri::command]
async fn update_apply(app: AppHandle) -> Result<bool, String> {
    let mut receipt = read_stage_receipt();

    // The version drives the SHA256SUMS.txt URL; validate it like the staging
    // path does before it goes anywhere near a request.
    let version = receipt
        .get("version")
        .and_then(|v| v.as_str())
        .filter(|v| is_valid_version_string(v))
        .ok_or_else(|| {
            "The stage receipt carries an invalid version — check for updates again.".to_string()
        })?
        .to_string();

    let staged_path = receipt
        .get("staged_path")
        .and_then(|p| p.as_str())
        .ok_or_else(|| "No staged update found — check for updates again.".to_string())?;
    let staged = confined_staged_path(staged_path)?;

    // The hash authority is the release's published SHA256SUMS.txt, fetched
    // over TLS from the trusted host — the same authority update_install
    // used. The receipt's checksum field is diagnostic only now.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let expected = resolve_expected_checksum(&client, &version, None)
        .await
        .map_err(|e| {
            format!(
                "Could not re-verify the staged installer against the release checksums: {e} \
                 If you are offline, reconnect and try again."
            )
        })?;

    let actual =
        hash_file(&staged).map_err(|e| format!("Could not re-verify the staged update: {e}"))?;
    if actual != expected {
        return Err(
            "The staged installer no longer matches the release checksum — update aborted, nothing was installed."
                .into(),
        );
    }
    // Re-derive the relaunch target instead of trusting the receipt: the
    // waiter launches this path after the installer runs, so a doctored
    // receipt must not be able to point it at an arbitrary executable.
    // installed_relaunch_target reads the NSIS registry entry with the
    // running exe as fallback — never a path from a JSON file.
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("cannot resolve app executable for relaunch: {e}"))?;
    let relaunch_target = installed_relaunch_target(&current_exe);

    // Launch the waiter BEFORE the marker: if the launch itself fails, the
    // receipt must not claim an apply was attempted when nothing was, or
    // every boot reports "update interrupted" forever. Spawning first makes
    // the failure honest and retryable from the UI.
    spawn_install_waiter(&staged, &relaunch_target)?;

    // Record that the installer was launched. If this process comes back on
    // the old version, diagnostics must report a failed apply instead of
    // offering the same installer again forever.
    let receipt_path = std::env::temp_dir()
        .join("dental-solutions-update")
        .join("stage-receipt.json");
    if let Some(obj) = receipt.as_object_mut() {
        obj.insert(
            "apply_requested_at".into(),
            serde_json::Value::String(chrono_like_stamp()),
        );
    }
    fs::write(
        &receipt_path,
        serde_json::to_string_pretty(&receipt).unwrap_or_default(),
    )
    .map_err(|e| format!("Installer was launched, but its receipt could not be updated: {e}"))?;

    // Let the invoke response (Ok) reach the webview first, then exit. A hard
    // app.exit(0) raced the IPC reply on the download path and left the UI
    // stuck mid-update. 1.5 s covers a local reply + the debounced DB flush;
    // the waiter script tolerates any delay anyway (it waits for our PID).
    std::thread::sleep(std::time::Duration::from_millis(1500));
    app.exit(0);
    // Unreachable in practice — exit(0) tears down the runtime before the
    // response resolves.
    Ok(true)
}

/// Deletes a staged (downloaded, verified, not yet applied) update. Backs the
/// "Not now" action on the installer panel — declining an update must not leave
/// a multi-MB installer on disk or a receipt that nags on every boot.
#[tauri::command]
fn update_discard() -> Result<bool, String> {
    let dir = staging_dir();
    let receipt = read_stage_receipt();
    if let Some(staged) = receipt.get("staged_path").and_then(|p| p.as_str()) {
        // Only files inside the staging directory may be deleted.
        if let Ok(canon) = confined_staged_path(staged) {
            let _ = fs::remove_file(canon);
        }
    }
    let _ = fs::remove_file(dir.join("stage-receipt.json"));
    Ok(true)
}

/// Deletes the staged installer and receipt, and prunes stale `.pre-update-*`
/// database backups (keeps the newest one as the safety net). Called on boot
/// AFTER a settled receipt — the install landed, so nothing staged can still
/// be applied and those files only waste disk. Best-effort throughout: cleanup
/// must never block boot, and everything is confined to the staging dir and
/// the database directory.
///
/// Race safety: the caller fires this asynchronously, so a fresh automatic
/// check may have staged a NEWER update by the time this runs. If the receipt
/// on disk now describes a version other than the running build, that is an
/// in-flight stage — the staging dir and its backups are left fully alone.
#[tauri::command]
fn update_cleanup_settled(app: AppHandle, state: State<'_, DbState>) -> Result<bool, String> {
    let running_version = app.package_info().version.to_string();
    let receipt = read_stage_receipt();
    let receipt_version = receipt
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // A live receipt for a different version means a new update is staged or
    // in flight — touch nothing out of the staging dir, and not the staged
    // exe either. Backups are still pruned (the keep-newest rule cannot reach
    // the backup the pending stage just wrote).
    let pending = !receipt.is_null()
        && !receipt_version.is_empty()
        && receipt_version != running_version;

    let dir = staging_dir();
    if !pending {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let removable = name == "stage-receipt.json"
                    || name == "last-update.log"
                    || (name.starts_with("Dental.Solutions_") && name.ends_with("_x64-setup.exe"));
                if removable {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
    if let Some(db_path) = state.path.lock().unwrap().clone() {
        if let Some(db_dir) = db_path.parent() {
            let mut backups: Vec<PathBuf> = fs::read_dir(db_dir)
                .map(|rd| {
                    rd.flatten()
                        .map(|e| e.path())
                        .filter(|p| {
                            p.file_name()
                                .map(|n| {
                                    let n = n.to_string_lossy();
                                    n.contains(".pre-update-") && n.ends_with(".bak")
                                })
                                .unwrap_or(false)
                        })
                        .collect()
                })
                .unwrap_or_default();
            backups.sort_by_key(|p| {
                fs::metadata(p)
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            });
            // Keep the newest backup; everything older is disposable.
            let stale = backups.len().saturating_sub(1);
            for p in backups.into_iter().take(stale) {
                let _ = fs::remove_file(p);
            }
        }
    }
    Ok(true)
}

/// Magic string marking a genuine stage receipt (updateInstaller.ts filters
/// on the same value).
const STAGE_RECEIPT_MAGIC: &str = "DENTALUPDATE-RECEIPT";

/// Build the machine-readable stage receipt written after a verified update
/// download. The frontend reads it on next boot to record "Updated to vX"
/// even when app.exit(0) races the IPC reply. Extracted for unit tests —
/// this payload is the update chain's source of truth.
fn build_stage_receipt(
    version: &str,
    checksum: &str,
    bytes: u64,
    staged_path: &str,
    relaunch_target: &str,
    previous_version: &str,
) -> serde_json::Value {
    serde_json::json!({
        "magic": STAGE_RECEIPT_MAGIC,
        "version": version,
        "checksum": checksum,
        "bytes": bytes,
        "staged_at": chrono_like_stamp(),
        "staged_path": staged_path,
        "relaunch_target": relaunch_target,
        "previous_version": previous_version,
    })
}

/// One identifier inside a prerelease tag: all-numeric identifiers compare
/// numerically (and sort below alphanumerics); others compare in ASCII order.
#[derive(PartialEq, Eq, Clone, Debug)]
enum SemverId {
    Num(u64),
    Alpha(String),
}

#[derive(PartialEq, Eq, Clone, Debug)]
struct ParsedVersion {
    /// Dotted numeric core; compared component-wise, zero-padded — any length.
    core: Vec<u64>,
    pre: Vec<SemverId>,
}

/// Parses `v?X(.Y(.Z)…)?(-pre.…)?`. Mirror of `parseVersion` in
/// src/services/updateService.ts — keep both in step; the golden fixtures in
/// tests/services/updateService.test.ts and the Rust tests below pin the same
/// cases. Returns None on anything else.
fn parse_semver(raw: &str) -> Option<ParsedVersion> {
    let trimmed = raw.trim();
    let s = trimmed.strip_prefix('v').unwrap_or(trimmed);
    let (core_s, pre_s) = match s.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (s, None),
    };
    let mut core = Vec::new();
    for part in core_s.split('.') {
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        core.push(part.parse().ok()?);
    }
    if core.is_empty() {
        return None;
    }
    let mut pre = Vec::new();
    if let Some(p) = pre_s {
        for id in p.split('.') {
            if id.is_empty() {
                return None;
            }
            if id.bytes().all(|b| b.is_ascii_digit()) {
                pre.push(SemverId::Num(id.parse().ok()?));
            } else {
                pre.push(SemverId::Alpha(id.to_string()));
            }
        }
    }
    Some(ParsedVersion { core, pre })
}

/// Full-semver comparison. Rules (mirror of `compareVersions` in
/// updateService.ts):
/// - the numeric core is compared component-wise and zero-padded, so a
///   four-part `2.31.26.1` outranks `2.31.26` instead of truncating to it;
/// - a prerelease sorts BEFORE its release (`2.31.27-rc.1 < 2.31.27`);
/// - prerelease identifiers compare numerically when all-numeric, otherwise in
///   ASCII order; an all-numeric identifier sorts below an alphanumeric one;
///   a shorter identifier list sorts below a longer one that extends it.
fn semver_cmp(a: &ParsedVersion, b: &ParsedVersion) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let len = a.core.len().max(b.core.len());
    for i in 0..len {
        let ord = a
            .core
            .get(i)
            .copied()
            .unwrap_or(0)
            .cmp(&b.core.get(i).copied().unwrap_or(0));
        if ord != Ordering::Equal {
            return ord;
        }
    }
    match (a.pre.is_empty(), b.pre.is_empty()) {
        (true, true) => return Ordering::Equal,
        // A release outranks any of its own prereleases.
        (true, false) => return Ordering::Greater,
        (false, true) => return Ordering::Less,
        (false, false) => {}
    }
    for i in 0..a.pre.len().max(b.pre.len()) {
        let (Some(x), Some(y)) = (a.pre.get(i), b.pre.get(i)) else {
            return a.pre.len().cmp(&b.pre.len());
        };
        let ord = match (x, y) {
            (SemverId::Num(x), SemverId::Num(y)) => x.cmp(y),
            (SemverId::Num(_), SemverId::Alpha(_)) => Ordering::Less,
            (SemverId::Alpha(_), SemverId::Num(_)) => Ordering::Greater,
            (SemverId::Alpha(x), SemverId::Alpha(y)) => x.cmp(y),
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
    Ordering::Equal
}

/// Classifies a stage receipt against the build that is actually running.
///
/// A receipt whose version matches the running build has settled. A receipt
/// for an older build is obsolete and must never be offered as a downgrade.
/// A receipt with an `apply_requested_at` marker but a newer version means the
/// installer was launched and did not land — treating that as `pending`
/// re-offered the same installer on every boot, which is the update loop.
fn receipt_status(receipt: &serde_json::Value, running_version: &str) -> &'static str {
    if receipt.is_null() {
        return "none";
    }
    let receipt_version = receipt.get("version").and_then(|v| v.as_str()).unwrap_or_default();
    if receipt_version == running_version {
        return "settled";
    }
    if matches!(
        (parse_semver(receipt_version), parse_semver(running_version)),
        (Some(receipt), Some(running)) if semver_cmp(&running, &receipt) == std::cmp::Ordering::Greater
    ) {
        return "obsolete";
    }
    if receipt
        .get("apply_requested_at")
        .and_then(|v| v.as_str())
        .is_some()
    {
        "failed"
    } else {
        "pending"
    }
}

/// Boot-time update diagnostics for Settings → Updates.
///
/// Returns the receipt of the last staged install (if any) plus the exe's
/// embedded version. A half-applied install shows up as a receipt whose
/// version differs from the running exe, or an exe that predates the last
/// staged receipt.
#[tauri::command]
fn update_diagnostics(app: AppHandle) -> Result<serde_json::Value, String> {
    let receipt: serde_json::Value = read_stage_receipt();

    // The app version stamped into the installer and tauri.conf.json, NOT
    // Cargo's package version: those two drifted to 2.31.18/2.31.20 and every
    // installed 2.31.20 build looked like an unfinished install of itself.
    let running_version = app.package_info().version.to_string();

    let status = receipt_status(&receipt, &running_version);

    // A 'pending' receipt is only actionable while the staged installer file
    // still exists — the waiter runs THAT exe on our exit. If it is gone
    // (partial install already consumed it, or the temp dir was cleaned),
    // no amount of app-closing completes anything, so the UI must not ask
    // the user to close the app.
    let staged_installer_present = receipt
        .get("staged_path")
        .and_then(|p| p.as_str())
        .map(|p| fs::metadata(p).map(|m| m.is_file()).unwrap_or(false))
        .unwrap_or(false);

    Ok(serde_json::json!({
        "running_version": running_version,
        "receipt": receipt,
        "receipt_status": status,
        "staged_installer_present": staged_installer_present,
    }))
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
            update_install,
            update_apply,
            update_discard,
            update_cleanup_settled,
            update_diagnostics,
            apply_app_patch,
            pdf_save::save_webview_as_pdf,
            file_export::save_file_bytes
        ])
        // MUST stay above every other plugin: the single-instance hook has to
        // decide "am I the first process?" before any other plugin initialises
        // against a database file the second process would then overwrite.
        //
        // Desktop persistence is whole-file read-modify-write (db_read_bytes →
        // mutate in sql.js → db_save_bytes rewrites the entire file), so a
        // second instance is not a harmless duplicate window: it loads the same
        // file, diverges in memory, and its next save is last-writer-wins. A
        // double-click on the shortcut could silently drop a case, an invoice
        // or a payment. The second launch therefore focuses the first window
        // and exits; argv/cwd are ignored because nothing in this app passes a
        // file to the second process.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                // A window that is minimized or hidden to the tray reads as
                // "the app did not start" — the operator clicks again and we
                // are back to two engines. Errors are ignored deliberately:
                // a window that is already focused can refuse set_focus on
                // some window managers, and that must not panic the callback.
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The stage receipt is the update chain's boot-time source of truth
    /// ("did the staged install land?"). The missing-receipt incident
    /// (2026-09-30) produced a false "close the app to install" banner, so
    /// pin the payload shape the frontend's updateInstaller.ts filters on.
    #[test]
    fn stage_receipt_has_magic_and_full_payload() {
        let r = build_stage_receipt(
            "2.12.4",
            "sha256:abc123",
            3_857_934,
            "C:/temp/dental-solutions-update/setup.exe",
            "C:/Program Files/Dental Solutions/dental-solutions.exe",
            "2.12.3",
        );
        assert_eq!(r["magic"], STAGE_RECEIPT_MAGIC);
        assert_eq!(r["version"], "2.12.4");
        assert_eq!(r["checksum"], "sha256:abc123");
        assert_eq!(r["bytes"], 3_857_934);
        assert_eq!(r["staged_path"], "C:/temp/dental-solutions-update/setup.exe");
        assert_eq!(r["relaunch_target"], "C:/Program Files/Dental Solutions/dental-solutions.exe");
        assert_eq!(r["previous_version"], "2.12.3");
        // staged_at must be present and non-empty (the frontend shows it).
        assert!(!r["staged_at"].as_str().unwrap_or_default().is_empty());
    }

    /// The diagnostics filter accepts exactly the magic we emit — a stale or
    /// hand-edited receipt file must never read as a staged install.
    #[test]
    fn diagnostics_magic_filter_matches_emitted_receipt() {
        let r = build_stage_receipt("2.13.0", "sha256:x", 1, "p", "t", "2.12.3");
        let text = serde_json::to_string_pretty(&r).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            parsed.get("magic").and_then(|m| m.as_str()),
            Some(STAGE_RECEIPT_MAGIC)
        );
    }

    /// A receipt whose install landed must settle against the running build.
    #[test]
    fn receipt_for_running_version_is_settled() {
        let r = build_stage_receipt("2.31.21", "sha256:x", 1, "p", "t", "2.31.20");
        assert_eq!(receipt_status(&r, "2.31.21"), "settled");
    }

    /// An installer that was launched but left the old build running must not
    /// be offered again as "ready" on every boot.
    #[test]
    fn applied_but_unlanded_receipt_is_failed_not_pending() {
        let mut r = build_stage_receipt("2.31.21", "sha256:x", 1, "p", "t", "2.31.20");
        assert_eq!(receipt_status(&r, "2.31.20"), "pending");
        r["apply_requested_at"] = serde_json::json!("20261106-120000");
        assert_eq!(receipt_status(&r, "2.31.20"), "failed");
        assert_eq!(receipt_status(&r, "2.31.21"), "settled");
    }

    /// A receipt left over from an older build must not be offered as a
    /// downgrade once a newer build is installed.
    #[test]
    fn older_receipt_is_obsolete() {
        let r = build_stage_receipt("2.31.18", "sha256:x", 1, "p", "t", "2.31.10");
        assert_eq!(receipt_status(&r, "2.31.21"), "obsolete");
    }

    #[test]
    fn absent_receipt_is_none() {
        assert_eq!(receipt_status(&serde_json::Value::Null, "2.31.20"), "none");
    }

    // --- Version parser (mirrors the golden fixtures in tests/services/updateService.test.ts) ---
    #[test]
    fn parse_semver_handles_two_three_four_components_and_prerelease() {
        let v = parse_semver("2.31.26").unwrap();
        assert_eq!(v.core, vec![2, 31, 26]);
        assert!(v.pre.is_empty());

        let v4 = parse_semver("2.31.26.1").unwrap();
        assert_eq!(v4.core, vec![2, 31, 26, 1]);

        let pre = parse_semver("2.31.27-rc.1").unwrap();
        assert_eq!(pre.pre, vec![SemverId::Alpha("rc".to_string()), SemverId::Num(1)]);

        let vprefixed = parse_semver("v2.31.27").unwrap();
        assert_eq!(vprefixed.core, vec![2, 31, 27]);

        assert!(parse_semver("not a version").is_none());
        assert!(parse_semver("2.31.").is_none());
        assert!(parse_semver("2..31").is_none());
    }

    #[test]
    fn four_part_version_outranks_three() {
        // The old parser truncated “2.31.26.1” to 2.31.26 — it must NOT compare equal.
        let a = parse_semver("2.31.26.1").unwrap();
        let b = parse_semver("2.31.26").unwrap();
        assert_eq!(semver_cmp(&a, &b), std::cmp::Ordering::Greater);
        assert_eq!(semver_cmp(&b, &a), std::cmp::Ordering::Less);
    }

    #[test]
    fn prerelease_sorts_before_release() {
        let rc = parse_semver("2.31.27-rc.1").unwrap();
        let rel = parse_semver("2.31.27").unwrap();
        assert_eq!(semver_cmp(&rc, &rel), std::cmp::Ordering::Less);
        assert_eq!(semver_cmp(&rel, &rc), std::cmp::Ordering::Greater);
    }

    #[test]
    fn prerelease_numeric_identifiers_compare_numerically() {
        let a = parse_semver("2.31.27-rc.2").unwrap();
        let b = parse_semver("2.31.27-rc.10").unwrap();
        assert_eq!(semver_cmp(&a, &b), std::cmp::Ordering::Less);
        // Numeric < alphanumeric; shorter list < longer extension.
        let num = parse_semver("2.31.27-1").unwrap();
        let alpha = parse_semver("2.31.27-a").unwrap();
        assert_eq!(semver_cmp(&num, &alpha), std::cmp::Ordering::Less);
        let short = parse_semver("2.31.27-rc").unwrap();
        let long = parse_semver("2.31.27-rc.1").unwrap();
        assert_eq!(semver_cmp(&short, &long), std::cmp::Ordering::Less);
    }

    #[test]
    fn staging_version_gate_rejects_garbage_and_allows_prerelease() {
        assert!(is_valid_version_string("2.31.29"));
        assert!(is_valid_version_string("2.31.29-rc.1"));
        assert!(!is_valid_version_string(""));
        assert!(!is_valid_version_string("v2.31.29"));   // CI stamps the bare tag
        assert!(!is_valid_version_string("2.31.x"));
        assert!(!is_valid_version_string("../../etc"));
        assert!(!is_valid_version_string("2.31.29; rm -rf /"));
        assert!(!is_valid_version_string(&"1".repeat(33)));
    }

    // --- SHA256SUMS.txt parser (audit #26) ---
    #[test]
    fn sums_parser_picks_the_setup_exe_entry() {
        let text = "5a415e5ea264c7299d9129b3956114182d4cc0a3bff2a60e29b70c342f89e8f8  Dental.Solutions_2.31.28_x64-setup.exe\n";
        assert_eq!(
            parse_sums_installer_hash(text).as_deref(),
            Some("5a415e5ea264c7299d9129b3956114182d4cc0a3bff2a60e29b70c342f89e8f8")
        );
        // Upper-case digests are normalised to lower case.
        let upper = "5A415E5EA264C7299D9129B3956114182D4CC0A3BFF2A60E29B70C342F89E8F8  Dental.Solutions_2.31.28_x64-setup.exe\r\n";
        assert_eq!(
            parse_sums_installer_hash(upper).as_deref(),
            Some("5a415e5ea264c7299d9129b3956114182d4cc0a3bff2a60e29b70c342f89e8f8")
        );
    }

    #[test]
    fn sums_parser_ignores_unrelated_lines_and_short_hashes() {
        let text = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcded  checksum-sha256.txt\nabc123  Dental.Solutions_2.31.28_x64-setup.exe\nDEADC0DE  setup.exe\n";
        assert!(parse_sums_installer_hash(text).is_none());

        // A valid 64-hex upper-case digest is accepted and normalised.
        let real = format!("{}{}", "DEADC0DE", "0".repeat(56)); // exactly 64 hex chars
        let line = format!("{real}  Dental.Solutions_2.31.28_x64-setup.exe\n");
        assert_eq!(parse_sums_installer_hash(&line).as_deref(), Some(real.to_ascii_lowercase().as_str()));
    }

    #[test]
    fn sums_parser_returns_none_for_empty_input() {
        assert!(parse_sums_installer_hash("").is_none());
        assert!(parse_sums_installer_hash("no lines here\n").is_none());
    }

    // --- Path confinement for the apply/discard paths ---
    #[test]
    fn confined_staged_path_rejects_files_outside_staging_dir() {
        let dir = staging_dir();
        fs::create_dir_all(&dir).unwrap();
        let inside = dir.join("dental-test-confine-inside.exe");
        fs::write(&inside, b"t").unwrap();

        let outside = std::env::temp_dir().join("dental-confine-outside.exe");
        fs::write(&outside, b"t").unwrap();

        assert!(confined_staged_path(inside.to_str().unwrap()).is_ok());
        assert!(confined_staged_path(outside.to_str().unwrap()).is_err());
        // Traversal that CANONICALISES outside must be refused too.
        let traversal = dir.join("..").join("dental-confine-outside.exe");
        assert!(confined_staged_path(traversal.to_str().unwrap()).is_err());

        let _ = fs::remove_file(&inside);
        let _ = fs::remove_file(&outside);
    }

    #[cfg(windows)]
    #[test]
    fn unsigned_installer_fails_signature_check() {
        let tmp = std::env::temp_dir().join("dental-solutions-test-unsigned.bin");
        fs::write(&tmp, b"this is not a valid signed installer").unwrap();
        let res = verify_authenticode(&tmp);
        let _ = fs::remove_file(&tmp);
        // Print the exact reason so a failure on a CI runner shows what the
        // signature command actually reported (revocation checks, catalog
        // view, PowerShell availability) rather than an opaque assert.
        if let Err(ref e) = res {
            eprintln!("verify_authenticode rejected the unsigned file with: {e}");
        }
        assert!(
            res.is_err(),
            "an unsigned file must not pass Authenticode verification"
        );
    }
}
