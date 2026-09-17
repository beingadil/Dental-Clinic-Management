# Dental Solutions — Clinic & Laboratory Management

A local-first desktop/web application for dental clinics and dental laboratories:
case management (odontogram, FDI tooth mapping), lab tracking, invoicing with
partial payments and payment-proof images, double-entry ledger, analytics, and
a full offline workflow backed by a real SQLite database.

## Architecture

```
Dental Solutions UI (React 19 + Vite + Tailwind)
        │
        ▼
Local application API (typed repositories, src/db/repos.ts)
        │
        ├── SQLite database (sql.js WASM in browser / file on desktop)
        │       cases · patients context · labs · invoices · payments
        │       advances · adjustments · journal · ledger · audit
        │
        └── Services
                backupService (.dentalbackup) · updateService (online/offline)
                attachmentService · prioritySla · financeDomain
```

- **Browser build:** the SQLite engine (WASM, bundled locally — no CDN) persists
  snapshots to localStorage under a single binary-safe key.
- **Desktop build (Tauri 2):** the exact same engine bytes are written to a real
  `dental_solutions.sqlite` file in the OS app-data directory (atomic tmp +
  fsync + rename). Same schema, same file format, both directions portable.

## Requirements

- Node.js 20+ and npm
- Desktop packaging additionally needs the Rust toolchain (`rustup`) and,
  on Windows, the MSVC build tools + WebView2 (preinstalled on Win 10/11).

## Development

```bash
npm install
npm run dev        # web dev server on :3000
npm test           # vitest suite (db engine, repos, crypto, seeds, persistence, boot)
npm run lint       # tsc --noEmit
npm run build      # production web build into dist/
```

## Desktop packaging (Tauri)

```bash
npm run tauri:dev    # run the desktop app in dev mode
npm run tauri:build  # produce installers: NSIS + MSI in src-tauri/target/release/bundle/
```

App icon: `public/icon.svg` → PNG set + `icon.ico`/`icon.icns` via
`npm run icons` (uses `scripts/generate-icons.mjs` + `tauri icon`).

## Database & migrations

- Schema lives in `src/db/migrations.ts` (numbered, transactional, recorded in
  `schema_migrations`). Migrations run automatically at boot; see
  `docs/DATABASE.md` for tables, relationships, and the seed layer.
- All writes go through typed repositories with transactions and FK enforcement.

## Backup & restore

- **Export:** Settings → Database & Backup → *Export .dentalbackup* — a single
  versioned JSON package containing the SQLite file + a SHA-256 manifest.
- **Restore:** *Select & Validate Backup File* → the package is validated
  (header, format version, checksum) → a safety snapshot of current data is
  taken → the engine is swapped → app reloads.
- Desktop builds additionally keep timestamped `.bak` copies next to the live
  database file (`db_backup_file`).

## Updates

- **Online:** Settings → *Check for Updates* reads a version manifest
  (`update-manifest.json`, GitHub Releases compatible) and reports newer versions.
- **Offline:** *Import Offline Update (.dentalupdate)* validates the package
  checksum before any install step — a fully offline machine can always be
  updated from a trusted file.

## Offline operation

Core workflows (login, dashboard, cases, workstation, labs, billing, payments,
ledger, attachments, search, reports, settings, backup) require **no network**.
Fonts and the SQLite WASM are bundled; there are no runtime CDN/API calls.

## Documentation

- `docs/ARCHITECTURE_AUDIT.md` — original architecture discovery
- `docs/MIGRATION_AUDIT.md` — module-by-module data-flow audit
- `docs/DATABASE.md` — schema, relationships, migrations, backup format
- `docs/DATA_MIGRATION_REPORT.md` — legacy localStorage import details
- `docs/MIGRATION_PROGRESS.md` — phase-by-phase progress
- `CHANGELOG.md` — release history

## Security notes

- Passwords are stored only as PBKDF2-SHA256 hashes (never plaintext).
- `.gitignore` excludes databases, backups, and any real patient/payment data —
  never commit clinic data.
