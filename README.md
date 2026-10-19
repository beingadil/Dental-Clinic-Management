<div align="center">

# Dental Solutions

**Clinic & Dental Laboratory Management — run a dental lab end to end on one machine.**

Chart the teeth, print the slip, invoice the clinic. Offline-first, white-label, no server required.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-2f6bff?style=for-the-badge&logo=github)](https://beingadil.github.io/Dental-Clinic-Management/)
[![Release](https://img.shields.io/github/v/release/beingadil/Dental-Clinic-Management?label=Release&color=2ea44f)](https://github.com/beingadil/Dental-Clinic-Management/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-2ea44f.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-137%20files-8b5cf6.svg)](tests)
[![CI](https://github.com/beingadil/Dental-Clinic-Management/actions/workflows/ci.yml/badge.svg)](https://github.com/beingadil/Dental-Clinic-Management/actions/workflows/ci.yml)
[![Offline](https://img.shields.io/badge/runtime%20network%20calls-0-2ea44f.svg)](https://github.com/beingadil/Dental-Clinic-Management)

**[Live demo](https://beingadil.github.io/Dental-Clinic-Management/)** ·
**[Windows installer](https://github.com/beingadil/Dental-Clinic-Management/releases/latest)** ·
**[Documentation](docs/)** · **[Changelog](CHANGELOG.md)**

</div>

---

## The problem

A dental lab gets work from clinics, but that work lives in three disconnected places: a paper job slip, a spreadsheet of invoices, and whatever the technician remembers.

Cases are described in free text — *"upper left bridge, A2 shade"* — so the same case gets re-keyed and re-checked by hand at every step. When a case runs late or gets under-billed, nobody finds out until the clinic rings. And most software in this category assumes a server and an internet connection, which a small lab working off one clinic PC doesn't have.

The result: late cases are found late, invoices are raised from memory instead of from the work, and chasing money turns into guesswork.

## The idea

**A case's identity is its charted teeth and shade — not a free-text description.**

You receive a case from a clinic and chart exactly which teeth on an interactive FDI odontogram. Pick the shade once and it applies to the whole selection; set restoration type and material per tooth. Everything downstream derives from that chart:

| Surface | Derived from the chart |
|---|---|
| **Price** | Clinic's agreed rate × charted units |
| **Job slip** | Prints the teeth, shade and material |
| **Invoice** | Prints the teeth |
| **Ledger** | Posts from the invoice |

One derivation, four surfaces, no possibility of drift. That is what makes a printed slip trustworthy against the case it came from — and a slip is read at the bench by a technician who is *not* looking at a screen.

**Invoicing is not a separate step.** An invoice is raised for you the moment a case is registered, priced from that clinic's agreed rate for that material, and it stays bound to the case for life. Other products make you re-enter the case into a second system and keep the two in sync by hand. Here the case and its money are the same record.

## Screenshots

Screenshots of the running application and a 4-minute screen-recorded walkthrough
are hosted on Google Drive:

**[📸 Screenshots & demo video — Google Drive](https://drive.google.com/drive/folders/15C3aAkTyNpbe2O2nnFUnQ9Nl7i6OWimm)**

The folder contains the dashboard, dental workstation, case-file wizard, FDI
odontogram with the Vita shade guide, material catalog, clinic directory,
billing, monthly statement, the printed job slip and account statement — plus the
explainer video and a README indexing everything. All of it is the running
application with its own seeded demo dataset, not mockups.

## Features

**Case intake**
- Interactive FDI odontogram (11–48, Universal 1–32) with per-tooth shade, restoration type and material
- Shade picked once applies to the whole selection
- Per-tooth vs. not-per-tooth products modelled honestly — a retainer has no teeth, isn't charted, and appears on no slip or invoice *as teeth*
- Case templates for repeat work; shade guide, clinical specs and implant brands

**Production**
- Fixed workflow: `received → in production → QC → ready → dispatched`
- Global SLA turnaround per priority (urgent 1 / high 2 / normal 4 / low 7 days) with automatic due dates and badges
- Case notes, QC results and attachments kept next to the chart
- Table and Kanban views, filters, bulk actions, archive

**Print**
- Job slips and invoices are first-class deliverables, not exports
- Per-document section toggles, saved print settings, batch printing for a whole morning's queue
- One-sheet clinic account statement for a clinic over a period
- Designed for a technician reading paper, not a screen

**Billing & money**
- Automatic invoicing at registration from the clinic's agreed rate
- Partial payments with allocation across invoices, advances, credit notes, debit adjustments, write-offs
- Payment-proof image attachments; receivable balances
- Real double-entry ledger — journal entries, balanced and asserted, opening balances that reconcile
- Clinic statements and billing reports; CSV export; PDF export

**Operations**
- White-label branding — practice name, logo, tagline and accent colour, applied to invoices, job slips and app chrome
- Roles and user management; the app ships with **zero accounts** and the operator creates the first one
- Verifiable backup (`.dentalbackup` + SHA-256 manifest), restore drill, sandboxed `.sql` dump import
- Five-step self-update on the desktop build: check → download → verify → back up → ask

**Platform**
- Runs with the network unplugged — zero runtime network calls after load
- Real SQLite database (WebAssembly in the browser, a real file on the desktop build)
- Dark mode, 1366px-class screens, keyboard navigation, reduced-motion support

## Quick start

```bash
git clone https://github.com/beingadil/Dental-Clinic-Management.git
cd Dental-Clinic-Management
npm install
npm run dev          # web dev server on :3000
```

First run shows **Create the administrator** — the app ships with no accounts, so the first account you create gets the Super Admin role. Everything you enter stays on your own machine.

```bash
npm test             # 137 test files
npm run lint         # tsc --noEmit (strict)
npm run build        # production web build
npm run tauri:build  # Windows installer (NSIS) — needs Rust + MSVC build tools
```

> **Requirements:** Node.js 20+ and npm. Desktop packaging additionally needs the Rust toolchain (`rustup`) and, on Windows, the MSVC build tools and WebView2 (preinstalled on Windows 10/11).

**Try it now → [beingadil.github.io/Dental-Clinic-Management](https://beingadil.github.io/Dental-Clinic-Management/)**

## Architecture

```
Dental Solutions UI (React 19 + Vite + Tailwind CSS 4)
        │
        ▼
Local application API (typed repositories, src/db/repos.ts)
        │
        ├── SQLite database (sql.js WASM in browser / file on desktop)
        │       cases · patients · clinics · invoices · payments
        │       advances · adjustments · journal · ledger · audit
        │
        └── Services
                backupService (.dentalbackup) · updateService + updateInstaller
                prioritySla · financeDomain · fileValidation
```

The browser build and the desktop build run **the same engine bytes**. The only seam that changes is `src/db/persistence.ts`: in the browser the snapshot goes to IndexedDB (localStorage as a fallback); on the desktop it writes a real `dental_solutions.sqlite` file in the OS app-data directory via atomic tmp → fsync → rename. Same schema, same file format, both directions portable.

- **Schema** — `src/db/migrations.ts`, 23 numbered transactional migrations recorded in `schema_migrations`. Append-only: never edit an applied migration.
- **Integrity** — foreign keys enforced on every connection, `CHECK` constraints on all enums and money, `UNIQUE` on every document number, `doc_sequences` for gap-free numbering (`DS-`, `INV-`, `PAY-`, `ADV-`, `CR-`, `JE-`).
- **Auth** — PBKDF2-SHA256 password hashing, WebCrypto session tokens with login backoff, strict CSP, parameterised SQL.

## Quality

| Gate | What it does |
|---|---|
| `npm test` | 137 Vitest files — db engine, repos, crypto, seeds, persistence, boot, and 43 component suites |
| `npm run lint` | `tsc --noEmit` under `strict` |
| `npm run role:check` | Fails if the generated role colour tokens or their alias rules are hand-edited |
| `npm run audit:contrast` | Grades every bg→text pairing the app really renders, in both themes and every interaction state, and **fails CI** on anything under WCAG AA 4.5:1 — currently **137/137 pairings pass** |
| `npm run audit:darkbar` | Catches ink sitting on an inherited dark bar (ancestor-aware, not same-classname) |
| `npm audit` + `cargo audit` | Dependency advisories in both ecosystems fail the build |

**Security:** zero accounts shipped, PBKDF2 hashing, WebCrypto tokens, strict CSP (no remote scripts, no frames, no form posts), parameterised SQL, and `.gitignore` excludes every database, backup and real patient/payment record from version control.

## How this was built

The product was developed with **AI coding agents** (Claude via Claude Code / OpenCode) working from a written specification, with machine-checkable gates rather than self-review.

- **A real spec, not a prompt** — [`PRODUCT.md`](PRODUCT.md) and `docs/` pin down the operating constraints: one operator on 1366px screens, local-first, genuine dental vocabulary (FDI numbering, shade, restoration type, SLA, bench routing), money in PKR, and printing treated as a deliverable rather than an export.
- **Gates decide, not the agent** — `tsc`, the test suite, the role-token check and the contrast audit decide whether something is done. Several real defects were caught by those gates after the agent's own summary had already declared them fixed.
- **Bounded loops with a stop condition that can fail** — the dashboard design-fidelity loop in [`LOOPS.md`](LOOPS.md) rebuilds a panel against a reference, then measures the **live DOM** for `scrollWidth > clientWidth` overflow at the target viewport and 25% narrower, fixing the worst finding and re-measuring until both counts reach zero. It caught a duplicated currency prefix and four clipped labels that screenshot review had passed.
- **Adversarial verification** — audit findings were re-checked against the running application before being recorded. That is how the worst one surfaced: `sql.js`'s `export()` silently resets `PRAGMA foreign_keys` to OFF, so every FK and cascade guarantee died after the first snapshot save.

The **shipped product deliberately makes no model calls and no third-party network requests.** A product holding patient records and real money should not have a model quietly mis-price an invoice — so the running system is deterministic and auditable, and every figure in the demo comes from a SQL query against the real database. The AI is in the engineering, not in the data path.

## Documentation

| Document | What it covers |
|---|---|
| [`docs/DATABASE.md`](docs/DATABASE.md) | Schema, relationships, migrations, seed layer, backup format |
| [`docs/sqlite-persistence-audit.md`](docs/sqlite-persistence-audit.md) | The SQLite persistence and data-integrity audit |
| [`docs/explainer-video-script.md`](docs/explainer-video-script.md) | Storyboard for the 4-minute product explainer |
| [`docs/SMOKE_TEST_CHECKLIST.md`](docs/SMOKE_TEST_CHECKLIST.md) | The per-release manual smoke test for the clinic PC |
| [`CHANGELOG.md`](CHANGELOG.md) | Full release history (v2.0.0 → v2.28.2) |
| [`PRODUCT.md`](PRODUCT.md) | Product brief: users, constraints and commitments |
| [`LOOPS.md`](LOOPS.md) | The reusable agent loops this project runs |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute, and the gates a change has to pass |
| [`SECURITY.md`](SECURITY.md) | Reporting a vulnerability, and the controls already in place |

## Roadmap

- [x] Offline SQLite engine, case charting, workflow, printing, billing, ledger
- [x] Desktop installer with verified self-update
- [x] Verifiable backup / restore with a restore drill
- [ ] Multi-clinic sync for labs that outgrow one machine
- [ ] Barcode / QR scanning at case receipt
- [ ] Lab-side technician accounts with scoped permissions

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) first — it explains the gates every change has to pass, and the conventions this codebase follows (typed repositories, append-only migrations, generated design tokens, real dental vocabulary).

## Security

Please report vulnerabilities privately via [`SECURITY.md`](SECURITY.md) rather than opening a public issue.

## License

[MIT](LICENSE) © 2026 Muhammad Adil Shahzad
