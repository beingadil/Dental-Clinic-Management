# Invoice Module Audit — invoice_number / payment_number integrity

**Repo:** D:\Dental Management Software · HEAD `5be62ef` + uncommitted working-tree fixes (verified via `git diff`: syncCore healer, `maxDocumentSeq`, slice suffixes, RecordTransactionModal latch).
**Scope:** every invoice create/update/void/bulk path and every writer of `invoice.payments`; the UI submit surfaces; and every reader that assumes unique document numbers. Read-only audit — no files under src/ were modified.
**Rubric:** P0 = money/data loss · P1 = breaks all persistence · P2 = correctness/UX.

**Persistence model recap (verified):** `syncCollectionsToDb` (src/db/syncCore.ts:44-62) → 150 ms-debounced DELETE + re-INSERT of whole tables inside ONE `db.withTransaction` (syncCore.ts:91). Any UNIQUE violation aborts the entire transaction; the app then runs on unpersisted state and shows the sync-failed banner. Unique document columns: `invoices.invoice_number` (migrations.ts:215), `payments.payment_number` (migrations.ts:253), `advance_payments.payment_number` (migrations.ts:308), `account_adjustments.adjustment_number` (migrations.ts:345), `journal_entries.journal_number`. `receipt_number` is NOT unique (migrations.ts:254, 309).

**Working-tree fixes already present (do not re-fix):** duplicate-number healer for payments + advances in syncCore (syncCore.ts:72-89, 267-292, 294-307); `maxDocumentSeq` max-scan generators for PAY/REC/ADV (ledgerDomain.ts:36-53, 74-78; transactionDomain.ts:106-111, 193-198); per-slice `-N` suffixes for multi-invoice payments (transactionDomain.ts:170-188); RecordTransactionModal submit latch (RecordTransactionModal.tsx:77, 210-212, 240); admin-numbering regression tests (tests/services/transactionNumbering.test.ts, tests/db/syncCoreDuplicateHeal.test.ts).

---

## F1 — Duplicate `invoice_number` in state aborts the ENTIRE sync transaction; no healer exists for invoices
**Severity: P1** (the live failure class: one duplicate stops all persistence)
**Evidence:**
- `invoices.invoice_number TEXT NOT NULL UNIQUE` — src/db/migrations.ts:215.
- syncCore inserts invoices raw, with **no** uniqueness healer: src/db/syncCore.ts:255-266. The healer (syncCore.ts:78-89) and its usage exist only for payments (syncCore.ts:268-271) and advances (syncCore.ts:297-300).
- The number is minted outside the state updater: AppContext.tsx:889 (`generateInvoiceNumber = () => nextInvoiceNumber(invoices || [])` — render closure) and AppContext.tsx:934-959 (`newInvoice` built outside `setInvoices((prev) => [newInvoice, ...prev])`). Generator: ledgerDomain.ts:64-67 (`/INV-(\d+)/` max-scan).
- Sole creation caller: CaseDetailModal.tsx:486 (`commitCase`, CaseDetailModal.tsx:445-513) — currently guarded by final-step-only + `STEP_SETTLE_MS` (CaseDetailModal.tsx:446-447) and modal close (512), so a plain double-click does not reach it today.
**Failure scenario:** any two invoice creations inside one render window (a future caller — e.g. batch/import tooling, a second save surface, or a retry without re-render) mint the identical `INV-n`; the INSERT at syncCore.ts:257 aborts the whole transaction, the banner appears, and every subsequent change stays in React only → unsaved work is lost on close. Same structurally as the resolved payments bug, but with zero protection for invoices.
**Minimal fix:** in the syncCore invoices loop add `const usedInvoiceNumbers = new Set<string>()` + `uniqueNumber(String(inv.invoice_number || ''), usedInvoiceNumbers)` exactly like payments (syncCore.ts:78-89, 271); and compute `newInvoice.invoice_number` inside the `setInvoices` updater (or take a creation latch in `addCase`) so state can never hold two identical INV numbers. Also reject empty-string numbers at the sync boundary (empty passes NOT NULL but the second empty string violates UNIQUE).

## F2 — Credit-note numbers are count-based and year-formatted; duplicate `adjustment_number` aborts the ENTIRE sync
**Severity: P1**
**Evidence:**
- `CR-${currentYear}-${adjustmentCount + 1}` — src/services/transactionDomain.ts:452.
- Caller passes a raw row count: `adjustmentCount: accountAdjustments.length` — src/context/hooks/useTransactionCommands.ts:307 (`issueCreditNoteV2`).
- `account_adjustments.adjustment_number TEXT NOT NULL UNIQUE` — src/db/migrations.ts:345; syncCore has no adjustments healer (verified: no `account_adjustments` dedupe block in syncCore.ts).
- A max-based generator already exists and is used by the legacy path — ledgerDomain.ts:87-97 (`nextAdjustmentNumber`), called at AppContext.tsx:1640.
**Failure scenario:** the count tracks *rows*, not the highest issued number. Any history with a gap (a delete/rollback in an older build, a sparse legacy import, or mixed refund/credit rows such that `count+1` equals an existing `CR-YYYY-####`) makes `issueCreditNoteV2` mint an existing number → `UNIQUE constraint failed: account_adjustments.adjustment_number` → whole sync aborts → same banner/data-loss state as the live payments bug. Two credit notes issued in one render window (count still stale) duplicate deterministically.
**Minimal fix:** one line at useTransactionCommands.ts:307 — replace `accountAdjustments.length` with a max-scan over existing numbers of that type (reuse `nextAdjustmentNumber(accountAdjustments, 'credit_note')` or `maxDocumentSeq` on the filtered `adjustment_number` list to keep the `CR-YYYY-####` format).
## F3 — bulkMarkPaid: cross-batch number reuse (`PAY-0012-1` re-minted) and bulk-vs-V2 format mix
**Severity: P2** (persistence survives via healer; UI/audit numbers diverge)
**Evidence:**
- `const basePayNum = generatePaymentNumber()` then `` `${basePayNum}-${invoiceIds.indexOf(invId) + 1}` `` — src/context/AppContext.tsx:1425-1427; receipt `` `REC-${payNum.replace('PAY-','')}` `` — AppContext.tsx:1439.
- `maxDocumentSeq` regex `` ^PAY-(?:\d{4}-)?(\d+)$ `` — src/services/ledgerDomain.ts:42-53. `PAY-0012-1` matches with the *optional year branch* consuming `0012-` and capturing `1` → parsed as sequence 1. So a multi-invoice bulk batch (which mints **only** suffixed numbers, no plain `PAY-0012`) leaves the base sequence unrecorded, and the very next bulk batch re-mints `PAY-0012-1..n`.
- The `-D2` healer renames only the **DB row** (syncCore.ts:82-89, 271); React state, journals and receipts keep the original duplicated number.
- V2 payments are year-formatted `PAY-2026-####` (transactionDomain.ts:110) while bulk is 4-digit `PAY-####`; bulk receipts become `REC-0012-1` vs V2 `REC-2026-0012` (cosmetic; `receipt_number` is not UNIQUE — migrations.ts:254).
**Failure scenario:** two bulk settle batches in the same session → duplicate payment numbers in `invoices[].payments`; the register/drawer show repeated numbers; the DB copies get silently renamed to `…-D2` while journals (`reference_number` = original, useTransactionCommands.ts:383-385) and `LabDetailModal.tsx:482` number lookups refer to the un-renamed value. Every subsequent sync heals the same rows again.
**Minimal fix:** extend the regex to tolerate one slice suffix after the captured sequence: `` ^${prefix}-(?:\\d{4}-)?(\\d+)(?:-\\d+)?$ `` (captures `0012` from `PAY-0012-1` and `0009` from `PAY-2026-0009-2`); optionally stamp bulk receipts in the `REC-YYYY-####` shape.

## F4 — bulkMarkPaid ignores `credit_notes_total` → records amount_paid beyond the net due (money correctness)
**Severity: P2** (money-affecting; escalate to P0 if credit notes are in production use)
**Evidence:**
- `const remaining = inv.final_amount - inv.amount_paid;` and `amount_paid: inv.final_amount` — src/context/AppContext.tsx:1432, 1482-1485.
- Net due everywhere else subtracts credits: InvoiceDetailDrawer.tsx:61 (`netDue = final - paid - credits`), RecordTransactionModal.tsx:101 and :148 (`final_amount - amount_paid - credit_notes_total`).
**Failure scenario:** invoice final 1 000 with a 200 credit note → bulk “clear” records a 1 000 payment (remaining) although the clinic only owes 800 → a phantom receipt row for money never received, `amount_paid` (1 000) > net due (800), and the credit is silently netted away in every statement.
**Minimal fix:** `const remaining = Math.max(0, inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0));` and set `amount_paid: (inv.amount_paid || 0) + remaining` (status via `deriveInvoiceStatus` so `status_v2` stays coherent).

## F5 — `updateInvoice` is an unguarded whole-object mutator (context-exposed; zero callers today)
**Severity: P2**
**Evidence:** src/context/AppContext.tsx:1403-1414 — `const updated = { ...inv, ...updates };` then only `payment_status` is recomputed (1410, `deriveSimpleStatus` — paymentDomain.ts:11-19: ignores credits and due dates). Interface at AppContext.tsx:246; exposed at 1826. Grep: no caller in src/ (only the type, impl, context object).
**Invariants a caller can bypass:** `invoice_number` → duplicate → UNIQUE abort (F1 class, whole-persistence stop); `amount_paid` without `payments` (drift); `payments` without `amount_paid` (drift the other way); `status_v2` never recomputed (dual-truth divergence); `journal_id`/`case_id`/`lab_id` silently rewritable.
**Failure scenario:** any future edit form that submits a whole invoice object (e.g., patched invoice with re-typed number) bricks the sync for the entire profile.
**Minimal fix:** whitelist mutable fields (drop `id`, `invoice_number`, `journal_id`, `payments`, `amount_paid` from the merge); if `payments` is supplied, recompute `amount_paid` via reduce; derive both status fields with `deriveInvoiceStatus`. If truly unused, delete the export.
## F6 — `deletePayment` silently deletes a payment without a reversal journal and leaves `status_v2` stale (exposed; zero callers today)
**Severity: P2**
**Evidence:** src/context/AppContext.tsx:1383-1401 — filters the slice out, recomputes `amount_paid` and `payment_status` via `deriveSimpleStatus` only; `status_v2` untouched. Exposed at AppContext.tsx:1820. Zero callers in src/ (grep). The UI contract says the opposite: TransactionRegister.tsx:567 — “Audit-Compliant Reversal (the only removal path — no silent deletes)”. The V2 reversal is the safe pattern: compensating journal (useTransactionCommands.ts:382-389) + recompute from active payments (transactionDomain.ts:551-567).
**Invariants bypassed:** physical removal of a posted payment (journal rows remain, allocation `source_ref` dangles); `payment_status` flips while `status_v2` still says `paid` → dual-truth divergence; no audit event.
**Minimal fix:** delete the export, or reimplement as `reverseTransactionV2({ referenceType: 'payment', … })` semantics (mark `is_reversed` + reason + compensating journal) instead of filtering.

## F7 — Payment ↔ journal linkage breaks for multi-invoice slices and after healer renames
**Severity: P2** (reconciliation/inspection surfaces miss or mis-link rows)
**Evidence:**
- Slices are built by spreading the payment object at prepare time — transactionDomain.ts:174-188 (`payment_number` suffix at :182) — and `journal_id` is stamped later on the canonical object only (useTransactionCommands.ts:136), so the slices (the only rows syncCore inserts, syncCore.ts:267-291, which also omits `journal_id` from its INSERT column list at :273-281) never carry it.
- Journal `reference_id` = canonical `pay-<ts>-<rand>` id (transactionDomain.ts:147) but the stored payment rows have slice ids `pay-slice-<ts>-<invoiceId>` (transactionDomain.ts:181) → id-based matching fails always; number-based matching works only for the primary slice of a single-invoice payment.
- Readers relying on equality: InvoiceDetailDrawer.tsx:67-70 (drawer shows no journal for a payment); useTransactionCommands.ts:383-385 (reversal journal lookup); LabDetailModal.tsx:482 (first match can hit the wrong slice); displays at BillingView.tsx:956 / PaymentProofModal.tsx:24.
**Failure scenario:** in a 3-invoice payment, slices 2 and 3 have no journal match anywhere; after a healer rename the DB row number (`…-D2`) no longer equals the journal number stored in state.
**Minimal fix:** set `journal_id` on every slice after the journal is created (assign to `prepared.invoiceSlices[i].payment.journal_id` in recordTransactionV2), and make journal lookups suffix-tolerant: `j.reference_number === p.payment_number || j.reference_number === p.payment_number.replace(/-\d+$/, '')`.

## F8 — AccountsFinancialHome quick-apply has no submit latch; guards read stale render closures
**Severity: P2**
**Evidence:** AccountsFinancialHome.tsx:150-161 (submit → `applyAdvanceCreditV2` → close; no latch/disabled) vs the modal pattern at RecordTransactionModal.tsx:77, 210-212, 240. Guard values are computed from the render closure — useTransactionCommands.ts:237-248 (`remainingDue`, `totalAvailable` from `invoices`/`advancePayments` props) — and the invoice updater re-adds `toApply` unconditionally (useTransactionCommands.ts:266 → transactionDomain.ts:412-421).
**Failure scenario:** two invocations before a re-render double-credit the invoice (`amount_paid += 2 × toApply` beyond the net due) and double-allocate the advance wallet. Mitigated in practice by the synchronous modal close, but any keep-open/retry variant re-introduces it.
**Minimal fix:** reuse the `submitLatchRef` pattern (set before first write, reset when the dialog opens) and re-validate `remainingDue`/`toApply` inside the `setInvoices` updater from `prev`.

## F9 — Legacy `applyAdvanceCredit` (AppContext) still writes `invoice.payments`; same double-fire/drift hazards
**Severity: P2**
**Evidence:** AppContext.tsx:1547-1627 — number minted at :1585 (`generatePaymentNumber()` from render closure), record built :1587-1604, invoice updated :1606-1618 (`amount_paid: item.amount_paid + toApply` from closure `toApply`; `status_v2` untouched). Exposed on context at AppContext.tsx:1835. Zero UI callers today (only AccountsFinancialHome uses `applyAdvanceCreditV2`).
**Failure scenario:** any future caller (or a retained old caller) double-firing before re-render → duplicate payment number (healer-only rescue) + double credit; `status_v2` permanently disagrees with `payment_status`.
**Minimal fix:** remove the export and route to `applyAdvanceCreditV2` (already used by the only UI surface); if kept, take a latch and recompute from `prev` inside the updater.
## F10 — Readers that assume unique payment/invoice numbers (first-match semantics)
**Severity: P2**
**Evidence / effect:**
- useTransactionCommands.ts:361 and :372 — `find((p) => p.id === referenceId || p.payment_number === referenceId)` over every invoice: with duplicate numbers in state (F3 before heal) a number-based reversal targets the first slice found, not necessarily the intended one. Current UI passes ids (TransactionRegister.tsx:571-580 → `referenceId: txn.id`), so this is latent.
- LabDetailModal.tsx:482 — `allPayments.find(p => … || p.payment_number === entry.reference_number)`: first match may belong to another invoice's slice.
- InvoiceDetailDrawer.tsx:69 — journal linking by `p.payment_number === j.reference_number` (see F7).
- TransactionRegister.tsx:104 — invoice matched by `i.invoice_number === pay.invoice_number`; BillingReportsView.tsx:284 — voucher → invoice by number (`i.invoice_number === v.voucher_number`): with a re-issued number (F13) these resolve to the wrong invoice.
**Minimal fix:** prefer id-based matching everywhere (`p.id`, `inv.id`); keep number equality only as a fallback after id fails. Numbers are labels; ids are the identity.

## F11 — `updateCase` price edit drifts the invoice from its posted issuance journal (`status_v2` + amount untouched)
**Severity: P2**
**Evidence:** AppContext.tsx:1022-1042 rewrites `amount`, `discount`, `final_amount`, `payment_status` on the invoice but not `status_v2` and posts **no** journal adjustment; the issuance journal (debit A/R) was posted at creation AppContext.tsx:961-967 (`buildInvoiceJournal`, `journal_id` stamped at :967).
**Failure scenario:** after any price edit, `journalEntries` (debit = old final) and the invoice row (`final_amount` = new) disagree; `getLedgerEntries` (built from invoices, ledgerDomain.ts:182-240) and journal-based views diverge; `status_v2` stays stale relative to the new amount.
**Minimal fix:** at minimum recompute `status_v2` with `deriveInvoiceStatus` and include the invoice in the standard rule set; for the money trail, post a delta journal (or block price edits on invoices carrying a journal) — policy decision for the lead.

## F12 — RecordTransactionModal latch never resets on a thrown command error
**Severity: P2**
**Evidence:** RecordTransactionModal.tsx:210-212 (latch check), :240 (set before writes), :253-311 (direct `recordTransactionV2`/`recordAdvanceDepositV2`/`issueCreditNoteV2`/`recordAccountAdjustment` calls — no `try/catch`). `prepareTransaction` throws on over-allocation — transactionDomain.ts:115-122 — while its doc comment says “callers surface that error to the UI”.
**Failure scenario:** an over-allocation throw leaves the modal open with the latch set → submit button dead until the modal is reopened; the error is not surfaced and the exception escapes the event handler.
**Minimal fix:** wrap the mode branches in `try { … } catch (e) { alert(...) } finally { submitLatchRef.current = false; }`.

## F13 — Voided invoice numbers are re-issued (`nextInvoiceNumber` restarts from remaining rows)
**Severity: P2**
**Evidence:** deleteInvoice removes the row AppContext.tsx:1499-1544 (guard :1506-1513, reversal journal :1518-1528, audit :1530-1540, filter :1542); `nextInvoiceNumber` = max(existing)+1 — ledgerDomain.ts:64-67. Voucher/print resolution by number: BatchInvoicePrintModal.tsx:86 (`voucher_number: inv.invoice_number`), BillingReportsView.tsx:284.
**Failure scenario:** void INV-0007, create a new case → the new invoice is also INV-0007 while the voided one still appears as INV-0007 in its reversal journal, saved voucher and any printed statement → number-based lookups can resolve the wrong invoice; audit trail ambiguity.
**Minimal fix:** keep a persisted high-water counter (the repo already ships `src/db/sequences.ts` with `ensureCounterAtLeast`, used by the legacy migrator) and mint INV numbers from `max(state max, counter)`; deleting an invoice must never lower the counter.
---

## Verified safe (checked, no finding)

- **V2 record-transaction numbering** — PAY/REC generated by max-scan with the documented "never a count" rule (transactionDomain.ts:106-111), multi-invoice slice suffixes (transactionDomain.ts:170-188), remainder-advance ADV via max-scan (:193-198), `existingPaymentNumbers/AdvanceNumbers/ReceiptNumbers` fed from live state (useTransactionCommands.ts:74-81). Covered by tests/services/transactionNumbering.test.ts and tests/db/syncCoreDuplicateHeal.test.ts.
- **syncCore healer** — payment/advance ids renamed on collision, payment/advance numbers healed to deterministic `-D2/-D3` (syncCore.ts:72-89, 267-292, 294-307); notification ids deduped (:401-413); journal-line ids deduped (:359-367). A duplicate payment number can no longer abort the whole transaction.
- **RecordTransactionModal submit latch** — set pre-write at :240, checked at :212, reset on open (:90); adequate for double-click/Enter (F12 covers only the no-catch reset gap). Submit is `<form onSubmit>` (RecordTransactionModal.tsx:389) with `type="submit"` button (:749-755).
- **ReversalModal** — `isSubmitting` disabled guard (ReversalModal.tsx:33, 44, 54, 191); reversal targets are id-based.
- **bulkMarkPaid state math** — per-invoice suffix uniqueness inside one batch (AppContext.tsx:1425-1427); prepend happens inside the `setInvoices` updater (:1429-1487), so a repeated call sees the prior result and skips (`remaining <= 0`) — no double-credit from a double confirm dialog (BillingView.tsx:227-233).
- **CaseDetailModal save path** — single writer `commitCase` (CaseDetailModal.tsx:445-513), final-step-only + `STEP_SETTLE_MS` guard (:446-447), closes on save (:512); no second invoice mint reachable from a double click.
- **deleteInvoice** — active-payment guard (AppContext.tsx:1506-1513), reversal journal + audit event (:1518-1540); only void-safe invoices are removed.
- **Invoice status/amount recomputation on the V2 flows** — `applyPaymentToInvoice` (transactionDomain.ts:259-272) and `applyPaymentReversalToInvoice` (:551-567) both recompute `amount_paid` from active slices and update `status_v2` via `deriveInvoiceStatus`.
- **Repos layer** — `invoiceToDomain` reads payments per invoice (repos.ts:714-722, 750-753); `invoicesRepo.update` whitelist excludes `invoice_number` (repos.ts:792-793); `paymentsRepo.insert` supports `journal_id` (repos.ts:889-899) even though syncCore does not pass it (F7).
- **`receipt_number` is not UNIQUE** (migrations.ts:254, 309) — duplicate receipts (payment + remainder advance share one REC by design — transactionDomain.ts:149, 198; asserted by tests/services/transactionNumbering.test.ts:129) cannot abort a sync.
- **No reachable in-tree callers** for `updateInvoice`, `deletePayment`, legacy `applyAdvanceCredit`, `deleteAdvancePayment`, `deleteAccountAdjustment`, `deleteInvoice` (beyond BillingView) — F5/F6/F9 are latent, not live.
- **UI write surfaces contain no inline invoice/payment mutation** — InvoiceDetailDrawer only opens modals (InvoiceDetailDrawer.tsx:436-445); TransactionRegister only opens receipt/reversal/journal surfaces (TransactionRegister.tsx:541-587); AccountsFinancialHome only the quick-apply form (AccountsFinancialHome.tsx:150-161).
- **Boot mirror** — `hydrateAllFromDb` loads invoices with nested (healed) payments (domainState.ts:52-58; repos.ts:749-753), so DB-healed numbers become state truth on restart.
- **Legacy import path** — skips duplicate invoice numbers before insert (legacyMigrator.ts:168-170) and requires non-empty strings (:172-174).
- **Empty-string numbers** — every production generator returns a padded non-empty value (ledgerDomain.ts:60, 66, 77; transactionDomain.ts:110-111); only a hand-edited/import payload could deliver an empty number (noted in F1's fix).

## Summary counts

| Severity | Findings |
|---|---|
| P0 | 0 |
| P1 | 2 (F1 invoice_number, F2 adjustment_number) |
| P2 | 11 (F3–F13) |

**Highest-leverage minimal fixes:** (1) port the syncCore number-healer to invoices (F1); (2) make the credit-note number max-based (F2, one line); (3) fix the `maxDocumentSeq` slice-suffix regex (F3, one line); (4) include `credit_notes_total` in bulkMarkPaid (F4, two lines).




