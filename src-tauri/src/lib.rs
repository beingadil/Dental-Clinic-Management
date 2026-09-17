use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

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
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("cannot replace database file: {e}"))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("cannot finalize database file: {e}"))?;

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
            file_sha256
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
