# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [2.30.2] - 2026-10-22

Adjustment entries now reach installed copies.

### Fixed
- Credit notes, debit adjustments and refunds appear inline with the
  payment vouchers on the invoice row and in the invoice drawer, with
  their own CR-/DR-/REF- serials. They can be edited or deleted there.
- Editing a credit note reverses the original FIFO application and
  re-applies the corrected amount; deleting reverses it. Existing
  adjustments appear automatically, without a migration.
- Invoice statements show advance credit and close on the correct Dr/Cr
  side. "Amount Paid" is labelled "Paid / Adjusted".
- Print headers keep their contrast in dark mode, and missing invoice
  journals are backfilled at boot.

## [2.30.1] - 2026-10-22

The release the pipeline could not make, made.

2.30.0's work was finished and its tag was correct, but the release itself
had been published by hand from a tree that could not be rebuilt, with no
checksum beside it. This release is the one the pipeline produced: built
by CI from the tagged commit, checksummed, and published to the
auto-update manifest so installed copies are offered it.

**Why not reuse 2.30.0.** A machine that installed the hand-published
2.30.0 would have been told it was up to date and never offered the
fixed build - same version number, nothing to compare. 2.30.1 is a
version every copy can be offered, and it is an immutable release: the
2.30.0 tag was re-pointed twice while it was being repaired, and this
one will not be.

### Fixed
- **The CI's security job had been red since the E2E suite landed**, and
  the job that builds the installer *and publishes the auto-update
  manifest* needs it, so every release went out with neither. Two causes:
  vite was on a high-severity advisory (now the fixed patch release, and a
  dev dependency where it belongs), and `cargo audit` was red on two real
  advisories in the crates that verify certificates for the updater's own
  download - `rustls-webpki` and `webpki-roots`, both via `reqwest`.
  Both are fixed rather than ignored.
- **The E2E suite only passed in the evening.** It waited for the text
  "Good evening" to know the dashboard had rendered, and the dashboard
  greets by the hour. It now waits for the greeting element.

## [2.30.0] - 2026-10-22

The clinic ledger takes payments now, the monthly statement reads one month
at a time, and the release pipeline works again - which it had not been
doing quietly in the background.

### Added
- **Receive Payment in the clinic's Account Ledger.** A payment entered
  without selecting invoices is applied to the oldest unpaid invoice
  first, and **credit entries** auto-apply FIFO the same way. The ledger
  badges now say plain **Credit** / **Debit** instead of "adjustment",
  which is what they are.
- **A Playwright E2E suite** covering login, clinic creation and the
  account-ledger flows.

### Fixed
- **A multi-invoice receipt failed with `UNIQUE constraint failed`.** The
  payment allocations and attachments were deduplicated per payment, not
  across the invoice slices that payment was split into, so a receipt
  covering three invoices wrote the same allocation three times. The same
  guard now runs across every `syncCore` INSERT loop, not just this one.
- **The opening balance showed as "Refund / Adjustment"** in the clinic
  ledger, and the **financial cards on Clinic General Info disagreed with
  the General Ledger's closing balance**. Both now read the same numbers.
- **The monthly statement shows one month at a time**, with the previous
  month's balance carried in as Opening (B/F). The **Advance In** and
  **Advance Credit** columns are gone from the screen, the PDF and the
  workbook.
- **The release pipeline had been failing since the E2E suite landed.** The
  CI's security job runs `npm audit --audit-level=high` and had been red on
  a high-severity vite advisory. The desktop job that builds the installer
  *and publishes the auto-update manifest* needs the security job, so every
  release went out with no CI-built installer and no manifest - which is
  why the updater kept offering the old version: nothing had told it a
  new one existed. vite is on the fixed patch release, and it is a
  dev dependency where it belongs, not a runtime one.
- **The E2E suite only passed in the evening.** It waited for the text
  "Good evening" to know the dashboard had rendered, and the dashboard
  greets by the hour - "Good morning" before noon, "Good afternoon" until
  five, "Still up" after midnight. It failed every other hour of the day,
  at a login that was working perfectly. It now waits for the greeting
  element, which carries a `data-purpose` hook.
- **The v2.30.0 tag pointed at a tree that could not be built.** Its
  `Cargo.lock` still carried 2.29.0 while `package.json`,
  `tauri.conf.json` and `Cargo.toml` all said 2.30.0, so the version the
  installer carried and the version the tag named were different. The tag
  was re-pointed at the tree where all four agree, and the release was
  rebuilt from it.

## [2.29.0] - 2026-10-20

The statements are now documents an operator can read and send: the monthly
statement chooses its clinics, exports as a real workbook or a real PDF, and
prints the same columns the screen shows. The desktop app stops drawing its
own window controls, and the export pipeline no longer produces a
zero-byte file and calls it saved.

### Added
- **The monthly statement chooses its clinics.** A searchable multi-select
  filter scopes the statement, the workbook and the PDF to the clinics in
  play. The filter is applied *after* the history walk, so a clinic left out
  does not rewrite the balance carried forward into the months that remain;
  the month's totals are recomputed from what is left. Excluded ids are
  recorded, not included ones, so a clinic added later is in scope by
  default rather than silently missing from the statement.
- **A real Excel workbook replaces the CSV.** A summary sheet plus one sheet
  per month, with the figures as NUMBERS carrying a `#,##0` format, so a
  cell can be summed, sorted and charted — a spreadsheet that cannot do
  arithmetic is a picture of a spreadsheet. The grand total leaves the
  balance columns blank on purpose: the flows add up across months, the
  balances do not.
- **The statement's twelve columns are now a choice.** Twelve is more than a
  laptop screen shows at once, so the statement opens on the seven a reader
  needs and `FULL` is there for the months being audited. The choice is
  remembered, and the exported document follows it — the file an operator
  sends is the file they were reading.
- **A real vector PDF for the daily lab report**, with one page per month of
  activity, selectable text and real page breaks. Not a picture of the table
  and not the browser's print dialog.

### Fixed
- **The exported PDF was 0 bytes and the app said it was saved.** The blob
  URL was revoked on a ten-second timer, and the download read it after the
  timer fired. The URL is now held until the page goes away, the byte count
  is checked before the bytes leave, and the count that lands on disk is
  checked again — a short file is an error now, not a success.
- **The demo seed minted the same case number twice.** `addCase` numbers the
  case from the `cases` array in the render closure it was created in, so a
  second call made before React re-rendered read the same stale array. The
  seed now waits for the created case to *appear* rather than for a tick to
  pass, and the wait is a tested utility.
- **The monthly statement's PDF drew its totals row above the column
  headings.** The totals callback ignored the y it was handed and used a
  constant. It is now drawn under the last row, where a total belongs.
- **The daily report's by-clinic breakdown printed a page with a heading and
  nothing under it** when there were no clinics, and its late-delivery
  marker was dropped in a refactor. Both are fixed.
- **The contrast audit could not see a placeholder.** It paired a `bg-*` with
  the `text-*` painted on it, so a field's hint — which is ink — was graded
  by nothing. `placeholder-slate-400` on white measured 2.63:1 and the whole
  suite stayed green. Placeholders are graded now, as ink on the field they
  are painted in, and a test weakens the placeholder in the source and
  asserts the audit turns red.

### Changed
- **One table engine for every statement the app prints.** The ledger, the
  daily report and the monthly statement each grew their own copy of the
  same pagination, and the copies had drifted: one put its heading inside
  the table's own margin, another forgot to repeat the headings on a
  continuation page, a third measured its rows differently from the way it
  drew them. The behaviour now lives in one place.
- **One declaration for the statement's columns.** The screen, the PDF and
  the workbook each declared the twelve columns, and they had drifted: the
  PDF needed a legend because its headings were abbreviations the other two
  did not use, so the document had to be read alongside a key. The PDF now
  prints the headings the screen prints, and the legend is gone.
- **The desktop app no longer draws its own window controls.** The operating
  system's title bar owns them, so the app drawing a second set was two
  answers to one question. The Tauri window permissions that went with them
  were removed too.
- **The first-run screen was rebuilt as a cinematic stage** — a single key
  light, a vignette and grain behind a frosted console — with the theme
  switch moved into the header.

## [Unreleased]

### Fixed
- **The odontogram perf test measured the machine, not the memo boundary.** The
  CI run on `676c076` failed at "Tests (vitest)" with
  `expected 1.3222812500000032 to be less than 1.2089114300000006` — a
  wall-clock assertion comparing two benchmark arms. The stable arm does
  almost no work (React.memo short-circuits the chart), so its measured time
  is a *floor*: a render pass plus the harness's own per-iteration overhead.
  That floor does not shrink under contention, while the churned arm's time is
  real chart-render work — so under load the **ratio shrinks** even as the
  absolute saving grows. On the contended CI runner it fell to 4.6x and the
  old `/5` threshold missed by 9%. The arms were also measured in the wrong
  order, so the first one paid the whole cold-start cost of the chart's
  render path: in the broken-memo case that made the "fast" arm measure
  111ms against the "slow" arm's 36ms. Both arms are now warmed before
  either is measured, the trials are interleaved, and the fastest trial of
  each is taken (contention can only slow a sample, never speed it up). The
  comparison is made against the churned arm with a 2x floor, and the absolute
  saving is asserted in units of one chart render so the threshold moves with
  the machine. The load-independent render-count gate is unchanged.
- **`voucherJournalLink.test.tsx` stamped its fixture with the UTC day**
  (`new Date().toISOString().slice(0, 10)`) while the voucher list it
  renders into is scoped by `todayISO()` — the operator's *local* day. Between
  00:00 and 05:00 in PKT the two differ by a day, so the fixture was stamped
  yesterday, fell outside the list's own Today window, and the list rendered
  empty. This is the same bug the product documents in `src/utils/dateUtils.ts`,
  reintroduced in a test: the suite failed at 00:30 local and passed at 19:30
  local — same code, same day, different clock. The fixture now uses the local
  calendar day.

### Added
- **Live demo site.** The web build is published to GitHub Pages at
  https://beingadil.github.io/Dental-Clinic-Management/ so a reviewer can click
  into the running application without installing anything. It is served from a
  dedicated `gh-pages-site` branch, not from `gh-pages` - that branch carries
  `update-manifest.json`, which the desktop app's auto-updater fetches from
  `raw.githubusercontent.com`, and publishing the site there would delete the
  manifest and break the in-app updater for every installed copy.
- **`CONTRIBUTING.md`, `SECURITY.md` and `CODE_OF_CONDUCT.md`.** The gates a
  change has to pass, the controls already in place and how to report a
  vulnerability privately, instead of leaving a reviewer to infer them from the
  CI file.
- **Issue and pull-request templates.** A bug report asks for the version and
  the area, and both carry an explicit reminder not to paste real patient,
  clinic or payment data into a public thread.
- **Profile README** at https://github.com/beingadil - who this account is and
  what it builds.

### Changed
- **README rewritten for a first-time reader.** It now leads with the problem
  and the idea, explains why a case's identity is its charted teeth and shade
  rather than a free-text note, and points judges at the live demo, the
  Windows installer and the Google Drive folder of screenshots and the
  explainer video.
- **The build is now subpath-aware.** The WASM path is derived from
  `import.meta.env.BASE_URL` and the public base path is read from
  `PUBLIC_BASE_PATH` (default `/`). Previously the app could only be served
  from a domain root, and a root-absolute `/vendor/sql-wasm.wasm` 404s under
  `/<repo>/` with the same misleading failure mode already documented in the
  code: the 404 body is parsed as WASM and boot fails with "expected magic
  word 00 61 73 6d".
- **Repository description, homepage and 15 topics set** so the project is
  discoverable rather than a nameless repo.

### Removed
- **Stale UI audit reports** (`reports/impeccable-*.md`, dated 2026-10-09/10).
  They were accurate when written, and every finding in them has since been
  fixed - but a reader arriving cold would see a 13/20 score and a list of
  P1/P2 defects that no longer exist, with no way to tell which are open. The
  contrast problems they found are now enforced permanently by
  `npm run audit:contrast` in CI, which is a stronger guarantee than a
  one-off report.
- **An internal agent working plan** (`docs/superpowers/plans/`). It referred
  to a "sponsored run" and to "agentic workers" - internal working material
  that a public repository should not carry.
- **A leftover codename** from the audit document title, which still read
  "Freebuff Desktop" rather than the product name.

### Fixed
- **The explainer-video script told the operator to "log in with a demo
  account".** The app has shipped with zero accounts since v2.0.0, so that
  instruction could not be followed. It now documents the actual first-run
  setup and the dev-only fixture call that seeds the demo dataset.

## [2.25.0] - 2026-10-15

The nav rail, header bar and dashboard had each grown their own palette, meeting
at a seam that showed in dark mode. This release unifies them and fixes the
defects found while doing it.

### Correctness
- **Invoice balance had two live definitions.** The same figure was computed in
  33 places; 16 of them omitted credit notes. The register, the Outstanding KPI,
  the CSV export and every printed statement overstated what was owed, and
  "bulk mark paid" posted a different number from the row it was clicked on.
  All 33 now call one `invoiceBalanceDue()`, which clamps so an over-credit
  cannot self-mark an invoice paid and drop it off the cashier's queue.
- **Credit notes discarded the reference, notes and proof the cashier typed.**
  All three were on the type and never assigned.
- **`isVerified` was accepted on both payment commands and never read**, so
  every bank and cheque payment sat permanently unreconciled.
- **`RecordTransactionModal` reset on the wrong id.** Three of its four callers
  pass `initialLabId`; reopening for another clinic kept the previous one.
- **Pricing overrides ignored `effective_date`**, so an override dated for next
  month repriced today's cases immediately.
- **`warning_threshold_hours` was labelled but never compared.** Set it to 48
  and the screen said "due within 48 hours" and flagged nothing.
- **Three preferences were written and read by nothing** —
  `default_turnaround_days`, `default_priority` and
  `auto_print_job_slips`. All three now drive something.
- **Escalation settings were saved, audited and read by nothing.** The third
  sweep is implemented; the shipped default is off, because honouring a
  never-observed `true` + `daily` would switch a daily nag on for every lab.
- **The password rule existed three times with two answers** — creating a user
  needed 8 characters, an admin reset accepted "a". One shared rule.
- **The QC subsystem was built and unreachable.** The panel now renders it.
- **The billing currency setting promised multi-currency** across 53 hardcoded
  PKR sites it never read. The control and its permission are gone.
- **`ReportsView`'s journal inspector could never open** — now wired from the
  voucher row.
- **`CatalogView` validated `leadDays` but never rendered the message**, so Save
  did nothing with no field marked.

### Design
- `src/theme/shell.css`: one component layer for the nav rail, header and dock,
  reading the same tokens the dashboard panels already use. Repointing a token
  now moves all three together.
- Header and sidebar rebuilt on it. Search results became real buttons (they
  were clickable divs, unreachable by keyboard), the popover lost three
  competing hover hues, a skip link was added, and the active nav row carries
  one signal instead of a pill plus a bar.
- Five hand-rolled modal overlays moved onto a shared modal primitive. Each
  gains Escape, a focus trap and `role="dialog"` / `aria-modal`, none of which
  they had.

### Consolidation
- `DataTable` went from 1 call site to 18 — every screen table. It used to draw
  its own card, which made adopting it produce card-in-card, so it now renders a
  bare table and each view keeps the card it already had. Added a `tfoot` slot,
  which three callers had been faking with a second `<table>`.
- 11 drifted `<thead>` variants folded into one shared header style; 23 PKR
  sites now format through one helper (display only — persisted audit text is
  byte-identical, so existing clinics' records read the same).
- Fourteen hand-rolled toast timers replaced by one `useTransient` primitive;
  their `setTimeout`s were never cleared on unmount.
- Dropped the unused `tsx` dependency and its pinned esbuild binary. The binary
  guard now runs in the Windows CI job instead of silently skipping on ubuntu.

### Gates
113 test files / 959 tests, tsc, lint + binary-guard, 153 colour pairings clear
WCAG AA in both themes across all five interaction states, 0 ink-on-dark-bar
sites, 0 inline hardcoded surfaces, production build.

## [2.24.0] - 2026-10-14

A production-readiness audit of the 2.23.0 build (18 phases) found four
reachable defects and several packaging gaps. All were fixed and verified
against a real release build, a real install, and a real upgrade.

### Security
- **`db_load` no longer accepts a path.** It took `path: Option<String>` and
  `resolve_db_path` returned it unchecked; because `Connection::open` creates a
  missing file, that was a primitive for creating or overwriting any path the
  process can write. Removed rather than validated — nothing ever passed one.
- **`db_backup_file` no longer accepts a destination.** Same shape:
  `fs::copy` straight into a caller-chosen path. Also unused — `BackupTab`
  exports through `save_file_bytes` and the native save dialog.
- **Patient data no longer written to the console.** `triggerAgentWorkflow`
  logged `(event, payload)` and callers passed whole case records, so every
  `CASE_CREATED` wrote a `patient_name` into a sink with no user-facing way to
  clear it. Fixed at the single funnel; the event name is kept.
- **Removed `core:webview:allow-internal-toggle-devtools`.** Zero call sites,
  no documented reason — it only let injected script open devtools against a
  database of patient records.
- **Cleared 5 dependency advisories.** `source-map-js` 1.2.1 → 1.2.2
  (build-time only, absent from `dist`) and four rustls advisories in 0.23.45
  — the TLS library used to download updates — fixed by 0.23.46.

### Added
- **Single-instance protection.** Nothing stopped a second copy of the app from
  starting; I launched it twice and both ran. Because persistence is
  whole-file read-modify-write, two instances are last-writer-wins: a
  double-click on the shortcut could silently drop a case, invoice or payment.
  The second launch now focuses the running window.
- **CI scans dependencies.** A `security` job audits npm *and* cargo, and the
  release job now depends on it. Previously no audit of any kind ran, which is
  why the advisories above needed a human to find them.
- **`THIRD_PARTY_NOTICES.md` ships with the installer.** Every bundled
  dependency is MIT/ISC/Apache-2.0, which carries an attribution obligation
  that the installer did not previously meet.

### Changed
- **The Create Case wizard's first step was restructured.** Its four fields sat
  in a bordered card inside the modal's own surface — three nested planes for
  very little work. The inner card is gone, the section carried two labels
  (`Referral` and `WHO & WHAT`) for one thing and now has one, the step name
  appeared twice on desktop and no longer does, and the patient placeholder no
  longer repeats the required marker.
- **Create Case and the odontogram obey the operator's brand colour.** Both
  carried hardcoded `indigo-*` values, so a white-label install rendered the
  vendor's purple instead of the lab's own colour.
- Six Vite warnings eliminated: modules dynamically imported in one file and
  statically in another, so the lazy-load boundary never existed. Six to zero.
- `src-tauri/gen/` (330 KB of generated schemas) is no longer tracked.

### Fixed
- The odontogram could clip its mandibular arch at short window heights.
- `STATIC_VCRUNTIME` is set through `tauri_build::WindowsAttributes` instead of
  a config key this project's CLI rejects. The shipped binary continues to
  import none of `VCRUNTIME140.dll` / `MSVCP140.dll`, so a clinic PC without
  the Visual C++ Redistributable can still launch it.

### Verified
Release build, PE import table, clean-machine first launch from an empty
profile, and a 2.23.0 → 2.24.0 upgrade over an existing install with the clinic
database byte-identical afterwards. 908 tests.

### Known
- The installer is **unsigned**, so Windows SmartScreen warns on first run.
- The installer downloads the WebView2 Runtime at install time, so an offline
  machine cannot install. Embedding it would fix that at the cost of taking the
  installer from 3.75 MB to 210 MB — a deliberate trade, pinned by a test.
- The bundle identifier keeps its `.app` suffix. Changing it would break the
  registry uninstall key, the update channel, and `%APPDATA%\pk.dentalsolutions.app`.

### Added
- **Material categories are now operator-managed, in their own tab.**
  `Price List & Catalog` gained a third tab beside *Materials & Pricing* and
  *SLA & Priority*. Categories were a hardcoded five-element array inside
  `CatalogView.tsx` with a TS union mirroring it, so adding one meant editing a
  component and rebuilding, renaming was impossible, and the label existed in two
  places that disagreed (`Implant Abutment` in the form dropdown vs
  `Implant Prosthetics` on the filter pill). The saved list now feeds both, so
  one row is the single source of the label.

  **Migration 023** creates `catalog_categories` and **rebuilds `case_types`**.
  The rebuild was unavoidable: `category` carried a SQL `CHECK` of the five
  literal values, and SQLite has no `ALTER CONSTRAINT`. Left in place, a new
  category would have appeared in the dropdown and then thrown
  `CHECK constraint failed` on every material saved into it.

  The rebuild is dangerous in a way that is easy to miss — `lab_pricing_overrides`
  references `case_types(id) ON DELETE CASCADE`, and this engine sets
  `foreign_keys = ON`, so a `DROP TABLE` would destroy negotiated pricing. A
  migration that rebuilds a table now declares `rebuildsTable: true`; the runner
  suspends FK enforcement for that migration only and runs
  `PRAGMA foreign_key_check` before committing.

  Deleting a category has **three paths**, all three reachable: free when unused;
  **blocked and naming the blocking materials** when in use; **reassign** them to
  another category first; or a type-to-confirm **cascade** that removes the
  materials too. Block is the default and cascade is a separately-named repo call,
  so the destructive path is visible in a diff rather than a flag someone can flip.

- **SLA turnaround per priority is a global, editable setting.**
  `PRIORITY_SLA_DAYS` was a frozen constant, so the turnaround a clinic quoted
  could only be changed by editing and rebuilding the app. The *SLA & Priority*
  tab persists the map (`settingsRepo`, `sla` namespace) and it governs every
  case: the wizard's delivery date, the priority cards, and the Analytics
  turnaround report. The export is now a live proxy — as a frozen object every
  importer captured module-load values and kept them after a save, so a live edit
  would have updated the form and nothing else.

### Fixed
- **A new case no longer starts with two teeth charted.** `[11, 21]` was
  hardcoded in three places — the wizard, saved templates, and the clinic
  quick-entry — so a brand-new case was born with two teeth nobody selected, and
  they then reached the odontogram, `tooth_details`, the job slip, the invoice
  and the billable-unit count. All three now start empty.
- **A case price is now the base price × the charted units.** It used to copy the
  catalog base price verbatim regardless of unit count, so a 3-unit bridge was
  quoted at the single-unit rate. New cases only: re-deriving on a saved case
  would restate a price a clinic may already have paid or been quoted.
- **A shade picked once now applies to the whole selection.** `applyShade` wrote
  to the inspected tooth alone, so one click on a 3-unit job produced three
  different shades and the inspector then showed the shade that had *not* been
  picked. A single-tooth case still allows a deliberate per-tooth override.
- **`Unit Basis` is a dropdown.** It was a free-text box, so `'per unit'`,
  `'Per-Unit'` and `'per  unit '` were four stored strings for one concept that
  nothing downstream could rely on.
- **`reassignProducts` reported the wrong count.** It derived the number moved
  from the change in the *total* product count, which is always 0 on a reassign.
- **Reassigning and cascading a category were undone by autosave.** Both wrote
  only to SQLite, but `syncCollectionsToDb` rebuilds `case_types` from React
  state on every autosave, so the products snapped back into the category that no
  longer existed. Both now update the UI mirror in the same turn.
- **The dark theme showed an invisible hover state on a new button.** `dark.css`
  remaps `amber-900` to a pale cream (it is primarily a *text* colour on a
  dark-amber surface), and `bg-amber-800` had a dark-mode override that
  `bg-amber-900` did not. White text on that hover measured **1.06:1**; it is now
  8.74:1. Caught by the CI contrast audit before release.
- **The material form lost saved data on every rename.** Fields removed from the
  form were still sent as empty strings, which erased whatever a seeded or
  previously-edited product had on file the moment anyone touched its name. They
  are now absent from the payload, and `caseTypesRepo.update` only writes keys
  that are present.
- **Dark mode was unreadable in the settings tabs.** Two root causes:
  `applyBrandColor()` wrote `--brand-50/100/200` as inline styles on `<html>`,
  which is the same element `theme.ts` toggles `.dark` on — inline outranks the
  stylesheet, so the entire dark-mode brand remap was dead code and a chosen
  accent sat at 1.03:1 on its own name field. Each swatch now carries its own
  dark tint set, re-synced on theme change. Separately, `.dark .border-slate-200`
  sat at ~1.18:1 against the input fill; `-200`/`-300` were raised. Light mode
  was deliberately left alone — same ratio, but changing it restyles every card
  and field app-wide.
- **Three settings icons were invisible on saturated buttons** (1.58–1.70:1)
  because they carried their own accent on a filled button. They now inherit
  `text-white`.
- **The batch statement's `Date` column now shows the received date**, falling
  back to the invoice date when no case is linked, and its case block no longer
  repeats shade and received date. A single invoice now renders the same
  `CASE DETAILS` block — it had been using a separate inline lookup that
  matched on `||` across unrelated fields, so it disagreed with batch print.

### Changed
- **Reports & Statements now lives only under Analytics & Reports.**
  `Analytics & Reports` became a tabbed view
  (`src/components/reports/ReportsView.tsx`) — Overview, Clinic Accounts,
  General Ledger, Audit Trail, Reports & Statements — each tab carrying its own
  modals (collect payment, clinic statement, journal inspector, invoice
  statement, case job slip), so nothing lost an action on the way. The duplicate
  `Reports & Statements` tab is gone from `BillingView`, which keeps Invoices &
  Receivables, Payments & Transactions, Clinic Accounts, General Ledger and
  Audit Trail, and its header now points readers at Analytics & Reports instead
  of advertising an archive it no longer owns.

### Fixed
- **The journal inspector now reports the variance it actually has.**
  `JournalEntryModal` rendered a hardcoded "Variance: PKR 0.00" banner, so an
  unbalanced posting was presented to the auditor as mathematically verified.
  The banner now computes debit and credit totals from the entry's own lines,
  states the real difference and its direction, and turns red when the entry
  does not balance — gated by the same `assertJournalBalanced` rule
  `postJournal` accepts, so the screen cannot disagree with the ledger.
- **A batch print now confirms what it logged.** `BulkPrintModal` kept its
  save-success state in a discarded boolean that nothing rendered, so after
  printing a batch there was no sign the vouchers had been recorded. The
  footer now announces "N job slips/invoices logged to billing history" for a
  few seconds beside the print controls.
- **The template library has a close control again.** `CaseTemplateModal`
  declared an `onClose` prop it never read; the only way to dismiss it was a
  separate ✕ drawn by `CaseListView` outside the dialog. The modal owns its
  own single close button now, like every other dialog in the app.
- **A lab address's country can be edited.** `LabContactsManager` held
  `country` as a setter-less constant with no input, so every saved address
  silently stamped the same value with no way to correct it. Country is a
  real, validated field now.
- **A batch print that outgrew one page no longer slices rows in half.**
  `BatchInvoicePrintModal` emitted the whole selection as a single sheet, so
  past about a dozen invoices the table ran past the bottom of the paper and the
  browser cut it mid-row: the clinic got a statement with an orphaned line item
  and no totals. New `src/services/statementPagination.ts` splits the selection
  into sheets that each fit the chosen paper and font scale, weighting a row by
  whether its case carries the detail block (one unit bare, three with detail).
  Each sheet repeats the statement header, is numbered `Page n of m`, and the
  balance block prints on the final sheet only — over the whole run, so adding
  up the printed pages still reconciles. A row heavier than a whole sheet gets
  its own page instead of being dropped.
- **A system reset no longer leaves money rows behind.** `payment_allocations`
  (invoice → payment allocations written by `paymentsRepo`) and the legacy
  `ledger_entries` mirror belonged to no writer and no rebuilder: the
  collection sync never touched `payment_allocations` and the reset never
  deleted it, so resetting the system left every allocation in place pointing
  at payments and invoices that no longer existed. `payment_allocations` is now
  emptied and rebuilt with the payments in `syncNow` (exactly as
  `advance_allocations` already was), and `ledger_entries` is part of
  `WIPE_EXPLICIT_TABLES`.
- **The batch-print pagination tests no longer expire after one day.**
  `tests/components/batchInvoicePrintPaging.test.tsx` dated its 40 fixture
  invoices `2026-10-10` while the modal opens on the *Today* period and filters
  the batch by `issue_date`. The day after that hard-coded date every sheet came
  back empty and all four assertions failed — a red suite on a test that had
  never actually been wrong. The fixture now derives today the way its sibling
  `tests/components/batchPrintCaseDetail.test.tsx` already did, so the file
  tests the packer instead of the calendar.

### Testing
- **`tests/db/systemReset.test.ts`** fills every business table the app writes —
  cases, teeth, invoices, items, payments, proof attachments, allocations,
  advances, adjustments, journals and lines, QC, notifications, audit, vouchers,
  templates — performs the reset exactly as `wipeAllData` performs it, then
  asserts the sync did not abort, the integrity check still passes, and no
  business row survived. A second test pins the allocation round-trip through an
  ordinary autosave.
- **`tests/components/batchInvoicePrintPaging.test.tsx`** renders the modal over
  40 detail-carrying invoices and asserts the batch spans exactly five sheets,
  prints every invoice once in order, carries the balance block on the last
  sheet only, and numbers the sheets. `tests/services/statementPagination.test.ts`
  covers the packer itself, including the balance-block reservation on the final
  sheet and the oversized-row case.

### Removed
- **The 100k scale guard and the wall-clock budget suite.** `syncScale100k`
  (100,000 cases + 100,000 invoices), `syncScale` (10k) and `autosaveScale`
  are deleted, along with `vitest.scale.config.ts` and the `test:scale` script
  that `npm test` chained after the main suite. None of them ran in the app or
  the dev server — they were test-only, gated behind `npm test` — so this
  shortens the test run and removes nothing from the shipped product. The
  2.20.0 prepared-statement cache that took a 10k sync from ~3110 ms to
  ~1190 ms stays; only the assertions around it are gone. `npm test` is now a
  single `vitest run` with no scale exclude list.
- **Three audit scripts nothing could run, and two assertions nothing could
  fail.** `scripts/audit-column-coverage.mjs`, `scripts/audit-swallows.mjs` and
  `scripts/audit-untransactional.mjs` had no npm script, no CI step and no git
  hook — no code path could reach them, so they were documentation wearing
  tooling's clothes. Their findings are already recorded in
  `docs/sqlite-persistence-audit.md`, which now calls them the one-off sweeps
  they were rather than advertising a way to re-run them. Two dead assertions
  went with them: `tests/services/updateInstaller.test.ts` checked
  `typeof offA`/`offB` was `'function'` on the two lines *after* invoking them
  (a non-function would already have thrown), and
  `tests/db/syncSchemaCoverage.test.ts` carried an `it()` whose sole assertion
  was byte-identical to the one directly above it. No real assertion is
  touched — the suite drops by exactly one test.

### Verified
- `tsc --noEmit` and the full `vitest` suite pass after the removal; CI runs
  `npm test`, so it picks the change up with no workflow edit. Suite total is
  now 775 tests across 94 files; the batch-print split sheets, their
  `Page n of m` numbering and the final-sheet totals were also confirmed in the
  running app, and the Billing tab strip no longer lists Reports & Statements.

### Changed
- **`tsc` now fails on dead code.** `noUnusedLocals` and `noUnusedParameters`
  are on in `tsconfig.json`, so an unused import, an unused local or an unread
  destructured field is a build error instead of silence. Turning them on
  exposed 211 violations across 74 files, all now removed — the leftovers of
  the domain-hook extraction in `AppContext.tsx` (27 imports it stopped using),
  the icon imports the tab extraction stranded in `BillingView` and
  `AuditLogView`, and the `React` default import that `"jsx": "react-jsx"`
  made redundant in 17 test files. Every one was a deletion, not a rename or a
  `void`: the compiler proved each was unread, so nothing that ran stops
  running. A dead state that hid a real defect went with them — `BatchInvoicePrintModal`
  loaded its invoice section list on every open and discarded it.

### Removed
- **Three files nothing imported.** `src/services/attachmentService.ts` (its
  only mention in the repo was a line of prose in `README.md`, since corrected
  to name the validation service that is actually wired up),
  `src/components/common/ui/StatCard.tsx` (reachable only through the barrel's
  `export *`, never through a component) and
  `src/components/dashboard/ClinicStatementModal.tsx`, a 45-line pass-through
  that no longer had a caller after the clinic statement moved to Billing.
- **`motion`, `autoprefixer` and `@types/express` are not dependencies.**
  `motion` was a *production* dependency with a `manualChunks` rule in
  `vite.config.ts` and no import anywhere — the rule could never match, and
  every animation in the app is CSS. `autoprefixer` had no `postcss.config.*`
  to run under Tailwind v4, and `@types/express` outlived `express` itself.
- **The exports, context values, props and CSS that nothing reached.** About
  fifty exports with no reference outside their own declaration (including
  `getTomorrowStr`, `getYesterdayStr`, the whole `sqliteStorage` localStorage
  era, and three repository wrappers whose tables are still written by other
  code), 24 context members no component ever destructured, 13 props no caller
  ever passed, and the `.ds-live-dot` animation with the tokens and dark-theme
  remaps behind it. `ConfirmationModal` is now unreachable dead UI — removing
  `confirmAction` removed its only trigger — and is left in place rather than
  deleted on a judgement call.

### Documentation
- **The documentation set now links only to files that exist.** `README.md`'s
  Documentation list pointed at four files that were never committed
  (`docs/ARCHITECTURE_AUDIT.md`, `docs/MIGRATION_AUDIT.md`,
  `docs/DATA_MIGRATION_REPORT.md`, `docs/MIGRATION_PROGRESS.md`). It now lists
  what is actually there — `docs/DATABASE.md`,
  `docs/sqlite-persistence-audit.md`, `docs/SMOKE_TEST_CHECKLIST.md` and the two
  `reports/impeccable-*.md` UI audits, which nothing reachable linked to before.
  All 46 relative links in `docs/sqlite-persistence-audit.md` and all 19 in
  `reports/impeccable-dashboard-audit.md` were missing their `../` hop and so
  resolved to `docs/src/…` and `reports/src/…`; every target does exist at the
  repo root, and all 65 now resolve.
- **`docs/DATABASE.md` was describing a build that no longer exists.** It
  claimed five migrations and a "Schema (v5)" (there are 22, the latest being
  `022_drop_ledger_entries`); that browser snapshots went to the single
  localStorage key `dsw_sqlite_snapshot` (IndexedDB is primary and localStorage
  is the legacy fallback, for exactly the ~3.7 MB quota ceiling the audit
  documented); that Tauri was "a future desktop shell" (Tauri 2 ships, and CI
  builds the NSIS installer on every release); and that seeding created four
  users with hashed passwords (the app ships zero accounts —
  `tests/db/firstRunAdmin.test.ts` asserts `usersRepo.count()` is 0, and the
  operator's Super Admin is created by the login screen's first-run setup). Its
  proof-of-restore pointer moved from `tests/db/persistence.test.ts` to the
  backup suites `tests/services/backup.test.ts`, `backupRestore.test.ts` and
  `backupRestoreSafety.test.ts`, with `persistence.test.ts` kept for the
  engine-level snapshot round-trip it actually covers.
- **Smoke-test step 2 was a step that could never pass.**
  `docs/SMOKE_TEST_CHECKLIST.md` told the operator to log in with "the
  documented bootstrap credentials" and then change each bootstrap password; on
  a fresh install there is nothing to log in with. It now walks the real
  first-run flow — the "Create the administrator" form, the 8-character minimum,
  the confirmation toast, and the Super Admin role the first account receives.
- **`.gitignore` stopped ignoring a toolchain that never existed here.**
  `bun.lock` and `metadata.json` (under an "AI Studio export artifacts" heading)
  and `src-tauri/gen/schemas/` (where `src-tauri/gen` does not exist) are gone.
  All four `.env*` patterns are deliberately untouched — narrowing those risks
  committing a secret — and `coverage/` stays.

## [2.20.0] — 2026-10-10

### Performance
- **A 10,000-case sync no longer stalls the window.** The full sync of cases
  and invoices dropped from ~3110 ms to ~1190 ms. `SqliteEngine` now keeps a
  bounded cache of prepared statements keyed by SQL text, so the per-row upsert
  loop stops re-parsing the same statement tens of thousands of times. Only
  parameterised statements without a trailing `;` are cached; a statement that
  throws is dropped and freed rather than reused, and the cache is released on
  `dispose()`.
- **The autosave benchmark now measures the real encoder.** The scale test
  carried its own stale copy of the base64 routine, so it was timing code the
  app never ran. It imports the shipped implementation instead, covered by
  `tests/db/base64.test.ts`.

### Testing
- **Wall-clock budgets get an uncontended run.** `syncScale` and `autosaveScale`
  assert main-thread budgets, so running them beside the other 84 test files
  (86 Vitest workers) made a correct 1190 ms sync read as ~2600 ms and failed
  them for contention they cannot control. They now run through
  `vitest.scale.config.ts` on a single worker via `npm run test:scale`, which
  `npm test` chains after the main suite. The budgets and assertions are
  unchanged — only the contention is gone.
- **Merged from `vite.config.ts`** rather than standalone, so tests keep the
  React plugin, the `@` alias and the `__APP_VERSION__` define, plus a
  persistent transform cache.

## [2.19.0] — 2026-10-09

### Added
- **Dental Clinics has a List view.** A Cards / List toggle next to the search
  bar — the same contract as the workstation case list, persisted per operator.
  List mode is a dense directory: Dental Clinic, Doctor, Phone, Email, Address,
  Cases, Latest Case and View, with the existing sort selector and search
  applying to both modes and a shared empty state.
- **A real Monthly Statement in Reports & Statements.** The old "Monthly
  Billing Breakdown" grouped invoices by the month the invoice was *created* and
  called `Σ invoice.amount_paid` "Collected", which misstated a clinic
  statement three ways: a payment landing in month M against an invoice raised
  in M−3 never appeared in M, `amount_paid` is a lifetime figure so it was
  filed in the wrong month, and advance deposits and credit notes were invisible.
  `services/monthlyStatement` now dates every figure to the month the money
  actually moved and carries the balance forward:
  `closing = opening + billed − collected − advance_received + advance_applied
  − credit_notes + debit_adjustments`. Each month shows per-clinic Opening (B/F),
  Closing (C/F), advance wallet and Remaining Due, plus a reconciling MONTH
  TOTAL footer, and the CSV export now goes through the app's own exporter (the
  old inline `<a download>` wrote nothing inside the Tauri shell).

### Fixed
- **Clinic statements printed PKR 0.** The statement card read
  `netOutstanding` / `advanceCreditBalance`, but `buildLabFinancialSummary`
  publishes `net_balance` / `advance_balance` / `outstanding_balance`; the
  camelCase names are optional legacy aliases and were always `undefined`. It
  now reads the authoritative fields, with the aliases kept as a fallback.
- **A statement you could not add up by hand.** The card printed the *selected
  period's* debits and credits beside the *all-time* closing balance. It now
  derives the period's own figures from the ledger's `running_balance` (a true
  all-time running total that already nets advances, credit notes and
  adjustments): Opening Balance (B/F) is the balance of the newest row dated
  before the window, Closing Balance (C/F) the balance of the newest row inside
  it, Advance Credit in Wallet is deposits banked minus advance already spent as
  at period end, and Remaining Due is `max(0, closing)`. The Period filter's end
  is now end-of-day, so a payment booked earlier today is no longer dropped.

### Changed
- **The Type column of every statement — and its CSV — was blank.** The modal
  rendered `entry.type`, a legacy alias the ledger engine never populates (it
  emits `entry_type`), so `LedgerEntry.type` was `undefined` on every real row.
- **Case detail on money lines is now identity, not inventory.** `Patient`,
  `Procedure`, `Teeth`, `Shade`, `Received Date`, `Delivery Date` — doctor,
  material and units belong to the case record, not the ledger line, and a
  missing value drops its row instead of printing a placeholder. Received and
  delivery are formatted separately so a promised future day is never read as
  the day the job came in.
- **The invoice drawer's case card uses the same formatter** as the general
  ledger, the clinic statement, their CSV and PDF, so the invoice and the
  statement can no longer disagree about the job an invoice is booked against.

## [2.17.0]

### Changed
- **The installer banner is gone and the app updates itself.** The old
  "a newer installer is available" banner only opened a download in the system
  browser, and the native `update_install` command did the opposite of what it
  looked like: it launched the NSIS installer *and* called `app.exit(0)` in the
  same invocation, so the app closed mid-session with no prompt and no chance to
  decline. `update_install` now **only stages** — stream, verify SHA-256 while
  streaming, back up the database, write a stage receipt — and never executes
  or exits.
- **After an update the app asks before it restarts.** A new `update_apply`
  command is the only path that closes the app, and only the **Restart & Apply
  Updates** button calls it. It flushes SQLite first (awaited, not
  fire-and-forget), re-hashes the staged installer against the receipt checksum
  and fails closed, then hands off to a detached waiter that runs the silent
  install and relaunches from the registered install location. *Not now* calls
  the new `update_discard`, which deletes both the staged file and the receipt.
- **New auto-installer panel** (`AutoUpdatePanel`) — the app's only update
  surface, in two layouts sharing one phase machine: a floating
  bottom-centre card during download, and the full view in Settings →
  Software Updates with a five-step checklist (check / download / verify /
  backup / ready), the last-check state, the stage receipt and the history log.
  Progress events carry a `stage` field, so verification and backup are visible
  instead of an opaque spinner. The panel is silent when there is nothing to say.
- **The stage receipt is now reconciled three ways at boot.** Settled → record
  "Updated to vX" once per version; pending with the installer still on disk →
  offer the restart without re-downloading; pending with the file gone →
  report the update as *interrupted* rather than asking the user to close the
  app for an installer that no longer exists.

### Removed
- `UpdateBanner` and `UpdateStatusPill` — the browser hand-off and the
  duplicate update surface.

### Fixed
- **The desktop window can be closed again.** Every window mutation the UI
  makes was denied at runtime: `core:window:default` grants read-only access
  plus `internal-toggle-maximize`, so `close()`, `destroy()`, `minimize()` and
  `toggleMaximize()` all rejected with an ACL error. The header's close button
  did nothing, and because the close-request flush in `persistence.ts` ends in
  `destroy()`, the window could not be closed at all while a debounced SQLite
  write was pending. The four mutations are now granted explicitly, and
  `tests/lib/tauriWindowPermissions.test.ts` fails the suite whenever a window
  method is called without its permission — this class of bug is silent in
  tsc, vitest and the production build, so it needs a standing guard.
- **Sessions are revoked when a user's authority changes** (audit finding S5).
  A role change, deactivation or password reset now drops that user's existing
  sessions, so an already-minted token cannot outlive the privilege it was
  granted for.

### Changed
- **Empty states in the audit log and both reports tabs now use the shared
  `EmptyState`** instead of ad-hoc text, matching the invoices, register and
  ledger tabs.
- **11px meta text on light surfaces raised from `text-slate-400` to
  `text-slate-500`** (27 sites across billing and settings). Slate-400 is
  below AA contrast for text that size on white. Sites on dark, branded or
  user-chosen backgrounds keep the dimmer colour, where it is the correct
  choice — a mechanical sweep of the remaining ~120 sites would regress them.

### Known issues
- The `verify-release` CI gate is still red, and it is **not** an artifact
  problem. It has failed on every tag since it was introduced in v2.12.2, in
  0–1 s, with `Process completed with exit code 1` and no `::error::`
  annotation — so it dies at its first command and never reaches its own
  `fail()` helper. Artifacts were verified by hand on every tag and are
  healthy. A temporary `release-probe` job plus an `ERR` trap now publish the
  failing command as a check-run annotation for the next tag run. See
  `.planning/settings-redesign/TODO.md`.

## [2.14.2] — 2026-10-01

### Fixed
- **`verify-release` now extracts the manifest digest with bash's own ERE
  matcher.** The 2.14.1 attempt to fix the comparison replaced a `cut -d: -f2`
  with a `sed` substitution whose BRE group was written unescaped — `(...)`
  instead of `\(...\)` — so `\1` was an invalid reference, sed exited non-zero
  under `set -e`, `MANIFEST_SHA` came back empty, and the gate failed on v2.14.1
  with byte-perfect artifacts. The digest is now read by `[[ … =~ … ]]` with an
  explicit capture group, behind a 64-character length guard, so an extractor
  that silently matches nothing can never again be mistaken for a read.

### Verified
- Replayed the whole step against the live release: manifest `2.14.1`,
  `Dental.Solutions_2.14.1_x64-setup.exe` (3,872,478 bytes), manifest digest
  `96ecb3c3…`, asset bytes and `SHA256SUMS.txt` all identical — the 2.14.1
  artifacts were healthy; only the extractor was broken.

No application code changed in this patch either — the 2.14.0/2.14.1 installer
and this one contain the same build.

## [2.14.1] — 2026-10-01

### Fixed
- **The release verification gate can now actually pass** — `verify-release`
  compared the manifest's `payload_checksum` against the uploaded installer by
  taking the second colon-separated field of `"payload_checksum":
  "sha256:<hex>"`, which yields the literal string ` sha256`. The comparison
  could never succeed, which is why v2.12.2, v2.12.4, v2.13.0 and v2.14.0 all
  reported a failed release job while every artifact was byte-perfect. The
  digest is now extracted by pattern (pinned locally against the live manifest
  and the real asset bytes), and every failure prints the manifest and release
  JSON, because job logs need repo admin rights to download.

No application code changed in this patch — the 2.14.0 installer and this one
contain the same build.

## [2.14.0] — 2026-10-01

### Added
- **Settings → Notifications & Templates (D1)** — the reminder cadence that
  `notification_config` had always stored now has a reader: overdue-case and
  outstanding-invoice frequencies, escalation threshold and repeat interval
  are editable, and the app's sweeps honour them immediately. The four
  `email_templates` rows are editable with a live, real-data preview and
  copy-to-clipboard (this workstation has no mail server, and the UI says so).
  Past the last ticked reminder the sweep keeps reminding, so a receivable can
  never silently drop off the tray.
- **Brand accent (D7)** — `branding.primaryColor` was stored and then ignored
  by every surface. It is now the app's single accent, chosen from six
  contrast-checked swatches (white text on the solid shade ≥ 4.5:1), written
  to `--brand-600` on boot, and resolvable as a real Tailwind colour. An
  unknown or legacy stored value falls back to indigo; print ink is untouched.
- **Labelled preview canvas (D8)** — one `PreviewFrame` gives every Settings
  preview a caption and an artefact name, replacing the unlabelled block; the
  print tab previews the actual sheet shape, margins, text scale and section
  order from the draft settings.
- **One dialog shell (V-19)** — `Modal`, `Drawer` and `ConfirmDialog` now live
  in `common/ui` and own the backdrop, `role="dialog"`/`aria-modal`, Escape,
  focus trap and focus restore. All eight Billing dialogs and the invoice
  drawer were migrated onto them (their print cards still carry `print-area`
  as the outermost element), so dialog chrome can no longer drift per screen.
- **One invoice status chip (V-18)** — `InvoiceStatusBadge` maps every invoice
  state to a single chip (emerald paid · amber partial · rose overdue · sky
  open · slate draft/void), so the same state cannot read differently in the
  list, the drawer and the register.
- **Component test infrastructure (D5)** — `@testing-library/react` + `jsdom`
  (dev-only) with 11 new DOM-level tests pinning the dialog contract that the
  service tests cannot reach: dialog semantics, Escape, Tab containment, focus
  restore, top-dialog arbitration and the typed-phrase guard.

### Changed
- **Settings layout (D9)** — Settings is a grouped, permission-aware 240px rail
  at 1280px and up, with the existing segmented control below that width. Both
  layouts render from one tab registry, so a permission change can no longer
  hide a tab in one layout while leaving it reachable in the other.
- **Currency changes are guarded (D6)** — the billing currency is admin-only,
  asks for confirmation that names the screens it repaints (invoices, receipts,
  statements, register, ledger, reports, dashboard), and writes an audit entry
  naming the from/to values.
- **Accessibility pass on Billing** — icon-only controls carry `aria-label`
  alongside their tooltips, filter counts announce through `aria-live` with
  `aria-pressed` state, and the invoice drawer traps focus while it is open.
- **Honest update sources** — the published GitHub Pages manifest URL was
  tried on every update check and always 404'd (Pages is not enabled for this
  repo); the raw gh-pages URL remains the single source, with the Releases API
  as fallback.

### Verified
- `tsc --noEmit`, `vitest` (296 tests / 39 files, including the new dialog,
  brand-accent and reminder-cadence suites) and the production build are green;
  Settings and Billing click-through on the built bundle with zero console
  errors.

## [2.13.0] — 2026-10-01

### Fixed
- **Invoice & document print settings now actually apply** — paper size,
  margins, font scale, logo position and every per-document section toggle
  were silently ignored: the settings reader `JSON.parse`d a value the repo
  had already parsed, so the load always threw and fell back to defaults
  while the UI still said "Saved — applies to all documents". Print settings
  now round-trip (test-pinned), the writer no longer double-encodes, and rows
  written by older builds are migrated on read.
- **Invoice numbers can no longer be minted twice** — invoice numbers were
  generated from a render closure, so two creations in one render window
  produced the same `INV-n`, and the resulting `UNIQUE` failure aborted the
  whole SQLite sync (later work survived only in memory). Numbers are now
  reserved from a monotonic high-water mark, mirroring the payment/advance
  fix in 2.12.4; voided or reversed numbers stay retired.
- **Restore is now enforced, not suggested** — `Restore backup` takes the
  safety snapshot first and *blocks* the restore if that snapshot cannot be
  written, so a bad backup can no longer overwrite the only copy of live
  data.
- **Malformed CSV exports** — invoices, statements and register exports go
  through one RFC-4180 writer (correct quoting of commas/quotes/newlines,
  CRLF rows, UTF-8 BOM so Excel opens PKR amounts and Urdu names correctly)
  instead of the previous `encodeURI` data-URL and naive quote doubling.
- **Payment-proof uploads are validated** — attachments are checked against a
  2 MB / image-or-PDF allowance before they are base64'd into SQLite, with an
  inline error instead of a silent oversized write. The same guard protects
  the branding logo upload.

### Changed
- **Role gating across Billing** — a locked permission matrix now gates every
  money action: Super Admin / Lab Admin can do everything; Billing Manager can
  make every money post but cannot void an invoice or post a reversal;
  Technician cannot post at all. System-mutating settings tabs require a
  system-management permission.
- **Real confirmation dialogs** — voiding an invoice and bulk-settling now use
  an in-app dialog that lists the consequences (ledger reversal, retired
  number, audit entry); voiding additionally requires typing `VOID`. Native
  `confirm()` is gone from Billing.
- **Inline errors instead of `alert()`** — validation and posting failures in
  the record-transaction dialog surface in an aria-live banner in the
  dialog footer, matching the reversal dialog's inline discipline.
- **Per-user preferences** — UI preferences (zoom, density, preferred tab)
  moved from one global blob to a `user_preferences` table (migration 014),
  so two operators on one machine no longer overwrite each other; existing
  global values are adopted on first load.
- **Dead and duplicate surfaces removed** — the unreachable
  `AccountsFinancialHome` screen (719 LOC) is retired, with its one unique
  capability (applying unallocated advance credit to an invoice) folded into
  the invoice drawer; the dashboard's divergent print-only statement modal now
  renders the single shared statement implementation.
- **Visual + accessibility normalization in Billing** — no sub-11px text left
  in the module, money columns use tabular figures, every table header carries
  `scope="col"`, every modal is a real `role="dialog"` (with Escape to close
  on the invoice drawer), destructive actions use one rose palette, and status
  chips keep their existing wording.
- **Honest update copy** — the removed offline `.dentalupdate` import is no
  longer advertised in Settings → Updates or in the changelog history.

### Verified
- `tsc --noEmit`, `vitest` (273 tests / 36 files, including new suites for
  print settings, invoice numbering, CSV export, file validation and the
  permission matrix) and the production build are green; live click-through of
  all five Billing tabs on the built bundle with zero console errors.

## [2.12.4] — 2026-10-01

### Fixed
- **Payment & document numbers can no longer collide** — numbers are now
  generated from the highest number ever issued (max-scan) instead of row
  counts, for PAY/REC/ADV/CR and invoice/case sequences; a reversed or
  voided document's number stays retired. A payment split across several
  invoices stores one payment row per slice with a distinct number
  (`PAY-<year>-NNNN-1`, `-2`, …) instead of reusing the same number, which
  used to abort the entire SQLite sync with
  `UNIQUE constraint failed: payments.payment_number`.
- **Sync heals duplicates instead of failing** — one bad row no longer
  blocks persistence of everything else: duplicate payment/advance/invoice/
  case numbers get a deterministic `-D2` suffix, orphan QC rows are skipped,
  and duplicate case teeth are deduped, so the
  "Database sync failed — your changes are at risk" banner stops appearing
  for previously-poisoned databases.
- **Money-path guards** — deleting a case with active payments is refused
  (reverse first); deleting a lab with cases re-assigns them to a chosen
  clinic; repricing an invoice reverses and re-issues its double-entry
  journal; double-clicking "Post Transaction" can no longer create two
  payments; batch printing logs each invoice voucher exactly once.
- **Quit-time save window** — closing the desktop app now flushes the
  pending debounced SQLite write (bounded by a 3 s guard) before teardown,
  and a 5 s periodic checkpoint shrinks the unsaved window during normal
  use.
- **Updater honesty** — a lost stage receipt no longer produces a false
  "close the application so it can install" banner: the receipt write
  surfaces failures, and the banner only advises closing when the staged
  installer is actually still on disk.

### Verified
- Live test pass on the production build: split receipts, the reported
  110,000/101,000/9,000 advance scenario, reverse-then-record numbering,
  double-submit latch, batch-print voucher dedupe, void-retirement
  (INV-0006 issued after INV-0005 voided), and a restore drill (55 rows,
  12 tables) — zero duplicate numbers, `integrity_check ok`, no FK
  violations, all journals balanced.

## [2.9.1] — 2026-09-25

### Added
- **Case archive** — completed (delivered) cases can be moved out of the
  workstation into a new Archive tab without deleting anything. The tab
  filters by delivery-date range (shared date picker), clinic dropdown, and
  case-ID / patient / doctor search. Archived cases can be restored to the
  active board or permanently deleted through a typed confirmation that
  keeps the linked invoice so the money trail stays complete (migration
  011). Archived state survives restarts.

### Fixed
- **Scale past 1000 records** — the dashboard clinic ledger matched
  invoices/cases by lowercased clinic name per clinic and rendered one row
  per clinic; the Dental Clinics directory re-scanned all cases per clinic
  twice; the cases table mounted all rows at once. All three are now
  Map-indexed / memoized, the dashboard shows the 12 accounts needing
  attention (with an honest footer count), and the cases table loads 300
  rows at a time with a Show More step. Verified with 1000 clinics, 1000
  cases, 1000 invoices and 466 payments live in the app.

## [2.9.0] — 2026-09-25

### Fixed
- **Case workstation form is one wizard** — create and edit now share the
  exact same form design and flow, editing jumps to the same three steps
  (no separate edit screen), the phantom 4th step is gone, and the case can
  only be saved from the final step — a fast double-click on Continue can
  no longer submit a half-filled case from step 2.
- **QC inspection gate removed** — the gate demanded a passing inspection
  before a case could be marked ready/delivered, but no screen could record
  an inspection, so real cases were permanently stuck. Fabricated QC chips
  and the dashboard First-Pass QC stat are gone too; status changes apply.
- **Partial payments no longer become advance credit** — the unapplied
  remainder of a partial payment was misbooked as the clinic's advance
  balance in the ledger.
- **General Ledger ordering** — entries render in strict chronological
  sequence with the closing balance as the last row, not mixed up/down with
  the balance on top.
- **Invoice paper output matches the preview** — the printable sheet no
  longer sits inside a print-hidden wrapper (invoices printed blank).

### Added
- **Invoice print settings** — choose exactly which sections appear on the
  printed invoice (letterhead, bill-to, line items, totals, payment
  history, bank details, terms, signature, footer). The list is stored in
  the database and shared by the print dialog, batch printing and
  Settings → Print, so the preview is exactly what prints.
- **Batch invoice printing** — select a clinic and a month or date range
  and print every unpaid invoice in one run.
- **Two logos on invoices** plus a professional document layout.
- **Detailed price list & catalog** — materials now carry material system,
  unit basis, shade guide, indications and contraindications (migration
  010); cards, the editor form and the printed price list show the full
  specification, and upgraded installs get the shipped rows backfilled
  (only empty fields are filled).

### Changed
- **Billing tabs simplified** — the Clinic Accounts & Ledger tab is removed
  and every KPI card strip is gone from the Invoices and Transactions
  tabs; the filter chips carry the counts.
- **Print Studio module deleted** — its job is covered by the per-document
  print settings.
- **Clinic form relaxed** — only clinic name and doctor name are required;
  every other field is optional and still saves.

## [2.8.1] — 2026-09-23

### Fixed
- **First-run admin now persists across restarts** — the login screen's user
  list was initialized from the dead legacy localStorage source, so every
  relaunch resurfaced "Create the administrator" even though the created
  Super Admin was correctly saved to SQLite. Accounts now load from the live
  database; a regression test proves the admin survives an app restart.

## [2.8.0] — 2026-09-23

### Added
- **Zero-account shipping (migration 009)** — the hidden `service.admin`
  support account is removed entirely. Fresh installs boot with zero users;
  the login screen's first-run setup creates the operator's real Super Admin
  with a proper PBKDF2-hashed password. Existing installs drop hidden account
  rows automatically on first launch of this version.

### Changed
- **Dental Clinics audit** — the fabricated 5.0★ rating badge (no reviews
  exist) is gone along with the entire Performance Reviews feature; the
  pricing form no longer prefills fictional money (PKR 13,500 / 10%);
  deleting a clinic with linked cases is blocked with the exact case count
  (protects case history); ledger money values use monospace figures;
  hardcoded `'adil'` username filter removed from Settings → User Management.

## [2.7.0] — 2026-09-23

### Added
- **Demo-user purge migration (008)** — installs that still carried the old
  seeded demo accounts (`admin`, `billing`, `hamza`, …) are cleaned at first
  launch of this version. Fresh installs were already clean. New users created
  in Settings no longer default to the purgeable `@dentalsolutions.pk` emails.
- **QC correction flow UI** — inspection rows in Case Detail can be amended
  via the domain's `correct` action; amended rows are badged, corrections are
  audit-kept, and the UNIQUE dedupe still blocks double-posting.
- **Enhanced date-range picker** (`DatePickerRange`) — calendar popup with
  month/year navigation, quick ranges, manual entry, and clear. Wired into
  Payments & Transactions (defaults to today), Invoices & Receivables (all
  time), Analytics, and the General Ledger.

### Changed
- **Billing integrity** — Void Invoice now refuses while active payments
  exist, reverses the issuance journal, and writes an `INVOICE_VOIDED` audit
  event. The transaction register's silent-delete path was removed; reversal
  with compensating journal is the only removal path. Payment-proof uploads
  record real file size, type, and operator.
- **Invoice voucher ported to the print engine** — live paper preview,
  section toggles, payment-history section, teeth on line items, and
  blank-safe branding on every print surface (no fabricated lab identity).
- **Interface polish** — single-accent chrome (header, sidebar, dashboard
  hero as an editorial header), fill-width equal tabs in Billing, shared
  StatCard across billing tabs, honest identity card in Settings, and the
  demo-reset control removed from production.
- **Bundle** — duplicate `build:` key in vite config fixed; view modules are
  lazy-loaded (eager bundle 1604 KB → ~252 KB; no chunk warnings).

### Removed- Sidebar "Log New Case" and dashboard hero "New Dental Case" duplicates —
  the header-area dashboard module is the single case-entry point.

## [2.6.0] — 2026-09-23

### Added
- **Hidden service account ships with every install** — `service.admin`, a
  Super Admin invisible in every user list (new `users.is_hidden` column,
  migration 007). Intended for vendor support, recovery and testing. The
  credential is derived at runtime from encoded fragments (no plaintext secret
  in source or database); the operator-facing admin is still created through
  the first-run setup flow.
- **SQL-backed analytics service** — turnaround per priority (average days and
  on-time rate vs each priority's SLA, from case status history), revenue by
  restoration material (case teeth × invoices), and payment behavior per
  clinic (billed, collected, outstanding, average days-to-pay, advance
  credit). Surfaced in Analytics as two new tables; Dashboard's average
  turnaround now uses the same DB-computed source.
- Context refactor, phase 2: cases, billing, and settings domains extracted
  into dedicated hooks over the same repositories — AppContext API unchanged.

### Changed
- **Billing module consolidated** — one unified transaction form
  (Record Transaction) for payments, advances, credit notes and refunds
  everywhere in the app; removed the duplicate "Lab-Wide Payment Status"
  banner, three legacy modal forms (~1,100 lines), and the dead LedgerView
  (672 lines).
- **Dashboard honesty pass** — removed the fake "Collect Payment" modal that
  mutated React state without persisting (replaced with the real unified,
  DB-backed form), the no-op "Generate Batch Billing" button, invented
  monthly-revenue chart data, a fabricated on-time rate based on a hardcoded
  date, and invented fallback text for clinic instructions.

## [2.5.0] — 2026-09-23

### Added
- **Quality Control module** — per-case QC inspections (pass / conditional / fail),
  reasons, metrics, and re-inspection flow, persisted in a new `qc_inspections`
  table (migration 006) and backed by its own typed repository.
- **One-click restore drill** — Settings → Backup now proves the restore
  pipeline: packs a fresh backup, restores it into a transient in-memory
  engine, row-checks against the manifest, and reports PASS/FAIL without ever
  touching the live database (3 new tests).

### Changed
- **SQLite-only hydration** — boot no longer falls back to legacy `dsw_*`
  localStorage for business data; all collections hydrate from the database
  (also fixes a latent desktop hazard where empty localStorage could overwrite
  SQLite collections). A one-time sweep removes stale legacy keys while
  preserving active browser-persistence and session keys.
- Migration numbering: QC inspections renumbered 005 → 006 so installed
  clients keep the shipped `print_templates` migration (005).
- Legacy import no longer fabricates a default password for user records
  missing one — such users are skipped and reported instead of creating a
  known-credential account.

### Security
- Plaintext bootstrap credentials removed from docs/comments repo-wide.
- QC module code reviewed during merge: update engine kept on master's
  hardened version (allowlisted URLs, Rust-side SHA-256, staged install).

## [2.4.0] — 2026-09-21

### Added
- **Automatic scheduled backups** — daily or weekly zero-click backups.
  Desktop: timestamped copies of the live SQLite file in the app data folder
  with retention rotation (keep 3–30, oldest pruned). Browser: a verified
  snapshot of the latest backup in local storage. Runs a minute after boot
  and re-checks hourly. New Automatic Backups card in Settings → Backup with
  last-run status, Back Up Now, and a per-run history log.
- Desktop commands `backup_list` / `backup_delete` (path-guarded) for the
  rotation UI.

### Changed
- Branding save toast now says "Saved to Database!" (it was always SQLite —
  the old text said Local Storage).
- Logo preview is circular, matching how the header and avatars render it.

## [2.3.4] — 2026-09-21

### Fixed
- **Update relaunch** — after a silent update installs, the app now relaunches
  the exe from the installed location (read from the per-user uninstall
  registry key) instead of whatever path started the update, so the fresh
  version always opens. Shipped in this release so installed 2.3.3 clients
  auto-update once more, and every update after that relaunches itself.

### Changed
- **Sidebar navigation polish** — active items use an indigo accent with a
  left indicator bar (replacing the heavy black pill), refined group
  headings, focus-visible rings for keyboard use, badge dot indicators in
  collapsed mode, a circular Log-New-Case button when collapsed, and the
  mobile bottom bar respects the safe-area inset.
- Print documents (clinic statements, bulk print letterhead, receipts) read
  all identity and bank details from Branding settings.

## [2.3.3] — 2026-09-21

### Fixed
- **Classic job-slip voucher download restored** — Save & Download File again
  produces the DS VOUCHER-style document (bordered sheet, badge + monospace
  case number, label/value rows); download and Print Card remain separate
  actions.
- **Printing unified across the app** — job slips, bulk prints, invoices,
  payment receipts, clinic statements, ledgers, and the catalog all print
  through one isolation class, so paper output matches the on-screen preview
  and never prints a blank page. Transitions are disabled on paper.
- **Case wizard** — Save as Draft now appears only on the final Attach &
  Review step, so every new case passes through document attachment.
- **Settings** — removed the duplicate legacy update card; the single updates
  hub lives in Settings → Updates. Thin styled scrollbars on tab strips and
  the users table.
- **Sidebar** — removed the fake "enterprise" status card, the hardcoded v2.4
  diagnostics modal, and quick-filter buttons that only navigated. The footer
  now shows the real app name and the running version.
- **Billing** — consistent header button icon colors and `font-bold`
  typography across all billing screens.
- Dev: Vite's file watcher no longer watches the Rust `target` directory
  (fixed `EBUSY` crashes during `tauri dev` on Windows).

## [2.3.2] — 2026-09-21

### Fixed
- **Auto-update engine works end-to-end** — the installer download moved from
  the webview (where the release-asset CDN's missing CORS headers silently
  killed every attempt) to a native streaming download in Rust with live
  progress events. The SHA256SUMS.txt fallback now works for the same reason.
- Update checks read the CI-published manifest from the raw `gh-pages` URL
  first (the repo's GitHub Pages site was never enabled, so the old primary
  source 404'd), with the published Pages URL and Releases API as fallbacks.
- The silent NSIS install now runs detached and the app exits cleanly so the
  installer can replace files and relaunch the new version.

### Security
- **Checksum cross-check**: a manifest-provided checksum must exactly match the
  release's published SHA256SUMS.txt, which is now always fetched — any
  absence, unparsable entry, or disagreement fails closed.
- **Per-user install mode** (`installMode: currentUser`): silent updates no
  longer need administrator rights on clinic PCs.

### Added
- **Update history** in Settings → Updates: a persisted, capped log of every
  update check, availability, install, and failure, shown with the current
  version and a manual re-check button.

## [2.3.1] — 2026-09-20

### Added
- **Printable odontogram on job slips** — a 32-tooth FDI arch chart section in
  Print Studio; case units are filled solid for clean photocopying and share
  the same arch layout as the on-screen chart.
- **Print templates moved to SQLite** — new `print_templates` table
  (migration 005) with a one-time import from the legacy localStorage key, so
  templates survive reinstalls and follow the database backup/restore path.

### Security
- Update-engine hardening: removed the unused `run_installer` command
  (arbitrary path execution from the webview), allowlisted download/open URL
  hosts, validate the manifest version string, stage installer bytes as
  base64 over IPC (3× smaller payload), refuse updates before the database
  is loaded, and take a pre-update database backup before silent install.
- Fixed latent `base64_decode` padding rejection and made database saves
  atomic (rename-first) so a crash or antivirus lock can no longer leave a
  half-replaced database file.

### Changed
- Main JS bundle split into cacheable vendor chunks — main chunk down 43%
  (1.68 MB → 0.96 MB).
- Login page simplified to a single clean centered column (brand rail,
  decorative cards and hardcoded contact details removed).

## [2.3.0] — 2026-09-20

### Added
- **Global Print & Documents settings** (Settings → new Print tab): paper size
  (A4/Letter), page margins, text scale, and logo placement (on/off + left /
  centered / right) govern every printed invoice, job slip, payment receipt
  and statement. The chosen paper+margin become the live `@page` rule at
  print time; Print Studio previews respect the same settings.
- **Automatic updates.** The desktop app checks for releases on dashboard
  load and hourly: fetches the installer, verifies its SHA-256 inside the
  Rust shell (fail-closed — nothing runs on mismatch), then installs
  silently and restarts. The web build opens the browser download instead.
  Progress and a one-click update now appear as a **dashboard pill**
  (silent when current), with a full **Settings → Updates** card.

### Fixed
- Update-suite fixtures now derive their "newer" version from the installed
  version, so release bumps no longer break tests.

## [2.2.0] — 2026-09-19

### Added
- **In-app auto-update system.** The app now silently checks GitHub for a newer
  release on startup (and hourly after). When one exists, a dismissible banner
  offers a one-click installer download that opens in the system browser
  (new `open_external` Tauri command, https-only). Update sources: a
  CI-published `update-manifest.json` on GitHub Pages, with the GitHub
  Releases API as fallback. (The offline `.dentalupdate` import UI shipped
  here was later removed — updates are manifest-driven only.)
- CI now publishes `update-manifest.json` to the `gh-pages` branch on every
  `v*` tag so released installers are discoverable by the in-app updater.

### Fixed
- **`APP_VERSION` was left at 2.0.1 by the v2.1.0 release** — installed 2.1.0
  apps under-reported their version to the backup/update system.

### Changed
- **Create New Job form simplified:** the per-tooth tooth-spec inspector no
  longer shows the Restoration/Preparation Type grid and Restoration Material
  dropdown (redundant with the case-level material selection and the Catalog →
  Restoration Types manager). Shade and per-tooth notes are unchanged; defaults
  still flow to `case_teeth` storage.

## [2.1.0] — 2026-09-19

### Added
- Case job lifecycle: view/edit/delete cases, row action menus, Record Payment
  shortcut.
- Print Studio module (Job Slip / Lab Card / Invoice / Receipt with per-section
  toggles, live A4 preview, saved templates).
- Catalog → Restoration Types tab backed by SQLite clinical specs.
- True 32-tooth FDI SVG odontogram with clinical overlays and FDI/Universal
  toggle.
- Every billing entry auto-logs a voucher + journal entry.

## [2.0.1] — 2026-09-18

### Fixed
- **Packaged desktop app failed to boot** with `Database boot failed: expected
  magic word 00 61 73 6d` (`<!do` = HTML): the 2.0.0 installers had been built
  before the production WASM-URL fix landed, so the embedded bundle still
  resolved `sql-wasm.wasm` relative to the JS bundle → 404 → HTML parsed as
  WASM. Installers rebuilt with the corrected bundle (2.0.1).
- Boot path now validates the persisted snapshot/file against the 16-byte
  `SQLite format 3\x00` header before handing bytes to the engine. A corrupt,
  truncated, 0-byte, or non-SQLite file (e.g. a stale leftover from a crashed
  2.0.0 install) is rejected safely and the app starts from a fresh database
  instead of bricking — verified live by booting 2.0.1 over a 0-byte stale file
  (it created a valid 516 KB database).

### Changed
- Version bumped to 2.0.1 in `package.json`, `tauri.conf.json`, `Cargo.toml`,
  and the backup/update service (`APP_VERSION`), so new backups declare the
  correct version.

## [2.0.0] — 2026-09-17

### Added
- **Real SQLite database** (sql.js WASM, bundled locally) as the authoritative
  store for every module: cases, teeth, labs, invoices, payments, advances,
  adjustments, journal, ledger, notifications, audit, settings.
- Transactional migrations (001–004) with recorded history and safe failure.
- Typed repository layer with FK enforcement, CHECK constraints, and gap-free
  document sequences (DS-, INV-, PAY-, …).
- Legacy data migration: one-time localStorage → SQLite importer with per-record
  validation, quarantine, plaintext-password re-hashing, and a persisted report.
- PBKDF2-hashed authentication; plaintext passwords and hardcoded backdoor removed.
- Portable `.dentalbackup` format: checksummed, versioned, with validated
  restore (safety snapshot → engine swap → reload).
- Update system: online manifest check with SHA-256 verification (the
  companion offline `.dentalupdate` import UI was removed in 2.13.0);
  version `2.0.0` surfaced in Settings.
- Priority SLA model (urgent 1 / high 2 / normal 4 / low 7 days) with automatic
  due dates and badges across case forms and lists.
- Attachment validation service (MIME allow-list, 8 MB/file, 32 MB/entity).
- Desktop packaging (Tauri 2): real file-backed SQLite (`dental_solutions.sqlite`
  with WAL + atomic writes), NSIS/MSI installers, full app icon set.
- Application icon (SVG master + PNG/ICO/ICNS) and vendored offline fonts.

### Changed
- Dashboard and billing now compute every metric from live database records;
  fake fallback numbers removed.
- Case form simplified: duplicate status/material/shade controls unified;
  per-priority SLA shown on selection buttons.
- Google Fonts self-hosted; zero runtime network dependencies remain.

### Removed
- AI Studio (`@google/genai`), `express`, and `dotenv` (unused) dependencies.
- Plaintext demo-credentials panel and demo image URL from login/settings flows.

### Security
- Passwords stored only as PBKDF2-SHA256 hashes.
- SQL injection hardening (parameterized queries, table-name validation).
- `.gitignore` excludes databases, backups, and patient data from version control.
