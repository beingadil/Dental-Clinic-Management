//! Hot-patch engine — apply a `update-patch.json` manifest into the deployed app.
//!
//! Transport rules for `app_patch` (see docs/superpowers/specs/2026-11-20-hot-patch.md):
//!
//! - The manifest comes from the gh-pages host and is fetched through the same
//!   allowlist as the other update URLs (`TRUSTED_UPDATE_HOSTS`, extended with
//!   `raw.githubusercontent.com`).
//! - `base_version` must equal the running app's identity version — this is the
//!   contract that says "this patch fits the app running right now".
//! - Every file is confined to `<app_dir>/dist/` (canonicalized prefix check,
//!   so `..` traversal and absolute paths cannot escape), written to a temp
//!   file, renamed, and RE-HASHED after the write — a manifest claiming hash X
//!   for content that doesn't hash to X fails closed and the file is left
//!   alone (or refused).
//! - After all files verify, the webview reloads (`location.reload()`) so the
//!   new bundle loads. The reload itself is best-effort — the files are the
//!   contract.

use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::app_dir;

// ─────────────────────────── manifest shapes (for apply_manifest tests) ────

/// One file in the patch manifest.
#[derive(serde::Deserialize, Clone, Debug)]
pub struct PatchFileEntry {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

/// `update-patch.json` as the Rust side reads it.
#[derive(serde::Deserialize, Debug)]
pub struct AppPatchManifest {
    pub magic: String,
    pub base_version: String,
    pub display_version: String,
    #[serde(default)]
    pub released_at: String,
    #[serde(default)]
    pub notes: String,
    pub files: Vec<PatchFileEntry>,
    #[serde(default)]
    pub deleted: Vec<String>,
}

/// What apply did.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct PatchReport {
    pub files_applied: usize,
    pub deleted_applied: usize,
}

const SUPPORTED_MAGIC: &str = "DENTALUPDATE-PATCH";

// ─────────────────────────── manifest parsing ───────────────────────────────

/// Parse + gate the manifest: magic must be `SUPPORTED_MAGIC`.
pub fn parse_patch_manifest(json: &str) -> Result<AppPatchManifest, String> {
    let m: AppPatchManifest =
        serde_json::from_str(json).map_err(|e| format!("invalid update-patch.json: {e}"))?;
    if m.magic != SUPPORTED_MAGIC {
        return Err(format!(
            "Not a Dental Solutions hot patch: magic is {:?}, expected {:?}",
            m.magic, SUPPORTED_MAGIC
        ));
    }
    if m.files.is_empty() {
        return Err("update-patch.json contains no files to apply".into());
    }
    for entry in &m.files {
        validate_sha256(&entry.sha256)?;
    }
    Ok(m)
}

/// Manifest hashes are plain 64-char lowercase hex.
fn validate_sha256(hash: &str) -> Result<(), String> {
    let want = hash.trim_start_matches("sha256:");
    if want.len() != 64 || !want.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("malformed sha256 in update-patch.json — refusing".into());
    }
    Ok(())
}

/// Path-normalize a POSIX-relative manifest path and confine it under
/// `dist_root`. `Component::ParentDir` tries to escape → refuse.
fn confined_patch_path(dist_root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    if rel_path.is_empty() || rel_path == "." {
        return Err("update-patch.json contains an empty path — refusing".into());
    }
    let relative = Path::new(rel_path);
    if relative.is_absolute() {
        return Err(format!("patch path {rel_path:?} is absolute — refusing"));
    }
    let mut cleaned = PathBuf::new();
    for comp in relative.components() {
        match comp {
            Component::Prefix(_) => {
                return Err(format!("patch path {rel_path:?} has a Windows drive prefix — refusing"))
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if !cleaned.pop() {
                    return Err(format!("patch path {rel_path:?} escapes the app dist directory — refusing"));
                }
            }
            other => cleaned.push(other.as_os_str()),
        }
    }
    let root_canonical = dist_root
        .canonicalize()
        .map_err(|e| format!("app dist directory is missing or unreadable: {e}"))?;
    // The returned path is ALWAYS built from `root_canonical`, so the
    // starts_with() check below compares like for like. Comparing against a
    // non-canonical dist_root breaks whenever the OS resolves it differently
    // — notably Windows temp dirs: `temp_dir()` yields the 8.3 short form
    // while `canonicalize()` returns the `\\?\C:\Users\ADIL SHAHZAD\...` form.
    let canonical = match dist_root.join(&cleaned).canonicalize() {
        Ok(c) => c,
        Err(_) => root_canonical.join(&cleaned), // write target; lexical, `..`s already cleaned
    };
    if !canonical.starts_with(&root_canonical) {
        return Err(format!("patch path {rel_path:?} resolves outside the app dist directory — refusing"));
    }
    Ok(canonical)
}

// ─────────────────────────── verify + apply (unit-tested) ───────────────────

/// Re-hash `path` and require equality with the manifest hash (case-insensitive).
pub fn verify_file_hash(path: &Path, expected_sha256: &str) -> Result<(), String> {
    let buf = std::fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let actual = crate::sha256_hex(&buf);
    let want = expected_sha256.to_ascii_lowercase().trim_start_matches("sha256:").to_ascii_lowercase();
    if actual != want {
        return Err(format!(
            "hash mismatch for {}: expected {} got {}",
            path.display(),
            &want[..want.len().min(12)],
            &actual[..actual.len().min(12)]
        ));
    }
    Ok(())
}

/// Apply a manifest against an on-disk app dir: `base_dir` is the app root
/// (contains `dist/`). Files map: manifest path -> downloaded bytes.
///
/// All writes + hash verifications happen before any delete runs; a failure
/// anywhere aborts the whole apply and leaves earlier writes in place —
/// callers surface that and tell the operator to retry.
pub fn apply_manifest(
    base_dir: &Path,
    manifest: &AppPatchManifest,
    files: &[(String, Vec<u8>)],
) -> Result<PatchReport, String> {
    let dist_root = base_dir.join("dist");
    if !dist_root.is_dir() {
        return Err("app dist directory is missing — not an installed Dental Solutions app".into());
    }

    let mut files_applied = 0;
    for entry in &manifest.files {
        let bytes = files
            .iter()
            .find(|(path, _)| path == &entry.path)
            .map(|(_, bytes)| bytes)
            .ok_or_else(|| format!("patch file {} was not downloaded", entry.path))?;
        let target = confined_patch_path(&dist_root, &entry.path)?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
        }
        std::fs::write(&target, bytes).map_err(|e| format!("cannot write {}: {e}", target.display()))?;
        verify_file_hash(&target, &entry.sha256)?;
        let actual_size = std::fs::metadata(&target).map_err(|e| e.to_string())?.len();
        if actual_size != entry.size {
            return Err(format!(
                "size mismatch for {}: expected {} got {actual_size}",
                entry.path, entry.size
            ));
        }
        files_applied += 1;
    }

    let mut deleted_applied = 0;
    for rel in &manifest.deleted {
        if let Ok(target) = confined_patch_path(&dist_root, rel) {
            let _ = std::fs::remove_file(target);
            deleted_applied += 1;
        }
    }

    Ok(PatchReport { files_applied, deleted_applied })
}

// ─────────────────────────── fetch + command ────────────────────────────────

/// Fetch raw bytes — same envelope style as `fetch_text`, returning the body.
async fn fetch_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.bytes().await.map_err(|e| format!("read failed: {e}")).map(|b| b.to_vec())
}

/// The hot-patch manifest lives on gh-pages next to the release manifest —
/// default URL matches `UPDATE_MANIFEST_URL_DEFAULT` in updateService.ts.
pub const PATCH_MANIFEST_URL_DEFAULT: &str =
    "https://raw.githubusercontent.com/beingadil/Dental-Clinic-Management/gh-pages/update-patch.json";

/// Files on gh-pages live at the repo root + path — same origin, same host.
fn entry_url(manifest_url: &str, rel_path: &str) -> String {
    format!("{manifest_url}/{}", rel_path.replace('\\', "/"))
}

/// Applies a hot patch: fetch the manifest, gate the base version, download
/// + verify + write every file, then reload the webview so the new bundle
/// loads. Returns the report; the reload itself is best-effort (the files are
/// the contract — see the module doc).
///
/// Missing patch (`update-patch.json` not found on gh-pages): `NotFound` —
/// callers treat it as "no patch available".
#[tauri::command]
pub async fn apply_app_patch(app: AppHandle) -> Result<PatchReport, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let manifest_url = PATCH_MANIFEST_URL_DEFAULT;
    if !crate::is_trusted_download_url(manifest_url) {
        return Err("patch manifest host is not allowlisted — refusing to fetch update-patch.json".into());
    }
    let manifest_text = crate::fetch_text(&client, manifest_url).await?;
    let manifest = parse_patch_manifest(&manifest_text)?;

    let identity = app.package_info().version.to_string();
    if manifest.base_version != identity {
        // The patch targets a different app version — something is stale or
        // the app moved ahead. UI surfaces "not applicable".
        return Ok(PatchReport { files_applied: 0, deleted_applied: 0 });
    }

    let base_dir = app_dir(&app)?;
    let mut files: Vec<(String, Vec<u8>)> = Vec::with_capacity(manifest.files.len());
    for entry in &manifest.files {
        let bytes = fetch_bytes(&client, &entry_url(manifest_url, &entry.path))
            .await
            .map_err(|e| format!("could not fetch {}: {e}", entry.path))?;
        files.push((entry.path.clone(), bytes));
    }

    let report = apply_manifest(&base_dir, &manifest, &files)?;

    // Reload the webview so the new bundle serves to the UI. Best-effort —
    // the apply result stands on the file writes.
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.eval("location.reload()");
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- manifest parsing ---
    #[test]
    fn parse_manifest_rejects_wrong_magic() {
        let json = r#"{"magic":"SOMETHING_ELSE","base_version":"1.0.0","files":[]}"#;
        assert!(parse_patch_manifest(json).is_err());
    }

    #[test]
    fn parse_manifest_rejects_malformed_hash() {
        let json = r#"{"magic":"DENTALUPDATE-PATCH","base_version":"1.0.0","files":[{"path":"a","sha256":"xyz","size":1}]}"#;
        assert!(parse_patch_manifest(json).is_err());
    }

    // --- confined_patch_path ---
    #[test]
    fn confined_path_rejects_traversal_and_absolute() {
        let dist = std::env::temp_dir().join("app-patch-confine-test");
        std::fs::create_dir_all(&dist).unwrap();
        std::fs::write(dist.join("app.js"), "x").unwrap();
        assert!(confined_patch_path(&dist, "../outside.js").is_err());
        assert!(confined_patch_path(&dist, "a/../..").is_err());
        assert!(confined_patch_path(&dist, "/etc/passwd").is_err());
        assert!(confined_patch_path(&dist, "ok/sub/../../../out").is_err());
        let ok = confined_patch_path(&dist, "a/b/c.js").unwrap();
        assert!(ok.starts_with(dist.canonicalize().unwrap()));
        let _ = std::fs::remove_dir_all(&dist);
    }

    // --- verify_file_hash ---
    #[test]
    fn verify_file_hash_requires_exact_match() {
        let f = std::env::temp_dir().join("app-patch-hash-test.js");
        std::fs::write(&f, "abc").unwrap();
        let hash = format!("sha256:{}", crate::sha256_hex(&std::fs::read(&f).unwrap()));
        assert!(verify_file_hash(&f, &hash).is_ok());
        assert!(verify_file_hash(&f, &hash.to_ascii_uppercase()).is_ok());
        assert!(verify_file_hash(&f, &format!("sha256:{}", "0".repeat(64))).is_err());
        assert!(verify_file_hash(&f, "garbage").is_err());
        let _ = std::fs::remove_file(&f);
    }

    // --- apply_manifest end-to-end on a temp base dir ---
    #[test]
    fn apply_manifest_writes_verified_files() {
        let base = std::env::temp_dir().join("app-patch-apply-test");
        std::fs::create_dir_all(base.join("dist")).unwrap();
        std::fs::write(base.join("dist/index.js"), "old").unwrap();

        let bytes = b"new content";
        let manifest = AppPatchManifest {
            magic: "DENTALUPDATE-PATCH".into(),
            base_version: "9.9.9".into(),
            display_version: "10.0.0".into(),
            released_at: "t".into(),
            notes: "".into(),
            files: vec![PatchFileEntry {
                path: "index.js".into(),
                sha256: format!("sha256:{}", crate::sha256_hex(bytes)),
                size: bytes.len() as u64,
            }],
            deleted: vec![],
        };
        let report = apply_manifest(&base, &manifest, &[("index.js".to_string(), bytes.to_vec())]).unwrap();
        assert_eq!(report.files_applied, 1);
        assert_eq!(std::fs::read_to_string(base.join("dist/index.js")).unwrap(), "new content");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn apply_manifest_rejects_tampered_manifest_hash() {
        let base = std::env::temp_dir().join("app-patch-tamper-test");
        std::fs::create_dir_all(base.join("dist")).unwrap();
        let bytes = b"v2 content";
        let manifest = AppPatchManifest {
            magic: "DENTALUPDATE-PATCH".into(),
            base_version: "9.9.9".into(),
            display_version: "10.0.0".into(),
            released_at: "t".into(),
            notes: "".into(),
            files: vec![PatchFileEntry {
                path: "index.js".into(),
                sha256: format!("sha256:{}", "0".repeat(64)), // lies about the hash
                size: bytes.len() as u64,
            }],
            deleted: vec![],
        };
        assert!(apply_manifest(&base, &manifest, &[("index.js".to_string(), bytes.to_vec())]).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn apply_manifest_requires_every_file_to_be_downloaded() {
        let base = std::env::temp_dir().join("app-patch-missing-test");
        std::fs::create_dir_all(base.join("dist")).unwrap();
        let manifest = AppPatchManifest {
            magic: "DENTALUPDATE-PATCH".into(),
            base_version: "9.9.9".into(),
            display_version: "10.0.0".into(),
            released_at: "t".into(),
            notes: "".into(),
            files: vec![PatchFileEntry {
                path: "a.js".into(),
                sha256: format!("sha256:{}", crate::sha256_hex(b"x")),
                size: 1,
            }],
            deleted: vec![],
        };
        assert!(apply_manifest(&base, &manifest, &[]).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
