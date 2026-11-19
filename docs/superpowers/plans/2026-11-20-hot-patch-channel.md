# Hot-patch Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or
> subagent-driven-development. Steps are independent phases with checkpoints.

**Goal:** Small app changes ship as hot patches: a `update-patch.json` on gh-pages +
`apply_app_patch` Rust command writes the new `dist/` files and reloads the webview —
no CI round-trip. The full installer path (v2.31.28 model) stays for bigger changes.

**Architecture:**
1. `scripts/make-app-patch.mjs` — offline packer: scans `dist/` → `update-patch.json`
   (`magic: DENTALUPDATE-PATCH`, `base_version`, `display_version`, `released_at`, `notes`,
   `files: [{path, sha256, size}]`, `deleted: []`).
2. `src-tauri/src/app_patch.rs` — `apply_app_patch(manifest_url)`: fetch + verify manifest
   (base == `package_info().version`, magic, add `raw.githubusercontent.com` to
   `TRUSTED_UPDATE_HOSTS`), per-file: confined canonicalized write + hash-after-write vs
   manifest hash, then `location.reload()` via the main webview.
3. TS — `PatchStatus` (none/available/applying/applied/failed) + `fetchPatchManifest` +
   `checkPatch` + panel "Apply Patch" + history (`patch_available`, `patch_applied`).

**Tech Stack:** Node (packer, vitest), TypeScript (vite), Rust/Tauri 2 (webview reload).

---

## Global Constraints

- Patches contain only files under `dist/`, nothing under `src/`, native, `src-tauri/`, `docs/`.
- Everything written is confined to `<app_dir>/dist/` (canonicalized prefix check).
- Version identity: `package_info().version` unchanged; `display_version` is what the panel shows.
- No CI changes (v1 — manual gh-pages push only).
- Commit per phase; master only; nothing pushed.

---

## Task A: `scripts/make-app-patch.mjs` — the packer

**Files:**
- Create: `scripts/make-app-patch.mjs`
- Create: `tests/scripts/make-app-patch.test.ts`
- Modify: `package.json` (optional script entry; add `test` glob? not needed — standalone)

**Interfaces:**
- `buildPatchManifest({ baseVersion, distDir }) -> Promise<UpdatePatchManifest>`
- `scanDir(dir)` exported for tests: `Array<{ path: string; sha256: string; size: number }>`
- `saveManifest(path, manifest)` — writes `update-patch.json`.
- `main()` CLI: `node scripts/make-app-patch.mjs --base <version> --out <path>`

- [ ] **Step 1: Write the failing test** (`tests/scripts/make-app-patch.test.ts`)
  ```ts
  import { describe, it, expect } from 'vitest';
  import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { buildPatchManifest } from '../../scripts/make-app-patch.mjs';

  it('builds a manifest from a dist dir with real hashes/sizes', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'dist-'));
    await writeFile(join(dist, 'index.js'), 'console.log("v2");\n');
    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'assets/app.css'), 'body{}\n');
    const m = await buildPatchManifest({ baseVersion: '2.31.34', distDir: dist });
    expect(m.magic).toBe('DENTALUPDATE-PATCH');
    expect(m.base_version).toBe('2.31.34');
    expect(m.display_version).toBe('2.31.34');  // bump when applied patch — edit by hand later
    expect(m.files.length).toBe(2);
    for (const f of m.files) {
      expect(f.path.startsWith('dist/')).toBe(true);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const idx = m.files.find(f => f.path === 'dist/index.js')!;
    // cross-check hash computed by hand from the file
    ...
  });
  ```
- [ ] **Step 2: Run test** — Expected: FAIL (buildPatchManifest not exported yet).
- [ ] **Step 3: Write packer implementation** — reads `dist/` at `distDir`, uses `crypto.createHash('sha256')` reading file bytes, writes nothing in buildManifest (saveManifest separate); `display_version` default = baseVersion.
- [ ] **Step 4: Run test** — PASS.
- [ ] **Step 5: Manual packer check** — run `npm run build` then `node scripts/make-app-patch.mjs --base 2.31.34` and `jq` the manifest (should print a summary). Commit.

---

## Task B: Rust — `app_patch.rs` + command + tests

**Files:**
- Create: `src-tauri/src/app_patch.rs`
- Modify: `src-tauri/src/lib.rs` (`mod app_patch;`, `apply_app_patch` in `generate_handler!`)

**Interfaces:**
- `pub async fn apply_app_patch(app: AppHandle, manifest_url: String) -> Result<AppPatchOutcome, String>`
- `app_patch::fetch_bytes(client, url) -> Result<Vec<u8>, String>` — small variant of `fetch_text`.
- `app_patch::app_dir(app) -> PathBuf` — InstallLocation with fallback (registry helper mirrors `installed_relaunch_target` logic).
- `app_patch::apply_patch(base_dir, manifest) -> Result<PatchApplicationStats>` — pure, used by tests:
  - `pub struct AppPatchManifest { magic: String, base_version: String, display_version: String, files: Vec<PatchFileEntry>, deleted: Vec<String> }`
  - `PatchFileEntry { path: String, sha256: String, size: u64 }`
- Progress events: `app.emit("app_patch://progress", {stage: "downloading|verifying|applying", received, total, path})` (non-fatal; emit_progress pattern re-use).
- Reload: `app.get_webview_window("main").eval("location.reload()")` (non-fatal, log if missing).

- [ ] **Step 1: Write failing Rust tests** (append `#[cfg(test)] mod tests` in app_patch.rs)
  - `parse_patch_manifest(json)` accepts valid; rejects wrong magic.
  - `parse_patch_manifest` rejects `base_version != expected`.
  - `confined_path` rejects traversal `../x`, absolute, and out-of-app-dir when base_dir = app_dir(.unwrap() — temp dir without "dist").
  - `apply_patch(base_dir, manifest)` end-to-end on a temp `base_dir` containing `dist/`: writes files, hash-after-write == manifest (verify each), returns stats; tampered manifest (hash mismatch after write) → Err + refuses to reload.
  - Tampered file on disk: apply_patch on pre-existing corrupt target file → Err, file content untouched? (read expected bytes from manifest; we write bytes → hash == manifest ✓ so tampered target is fine after write. The tamper test is: manifest claims wrong hash for one file → post-write rehash != manifest → Err.)
- [ ] **Step 2: Implement `app_patch.rs`**: fetch bytes with allowlist (reuse `TRUSTED_UPDATE_HOSTS` — add `raw.githubusercontent.com`), apply loop with write-tmp-rename and rehash.
- [ ] **Step 3: Run `cargo test --lib`** — expect: `ok`.
- [ ] **Step 4: Commit.**

---

## Task C: TS — states + panel + history + unit tests

**Files:**
- Modify: `src/services/updateService.ts` (add PatchManifest + `fetchPatchManifest()` + `checkPatch()`)
- Modify: `src/services/updateInstaller.ts` (new phases `patch_available/patch_applying/patched`, `applyPatch()`, discover in `runAutoUpdate` at the idle branch; discover should not be cancelled by existing phase guards: currently `runAutoUpdate` returns early for `ready_to_apply/applying` only)
- Modify: `src/services/updateHistory.ts` (add `patch_available/patch_applied/patch_failed` states)
- Modify: `src/components/common/AutoUpdatePanel.tsx` (green card "Patch ready — vX (display_version) — Apply Patch button"; `patch_applying` progress card; `patched` success card)
- Modify: `src/components/settings/UpdatesTab.tsx` (status card tone+label for patch states; history rows for patch states)
- Create: `tests/services/appPatch.test.ts` (fetch + state transitions + refuse-when-no-patch; component-level: jest? use the updateInstaller test style — jsdom)
- Verify: tsc/lint/tests.

- [ ] **Step 1: Unit tests** for `fetchPatchManifest` (mock fetch success/no-patch), `checkPatch` gating (base != currentVersion → none).
- [ ] **Step 2: Implement TS state machine.**
- [ ] **Step 3: Implement panel + settings cards.**
- [ ] **Step 4: Run `npm test`, `npm run lint`, `cargo test --lib` — all green.**
- [ ] **Step 5: Commit.**

---

## Task D: Operator doc — `docs/app-patch.md`

One-page: when to cut a patch (JS-only dist changes), packer command line, verification of the manifest file table, manual push to `origin/gh-pages`, boot behavior on clients, tamper-rollout warnings (per-file hashes verified on apply), "when a patch breaks things" expectations (JS reload), and future direction (CI, deleted[]).

---

## Task E: Live preview walkthrough

- Open http://localhost:3000 in the browser → check Update tab renders new states (idle baseline), no console errors.
- Deploy a scratch patch: pick a real JS-only change (e.g., a string in a view), packer → update-patch.json to `gh-pages`-scratch — panel should show "Apply Patch"; DO NOT click apply (their data reload). Open PR-level summary.

---

## Task F: First real patch

User picks a change → run: `node scripts/make-app-patch.mjs --base 2.31.34` → push `origin/gh-pages` → verify gh-pages raw URL serves it → desktop clients see it.

---

## Global checkpoints (end of each task)

- `npm run lint` (tsc, guards), `npm test` green.
- Rust: `cargo test --lib` green.
- Per-task commit on master.

---

## Self-Review

1. Spec coverage: all 6 phases present? (A=packer, B=Rust, C=TS, D=docs, E=E2E, F=first patch) ✓
2. Placeholder scan: no TBD/TODO left?
3. Type consistency: `AppPatchOutcome { base_version, display_version, files_applied: number, deleted_applied: number }` consistent across A (display) / B (produced) / C (consumed).
4. Version guard unchanged (no package.json version bumps in phases A–E — that happens in v2.31.35 installer or explicit).

---

## Execution handoff

Two execution choices per the writing-plans contract:

1. Subagent-Driven — fresh subagent per task + two-stage review (recommended; the developer must be in a parallel-agent session).
2. Inline Execution — execute here via executing-plans, batch execution with review checkpoints.

Which one?
