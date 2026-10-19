# Contributing to Dental Solutions

Thanks for taking the time to look at this. A few things to know before you open a
pull request — the project has a few conventions that are easy to trip over, and a
short list of gates every change has to pass.

## Getting set up

```bash
git clone https://github.com/beingadil/Dental-Clinic-Management.git
cd Dental-Clinic-Management
npm install
npm run dev        # web dev server on :3000
```

Node.js 20+ and npm. Desktop packaging additionally needs the Rust toolchain
(`rustup`) and, on Windows, the MSVC build tools and WebView2 (preinstalled on
Windows 10/11).

The app ships with **zero accounts**. On first run the login screen walks you
through creating the operator's administrator account — the first account created
receives the Super Admin role.

## The gates

A change is not done because it looks right. It is done when these pass:

```bash
npm run lint                  # tsc --noEmit under strict
npm test                      # 137 Vitest files
npm run role:check            # design tokens are generated, not hand-edited
npm run audit:contrast        # WCAG AA over every rendered bg>text pairing
npm run audit:darkbar         # ink on an inherited dark bar
npm run build                 # production web build
```

CI runs the same set, plus `npm audit` and `cargo audit` on the Rust side, and
builds the Windows installer. **All of it gates the release** — a failure blocks
the tag, not just the PR.

## Conventions worth knowing

**Design tokens are generated, not written.** `--color-ink-*` and `--color-ds-*`
role primitives are produced by `scripts/role-picker.mjs`, and `npm run
role:check` fails if they are hand-edited. Hand-editing them fails *silently*:
the utility falls through to the raw palette and the solved token never paints.
If you need a new colour, change the palette and re-run the solver.

**Contrast is enforced by CI.** `scripts/contrast-audit.mjs` grades every
bg→text pairing the app actually renders, in both themes and every interaction
state. New UI that fails it is not shippable. A second scan
(`scripts/find-darkbar-ink.mjs`) catches ink sitting on an inherited dark bar —
the case the first scan structurally cannot see.

**Migrations are append-only.** Schema changes go in `src/db/migrations.ts` as a
new numbered migration. Never edit an applied one. A migration that rebuilds a
table must declare `rebuildsTable: true`; the runner suspends FK enforcement for
that migration only and runs `PRAGMA foreign_key_check` before committing.

**Money is money.** Amounts are computed in one place per concept and asserted.
The ledger is double-entry and must balance — `financeDomain.ts` has the
assertion helpers. Don't introduce a second definition of a figure that already
exists; the v2.25.0 release exists because one figure had 33 implementations,
16 of which omitted credit notes.

**Real dental vocabulary.** FDI tooth numbering, shade, restoration type, SLA and
bench routing. Terms are not genericised: "A2", "Zirconia", "Porcelain Fuse
D" and "In Implant Abutment & Crown" are real catalog values, and the UI is
expected to use the same words a technician uses.

**Writes go through repositories.** `src/db/repos.ts` is the live data layer.
Transactional writes, FK enforcement, and no business logic in components.

**Print must survive the screen.** If a fact matters enough to print, it has to
be unambiguous in monospace on paper and not rely on colour alone.

## Reporting a bug

Open an issue with what you did, what you expected, what happened, and the app
version (shown in the sidebar footer). If it involves patient or money data,
describe the shape of the problem — never paste real records into an issue.

For anything involving the schema, the ledger, or a printed document, a failing
test in the same pull request is worth more than a description. The test suite
is the project's memory.

## Pull requests

- One logical change per PR
- Include a test that fails without your change
- Update `CHANGELOG.md` under `## [Unreleased]`
- If you changed the schema, add the migration and note the upgrade path

## Code of conduct

Be decent to each other. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
