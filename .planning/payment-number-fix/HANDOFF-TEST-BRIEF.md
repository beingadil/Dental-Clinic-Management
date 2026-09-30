# Handoff — test brief for the payment/invoice/case sync fixes

**Repo:** `D:\Dental Management Software` (Windows, PowerShell). Branch `master`, HEAD `a3544c1`
(4 commits ahead of `5be62ef` / v2.12.3).

## What was broken (context for the tester)

Persistence contract: React state is a UI mirror; SQLite is authoritative. `src/db/syncCore.ts`
`syncCollectionsToDb` runs a 150 ms-debounced **DELETE + re-INSERT of ~17 whole tables inside ONE
transaction**. Any single duplicate/invalid row aborts the *entire* transaction, so the app keeps
running on unpersisted state and shows:
"Database sync failed — your changes are at risk and may not be saved."

Root cause of the reported failure: payment numbers came from **row counts**
(`payments.length + advances.length + 1`), not the highest issued number, and a payment split across
several invoices stored **every slice with the same** `payment_number`. Either path re-issued an
existing number, so `UNIQUE constraint failed: payments.payment_number` aborted every save.

## Commits to test

| Commit | Contents |
|---|---|
| `ee03ccb` | Unique per-slice payment numbers; max-scan numbering for PAY/REC/ADV/CR (never counts); sync-core healer for duplicate document numbers (payments, advances, invoices, cases, history/notes/QC ids, teeth) and orphan-QC skip; `deleteCase` money guard + issuance-journal reversal; `deleteLab` FK guard; QC in backup/restore/wipe; double-submit latch in RecordTransactionModal; `addCase` stamps `journal_id` before state; bulkMarkPaid respects `credit_notes_total` |
| `8b284d2` | Bulk clinic re-assignment (`reassignLabRecords` + delete-confirm picker); case edits propagate `delivery_date` to invoice `issue_date`/`due_date`; `deleteAdvancePayment`/`deleteAccountAdjustment` refuse (reverse instead); legacy `applyAdvanceCredit` delegates to `applyAdvanceCreditV2`; suffix-tolerant payment lookup; modal latch resets on thrown command |
| `39bebba` | Pre-existing working-tree WIP (job slips, settings, updater, persistence) |
| `a3544c1` | Harness pins the production scenario (110000 payment / 101000 allocated / 9000 advance) |

## Files changed by the fixes

`src/services/ledgerDomain.ts`, `src/services/transactionDomain.ts`, `src/db/syncCore.ts`,
`src/context/AppContext.tsx`, `src/context/hooks/useTransactionCommands.ts`,
`src/context/hooks/useAuthDomain.ts`, `src/context/hooks/useVoucherLogging.ts`,
`src/components/billing/RecordTransactionModal.tsx`, `src/components/billing/InvoiceDetailDrawer.tsx`,
`src/components/billing/AccountsFinancialHome.tsx`, `src/components/cases/CaseDetailModal.tsx`,
`src/components/labs/LabDetailModal.tsx`,
`tests/services/transactionNumbering.test.ts`, `tests/db/syncCoreDuplicateHeal.test.ts`.

## Environment facts the tester must know

- **The preview server serves `dist/`, not `src/`.** Rebuild before judging any UI behaviour:
  `npm run build` (30–90 s), then hard-refresh http://localhost:3000 (Ctrl+F5).
  Server: `node .freebuff/preview-server.mjs` (port 3000, static).
- **Do not build/test inside the Cline agent sandbox** — its esbuild child process stalls forever
  (vitest and `vite build` both hang there). Use a normal shell.
- Modes: browser preview persists the whole SQLite file to `localStorage['dsw_sqlite_snapshot']`
  (base64); the desktop build writes `dental_solutions.sqlite` in the app-data dir
  (`pk.dentalsolutions.app`) atomically. To inspect what really persisted, decode that value / open
  that file with any SQLite tool and query the tables below.
- **Take a backup first** (Settings → Backup, or copy the DB file). These tests enter real money rows.

## Automated checks (run first)

```powershell
npx tsc --noEmit                     # expect: no output (clean)

# Runtime harness for numbering + sync healer (no vitest needed):
Remove-Item .tmp-verify -Recurse -Force -ErrorAction SilentlyContinue
npx tsc src/services/transactionDomain.ts src/db/syncCore.ts src/db/core.ts src/db/engine.ts `
  --outDir .tmp-verify --rootDir src --module commonjs --moduleResolution node `
  --target es2022 --lib es2022,dom --esModuleInterop --skipLibCheck
Set-Content .tmp-verify/package.json '{ "type": "commonjs" }'
node .planning/payment-number-fix/verify-numbering.cjs
# expect: ... ALL NUMBERING + SYNC-HEAL CHECKS PASSED

npm test                             # vitest suite incl. the two new regression files
```

## Live UI tests (action → expected)

Setup for the money tests: one clinic, one case (auto-creates its invoice); record payments from
Billing / Accounts / Clinic view. After **every** money action the sync banner must stay absent.

1. **Split receipt across 2 invoices** — record 30000 allocated 20000 + 10000.
   Expected: two payment rows with distinct numbers `PAY-<year>-NNNN-1` and `-2`, one receipt, no banner.
2. **Production case (the reported bug)** — invoice with balance 101000; record **110000**, allocate
   101000, keep 9000 as advance ("Save to Wallet").
   Expected: payment `PAY-<year>-NNNN`, advance `ADV-<year>-MMMM`, receipt `REC-<year>-KKKK`; invoice
   settled; wallet shows 9000; no banner; no number reused.
3. **Numbering after a deletion** — record 3 payments, reverse/void one, record another.
   Expected: the new number is higher than every number ever issued; no banner.
4. **Credit note after deletions** — issue 2 credit notes, reverse one, issue another.
   Expected: `CR-<year>-NNNN` never repeats; no banner.
5. **Double-click Post** — click "Post Transaction" twice quickly on a valid form.
   Expected: exactly one payment/receipt; no banner.
6. **Repeat batch print** — batch-print invoices twice.
   Expected: one `saved_vouchers` row per invoice (not per print run); `[VOUCHER LOGGED]` case note not duplicated.
7. **Voided invoice number stays retired** — void the newest invoice, then create a new case.
   Expected: the new invoice number is higher than the voided one.
8. **Case reprice re-posts journals** — edit a case price.
   Expected: the old issuance journal is reversed and a new issuance posted; invoice carries the new
   `journal_id`; no banner.
9. **Delete a paid case** — Delete Case on a case whose invoice has an active payment.
   Expected: refused with "… has active payment(s). Reverse them first."; nothing deleted.
10. **Delete an unpaid case** — same case after reversing payments (or a fresh unpaid case).
    Expected: deletion succeeds; each linked invoice's issuance journal reversed; `INVOICE_VOIDED`
    audit row present; that case's QC/notes/attachments gone.
11. **Delete a clinic that still has cases** — in the delete-confirm flow pick the clinic that takes the cases.
    Expected: cases + invoices move to the chosen clinic, then deletion succeeds. A clinic with
    advances/adjustments is still refused (money rows).
12. **Lab ledger payment link** — open a clinic whose payment number was healed (`…-D2`).
    Expected: the ledger row still resolves its proof/voucher (suffix-tolerant match).
13. **Backup/restore includes QC** — record an inspection, export backup, wipe data, restore.
    Expected: inspections come back; no banner after wipe/restore.
14. **Pre-broken state heals** — covered by the harness (`sync healed duplicates instead of aborting`);
    optional UI check: hand-edit a duplicate `payment_number` in the DB snapshot, then trigger any save.
    Expected: sync succeeds, the later duplicate gets `-D2`, and **no money row is dropped**.

## Expected non-behaviour (not bugs)

- **Electron is not required** — the app is already Tauri 2 (`src-tauri/tauri.conf.json`, NSIS,
  identifier `pk.dentalsolutions.app`, v2.12.3).
- **No QC gate** on manual `ready`/`delivered` transitions — removed by product decision (v2.9.0).
- Updates are manifest-driven (`update-manifest.json` on `raw.githubusercontent.com`), not the Tauri
  updater plugin; no `plugins.updater` block exists by design.
- `receipt_number` is not UNIQUE by schema; a payment and its remainder advance may share one REC by design.

## If a sync banner appears during testing

1. Note the exact action and the banner text (it quotes the SQL error).
2. Do **not** close the app; export a backup if possible.
3. Report: banner text, action performed, whether the automated checks above pass, and the colliding
   rows (query the table named in the error). Also report whether `dist/` was rebuilt after
   `a3544c1` — testing the old bundle reproduces the original bug by design.
