# Hot-patch channel — operator doc (v2.31.32+ workflow)

This documents the "hot patch" flow: small JS-only changes reach clinics
without a CI round-trip. Before using it, read `docs/superpowers/specs/2026-11-20-hot-patch.md`.

## When a hot patch (not an installer) is right

- Pure JS/CSS changes — new UI strings, layout tweaks, bugfixes, small
  enhancements in `src/` or `dist` (all `.tsx`, `.ts`, `.css`, `.js`).
- The change must NOT touch: `src-tauri/` (Rust, requires reinstall),
  `src-tauri/src/tauri.conf.json`/`Cargo.*` (version identity), the update
  machinery (`src/services/update*` — chicken-and-egg changes), migrations,
  or data formats.

Anything bigger uses the installer path as today (v2.31.34 flow, unchanged).

## Producing a patch (`scripts/make-app-patch.mjs`)

```sh
npm run build                                   # refresh dist/
node scripts/make-app-patch.mjs --base 2.31.34  # base = installed JS version
```
- `--base`: the app version the patch targets — the version the installed app
  currently reports (`v{display_version}` etc). From the Settings → Updates
  screen or `npm run print:version`.
- `--display-version <ver>` (optional): what the app shows on success —
  default is the same as base. Set it to the "patch version" you want the
  operator to see (the app keeps its package.json version until next installer).
- `--notes <text>` (optional): free text shown on the panel.
- Writes `update-patch.json` at repo root. Review the output: it lists every
  file in `files[]` (paths relative to `dist/`).

## Deployment — no CI, just a branch push

```sh
git add update-patch.json
git commit -m "docs(patch): update-patch.json — <short desc>"
git push origin master:gh-pages
```
Then wait ~30s, refresh the network-edge (or the app): gh-pages deploys within
seconds. Clients who have the matching version then see the card:

> **Hot patch available — v2.31.35** — Apply now.

Clinics open Settings → Software Updates → Apply Patch; the app writes the
new files and reloads. Time to publish = seconds, not 15 min.

## How it verifies (safety)

- `base_version` gates: a patch only applies when the app version equals it.
  Stale patches are ignored.
- Rust verifies **every file's sha256 after writing** it (from the manifest);
  a mismatch aborts the apply, the file is left out.
- All writes are confined to `<app>/dist/` — a manifest can't touch anything else.
- Deleted files (`deleted[]`) are removed with the same confinement.

## Rollback / finding broken patches

- A broken patch leaves the app on the JS-side version (reload → new behavior, or
  old). There is no automatic revert — the installer path is the escalation path
  for reverting: cut a v2.31.3X+1 installer.
- If clients report breakage, pause by removing `update-patch.json` from gh-pages
  (no deploy — a fetch failure = "none") or pushing an empty-file version
  (parser rejects; `none`).

## When a patch is NOT the right vehicle

If:
- `package.json` version needs to change (Rust identity mismatch — the update
  chain's `receipt_status` etc. depend on identity),
- files outside `dist/` change,
- the user asked to "cut a release installer".

→ Use the v2.31.34 flow (tag + CI).

## Version semantics (what operators see)

- After apply, the app reloads (`location.reload()` from Rust, best-effort) and
  the **JS-visible version reads the new one** from the patched bundle.
- The **native (Rust) version stays at the installer version** — the two are
  expected to diverge until the next installer; that is intentional per the
  design.

## Timeline of a patch

1. Ship JS change in this repo; `npm run build`.
2. `node scripts/make-app-patch.mjs --base <installed>` → review manifest.
3. `git add update-patch.json` + commit + `git push origin master:gh-pages`.
4. Within ~30s, desktop clients (they check at boot + "Check for updates") show the patch card.
5. Operator clicks "Apply Patch" — app reloads.
6. Done. 15 minutes, no installer, no reboots.

## Troubleshooting

- Panel shows nothing → the patch targets a different `base_version` (app moved) → no display.
- Apply fails with "hash mismatch ..." → the file changed between manifest build and delivery (re-run the packer from the same tree; fix the diff).
- "could not fetch update-patch.json / HTTP 404" → gh-pages didn't get the file — check `git push origin master:gh-pages` succeeded.
- App reloaded but looks the same → expected for non-visible patches; check the version string in Settings.
