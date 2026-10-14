//! `identifier` in tauri.conf.json is `pk.dentalsolutions.app` — DO NOT "fix" it.
//!
//! Tauri warns that an identifier ending in `.app` collides with the macOS
//! app-bundle extension. The warning is correct on macOS and irrelevant here
//! (this project ships Windows-only NSIS bundles), but the value is not free to
//! change, because the identifier is the identity that:
//!
//!   1. keys the Windows uninstall/repair registry entry (HKCU InstallLocation,
//!      read back by the updater's relaunch target),
//!   2. keys the update channel — a changed identifier reads as a different app,
//!      so every clinic's installed copy would stop finding its own updates, and
//!   3. names `%APPDATA%\pk.dentalsolutions.app`, where dental_solutions.sqlite
//!      and the `.bak` rotation actually live.
//!
//! (3) is the reason this is not a cheap rename: the new identifier would give
//! the new build an EMPTY data directory. Every existing clinic would open the
//! app to an empty case list and, if they then saved, their live database file
//! would sit untouched next to a brand-new one.
//!
//! Renaming would need a migration (copy `%APPDATA%\pk.dentalsolutions.app`
//! into the new directory on first run) and a deliberate product decision.
//! Until that exists, the identifier stays. See also
//! `resolve_db_path` in src/lib.rs, which derives the database path from
//! `app_data_dir()` and therefore from this same identifier.
//!
//! ## Why staticVCRuntime is set here and not in tauri.conf.json
//!
//! `STATIC_VCRUNTIME` is deprecated in favour of `build.windows.staticVCRuntime`
//! in the config — but that key does not exist in the schema shipped by the CLI
//! this project builds with (`@tauri-apps/cli` 2.11.4 vs `tauri-build` 2.7.0),
//! and `tauri build` hard-fails on it:
//!
//! ```text
//! error on `build`: Additional properties are not allowed ('windows' was unexpected)
//! ```
//!
//! tauri-build names this exact skew in its own diagnostics ("you are using a
//! CLI version that is newer than tauri-build and is incompatible"). The Rust
//! API below is the same setting and is what the crate's deprecation notice
//! offers as the alternative.
//!
//! It is load-bearing, not cosmetic. The shipped exe imports NONE of
//! VCRUNTIME140.dll / MSVCP140.dll — it links the `api-ms-win-crt-*` API sets
//! that ship inside Windows 10/11. If this ever stops taking effect, a clinic
//! PC without the Visual C++ Redistributable fails to launch, which is the
//! clean-machine failure this setting exists to prevent.

fn main() {
    // Keep in sync with the test that asserts the CRT stays statically linked.
    let windows = tauri_build::WindowsAttributes::new().static_vc_runtime(true);
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attrs).expect("failed to run tauri build script");
}