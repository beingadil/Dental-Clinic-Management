<div align="center">
  <img src="https://raw.githubusercontent.com/beingadil/Dental-Clinic-Management/master/public/icon.svg" width="96" height="96" alt="Dental Solutions logo" />
  <h1>Dental Solutions</h1>
  <p><strong>Offline-first clinic &amp; dental laboratory management</strong></p>
  <p>Chart the teeth &middot; Print the job slip &middot; Invoice the clinic</p>
</div>

<div align="center">

[![Release](https://img.shields.io/github/v/release/beingadil/Dental-Clinic-Management?include_prereleases&style=flat-square)](https://github.com/beingadil/Dental-Clinic-Management/releases/latest)
[![CI](https://github.com/beingadil/Dental-Clinic-Management/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/beingadil/Dental-Clinic-Management/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/beingadil/Dental-Clinic-Management?style=flat-square)](LICENSE)

[![React](https://img.shields.io/badge/React-19-087EA4?logo=react&logoColor=white&style=flat-square)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white&style=flat-square)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white&style=flat-square)](https://tailwindcss.com/)
[![SQLite](https://img.shields.io/badge/SQLite-sql.js%20WASM-003B57?logo=sqlite&logoColor=white&style=flat-square)](https://sql.js.org/)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black&style=flat-square)](https://tauri.app/)
[![Vitest](https://img.shields.io/badge/Vitest-137%20files-6E9F18?logo=vitest&logoColor=white&style=flat-square)](https://vitest.dev/)

</div>

---

A local-first application for dental laboratories and the clinics that send them work. It runs
entirely offline on Windows, stores everything in a single local SQLite database, and covers the
full operational loop: receive a case from a clinic &rarr; chart exactly which teeth and which
shade &rarr; move it through production under an SLA &rarr; print the job slip the technician works
from &rarr; bill the clinic.

No server, no cloud account, no monthly fee. Your data never leaves the machine.

## Contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Available scripts](#available-scripts)
- [Quality gates](#quality-gates)
- [Backup &amp; restore](#backup--restore)
- [CI/CD](#cicd)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Why this exists

Dental software usually stores a case as a free-text description &mdash; *"upper left bridge, A2
shade"*. That is easy to type and impossible to verify. It cannot be priced without a human
reading it, it cannot be checked against the printed job slip, and it cannot be audited when a
clinic asks why they were billed 45,000 for work logged against a different unit. Once the
description, the price, the slip and the invoice are four independent records of the same case,
they will disagree &mdash; and there is no way to tell which one is right.

Dental Solutions models the case the way a technician actually sees it. A case's identity is its
**charted teeth and shade**. The price is the clinic's agreed rate multiplied by charted units, the
job slip prints those teeth, the invoice prints those teeth, and the ledger posts from that
invoice. One derivation, four surfaces, no possibility of drift.

The second structural commitment: **invoicing is not a separate step.** An invoice is raised for
you at the moment a case is registered, priced from that clinic's agreed rate for that material,
and it stays bound to the case for the rest of its life. A neighbouring case-management or
invoicing product would make the operator re-enter the case into a second system and keep the two
in sync by hand. Here the case and its money are the same record.

## Features

| Module | What it does |
| --- | --- |
| **Dashboard** | Active cases, in-production count, deliveries due today, outstanding receivables in PKR, the production pipeline, cases flagged at risk against their SLA, revenue vs. collections, and a searchable command palette. |
| **Dental Workstation** | The case board. Table and Kanban views, filter by clinic, status, priority and date, bulk actions, drag-and-drop across workflow stages, and an archive for delivered work. |
| **Case intake** | Interactive FDI odontogram (11&ndash;48, Universal 1&ndash;32) with per-tooth shade, restoration type and material. Pick a shade once and it applies to the whole selection. Case templates for repeat work. |
| **Production workflow** | `received &rarr; in production &rarr; QC &rarr; ready &rarr; dispatched`, with a global SLA turnaround per priority (urgent 1 / high 2 / normal 4 / low 7 days) and automatic due dates and badges. Notes, QC results and attachments sit next to the chart. |
| **Print studio** | Job slips and invoices are first-class deliverables, not exports. Per-document section toggles, saved print settings, batch printing for a morning's queue, and a one-sheet clinic account statement for a period. |
| **Billing &amp; receivables** | Automatic invoicing at registration from the clinic's agreed rate. Partial payments allocated across invoices, advances, credit notes, debit adjustments, write-offs, payment-proof image attachments, and receivable balances. |
| **General ledger** | A real double-entry ledger &mdash; balanced journal entries, opening balances that reconcile, allocation of one payment across several invoices, clinic statements, and billing reports. All in PKR. |
| **Material &amp; price catalog** | Operator-managed restorative materials with real clinical indications, contraindications, base price, SLA turnaround and warranty, grouped into categories the lab controls. |
| **Dental clinics** | Directory of referring clinics with contacts, addresses, pricing overrides, balances, and a direct view of their cases and ledger. |
| **Settings** | White-label branding (practice name, logo, tagline, accent colour) applied to invoices, job slips and app chrome; roles and user management; print settings; database health; backup and restore; software updates. |
| **Backup &amp; updates** | Verifiable `.dentalbackup` export with a SHA-256 manifest, a validated restore with a safety snapshot, sandboxed `.sql` dump import, and a five-step self-update on the desktop build. |
| **Security** | PBKDF2-SHA256 password hashing, WebCrypto session tokens with login backoff, strict CSP, parameterised SQL, and zero accounts shipped &mdash; the operator creates the first one. |

## Architecture

The browser build and the desktop build run **the same engine bytes**. The only seam that changes
is the persistence layer: in the browser the snapshot goes to IndexedDB; on the desktop it writes
a real SQLite file to the OS app-data directory.

```
+---------------------------------------------+
|  UI - React 19 / Vite / Tailwind CSS 4       |
|  Dashboard, Workstation, Case File,         |
|  Print Studio, Billing, Ledger, Settings    |
+-----------------+---------------------------+
                  | typed repositories
                  | (src/db/repos.ts)
+-----------------v---------------------------+
|  Local application API                       |
|  transactions, FK enforcement, migrations   |
+-----------------+---------------------------+
                  |
     +------------+-------------+
     |                          |
+----v-----------+   +----------v----------+
|  Browser       |   |  Desktop (Tauri 2)  |
|  sql.js WASM   |   |  Rust native layer  |
|  in-memory     |   |  file I/O, export,  |
|  + IndexedDB   |   |  PDF save, updater  |
|  snapshot      |   +----------+----------+
+----+------------+              |
     |                          |
     v                          v
+---------------------------------------------+
|  SQLite database - 23 migrations            |
|  cases - clinics - invoices - payments       |
|  advances - adjustments - journal - audit    |
+---------------------------------------------+
```

### Rules that matter

- **SQLite is authoritative.** React state is a mirror; every write goes through a typed
  repository inside a transaction, with foreign keys enforced on every connection.
- **Migrations are append-only.** `src/db/migrations.ts` holds 23 numbered, transactional
  migrations recorded in `schema_migrations`. An applied migration is never edited &mdash; a new
  one is added. A migration that rebuilds a table declares `rebuildsTable: true`, and the runner
  suspends FK enforcement for that migration only and runs `PRAGMA foreign_key_check` before
  committing.
- **The chart is the truth.** Teeth, shade and material are structured data. Every downstream
  surface &mdash; slip, invoice, price, ledger &mdash; derives from them, so none of them can
  disagree with the others. A retainer has no teeth, is not charted, and appears on no slip or
  invoice *as teeth*.
- **One definition per figure.** A money concept is computed in exactly one place. The v2.25.0
  release exists because one figure had 33 implementations, 16 of which omitted credit notes and
  overstated what was owed.
- **Document numbers are reserved, not derived.** `doc_sequences` guarantees gap-free numbering
  (`DS-`, `INV-`, `PAY-`, `ADV-`, `CR-`, `JE-`) with `UNIQUE` on every one of them.
- **Print must survive the screen.** If a fact matters enough to print, it is unambiguous in
  monospace on paper and never relies on colour alone.

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 19, TypeScript 5.8 (strict) |
| Build | Vite 6, Tailwind CSS 4 |
| Desktop shell | Tauri 2 (Rust), NSIS installer, SHA-256-verified auto-updates |
| Persistence | SQLite via `sql.js` 1.13 (WebAssembly, bundled locally &mdash; no CDN) |
| Schema | 23 transactional migrations, FK enforcement, `CHECK` constraints, gap-free sequences |
| Charts | Recharts |
| Icons | Lucide React, `qrcode.react` |
| Print &amp; export | Browser print pipeline, jsPDF-compatible PDF export, CSV export |
| Auth | PBKDF2-SHA256, WebCrypto session tokens, role-based access control |
| Testing | Vitest (137 test files), Testing Library, fake-indexeddb |
| Quality | `tsc --noEmit` (strict), WCAG AA contrast audit, role-token solver, `npm audit`, `cargo audit` |
| CI/CD | GitHub Actions &mdash; web checks, Windows installer build, releases, update manifest |

## Getting started

**Prerequisites**

- [Node.js](https://nodejs.org/) 20 or newer
- npm (ships with Node)
- For the desktop build only: the Rust toolchain (`rustup`) and, on Windows, the MSVC build tools
  and WebView2 (preinstalled on Windows 10/11)

**Install and verify**

```bash
npm install       # install dependencies
npm run dev       # web dev server on :3000
```

The app ships with **zero accounts**. On first run the login screen walks you through creating
the operator's administrator &mdash; the first account created receives the Super Admin role.
Everything you enter stays on your own machine.

**Run the desktop app**

```bash
npm run tauri:dev    # run the desktop app in dev mode
npm run tauri:build  # produce the Windows installer in src-tauri/target/release/bundle/
```

The desktop build writes a real `dental_solutions.sqlite` file into the OS app-data directory
(atomic tmp &rarr; fsync &rarr; rename) instead of the browser store. Same schema, same file
format, both directions portable.

## Available scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `:3000`. |
| `npm run build` | Production web build into `dist/`. |
| `npm test` | Runs the Vitest suite once and exits non-zero on failure. |
| `npm run lint` | `tsc --noEmit` under strict, plus the version guard and binary-integrity check. |
| `npm run tauri:dev` | Launch the desktop app in dev mode. |
| `npm run tauri:build` | Build the Windows NSIS installer. |
| `npm run role:check` | Fails if the generated role colour tokens, or their alias rules, were hand-edited. |
| `npm run audit:contrast` | Grades every bg&rarr;text pairing the app really renders, in both themes and every interaction state, against WCAG AA 4.5:1. |
| `npm run audit:darkbar` | Catches ink sitting on an inherited dark bar &mdash; the case the contrast audit structurally cannot see. |
| `npm run audit:inline-bg` | Scans for inline backgrounds that bypass the token system. |
| `npm run icons` | Regenerate the app icon set from `public/icon.svg`. |
| `npm run verify:binaries` | Verify native binaries against the SHA-256 published in the official npm tarball. |

## Quality gates

Everything below must be green before a change lands on `master`.

```bash
npm run lint              # type check + version guard + binary integrity
npm test                  # 137 test files
npm run role:check        # design tokens are generated, not hand-edited
npm run audit:contrast    # WCAG AA over every rendered pairing, both themes
npm run audit:darkbar     # ink on an inherited dark bar
npm run build             # production web build
```

The contrast audit is not advisory. It reads the Tailwind **source** rather than `dist/`, so it
cannot grade a stale bundle, and it currently passes **137/137 graded pairings** in both themes
across rest plus four interaction states.

Two design-system rules exist because hand-editing them fails *silently*:

- **Colour tokens are generated, not written.** `--color-ink-*` and `--color-ds-*` are produced by
  `scripts/role-picker.mjs`. If one is edited by hand, the utility falls through to the raw
  palette and the solved token never paints &mdash; no error anywhere. `npm run role:check` fails
  the build instead.
- **Contrast is a function of the operator's choices, not ours.** Every lab picks its own accent
  colour, so readability has to be solved structurally &mdash; per-swatch tint sets and semantic
  tokens that resolve to safe readings &mdash; rather than by choosing a pleasant hex value once.

## Backup &amp; restore

Settings &rarr; Database &amp; Backup offers exactly two actions:

- **Export** &mdash; writes a single versioned `.dentalbackup` package containing the SQLite file
  plus a SHA-256 manifest, anywhere you choose.
- **Restore** &mdash; validates the package (header, format version, checksum), takes a safety
  snapshot of the current data, swaps the engine and reloads. The package is rejected if it does
  not verify, so a truncated or tampered file fails loudly instead of quietly damaging the
  database.

A plain `.sql` dump can also be imported. It is replayed into a throwaway database first and
reported &mdash; schema version, table and row counts, refused statements &mdash; before anything
is replaced, and statements that would escape the sandbox (`ATTACH`, `VACUUM INTO`,
`load_extension`, `readfile`) are refused rather than run. Reports never show cell values: a dump
carries password hashes.

On the desktop build, timestamped `.bak` copies are kept next to the live database file.

## CI/CD

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Push &amp; pull request on `master` | Typecheck, tests, contrast audit, role-token check, source-palette equivalence, `npm audit` and `cargo audit`. A red build blocks the pull request. |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Tag `v*` | Builds the Windows NSIS installer on `windows-latest` and publishes it to a GitHub Release with a SHA-256 checksum. |

Releases are cut by pushing a version tag &mdash; CI builds and publishes; nothing is built from
a laptop. The same workflow publishes `update-manifest.json` to the `gh-pages` branch, which the
in-app updater reads.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Schema, relationships, migrations, seed layer and backup format. |
| [`docs/sqlite-persistence-audit.md`](docs/sqlite-persistence-audit.md) | The persistence and data-integrity audit &mdash; how the SQLite layer actually works, with every finding and its regression test. |
| [`docs/explainer-video-script.md`](docs/explainer-video-script.md) | The 4-minute product walkthrough: scene list, narration and recording checklist. |
| [`docs/SMOKE_TEST_CHECKLIST.md`](docs/SMOKE_TEST_CHECKLIST.md) | The per-release manual smoke test to run on the clinic PC. |
| [`PRODUCT.md`](PRODUCT.md) | The product brief &mdash; users, operating context, constraints and commitments. |
| [`LOOPS.md`](LOOPS.md) | The reusable, bounded agent loops this project runs. |
| [`CHANGELOG.md`](CHANGELOG.md) | Full release history, v2.0.0 &rarr; v2.28.2. |

Screenshots of the running application and the demo video are published to Google Drive:
[**Screenshots &amp; demo video**](https://drive.google.com/drive/folders/15C3aAkTyNpbe2O2nnFUnQ9Nl7i6OWimm).

## Contributing

Issues and pull requests are welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) first
&mdash; it covers the gates a change must pass, and the conventions this codebase follows.

## Security

Please do not open a public issue for a security problem. Follow the private reporting process in
[`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) &copy; 2026 Muhammad Adil Shahzad
