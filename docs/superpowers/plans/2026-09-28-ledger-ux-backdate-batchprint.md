# Ledger UX + Backdating + Batch Print Fix Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. NOTE: git commits were forbidden during the sponsored run; the user has since explicitly authorized commit + installer release (2026-09-29). Dependency installs remain out of scope.

**Goal:** Ledger preview shows only on click; clinic dropdown starts empty (no consolidated mode); backdated case entries book their invoice/ledger row at the business date; batch-print unpaid invoices renders ONE summary sheet. Follow-up work (same session): every financial entry — advance deposits, credit notes, refunds, bulk settlements — files by its user-picked transaction date.

**Architecture:** Four surgical changes. (1–2) `GeneralLedgerView` UI state only. (3) `AppContext.addCase` stamps the auto-created invoice with `issue_date = caseData.delivery_date` and `created_at` backdated to that date; `ledgerDomain.buildLedgerEntries` already sorts invoices by `created_at` timestamp so the row files behind newer entries automatically. Existing rows keep old dates (no migration). (4) `BatchInvoicePrintModal` swaps per-invoice `PrintDocument` sheets for one `kind="statement"` document fed all selected invoices.

**Tech Stack:** React 19, existing domain functions, existing printRenderer.

## Global Constraints

- NO git commits, NO dependency installs (sponsored run).
- Preserve all accounting arithmetic (ledger engine math untouched).
- Existing rows' dates never rewritten; fix is forward-looking.
- Plan verified by: vitest suite, tsc, vite build, browser visual check.

---

### Task 1: Ledger preview hidden until Preview clicked

**Files:**
- Modify: `src/components/billing/GeneralLedgerView.tsx` (line ~52 state init)

- [ ] **Step 1: Change default state**

```tsx
const [isPreviewActive, setIsPreviewActive] = useState<boolean>(false);
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` silent; open app, ledger table hidden, Preview button shows it.

### Task 2: Clinic dropdown empty default, no consolidated mode

**Files:**
- Modify: `src/components/billing/GeneralLedgerView.tsx`

- [ ] **Step 1: Empty default**

```tsx
const [selectedClinicId, setSelectedClinicId] = useState<string>('');
```

- [ ] **Step 2: Ledger data guard** — line ~174 memo returns `[]` unless a clinic is picked:

```tsx
return selectedClinicId ? (getLedgerEntries(selectedClinicId) || []) : [];
```

- [ ] **Step 3: Remove "All Saved Clinics" option block** (button at ~lines 547–569) and its display branch (`All Saved Clinics (Consolidated)` at ~505, X-clear button at ~511). Dropdown trigger shows placeholder `Select clinic…` when none picked.

- [ ] **Step 4: Empty-state in preview area** — before the banner/table blocks:

```tsx
{!selectedClinic ? (
  <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
    <Building2 className="mx-auto mb-2 w-8 h-8 text-slate-300" />
    <p className="text-sm font-bold text-slate-600">Select a clinic to view its ledger</p>
    <p className="text-xs text-slate-400 mt-1">Pick a clinic above to load transactions.</p>
  </div>
) : ( ...existing banner + table... )}
```

- [ ] **Step 5: PDF/CSV export guards** — early `return` in `handleExportPDF`/`handleExportCSV` when `!selectedClinic`; clinicLabel falls back to clinic name only.

- [ ] **Step 6: Verify** — tsc + click-through: no consolidated option anywhere; ledger empty until pick; export buttons inert before pick.

### Task 3: Backdated case entries book at business date

**Files:**
- Modify: `src/context/AppContext.tsx` (addCase, ~line 950–966)
- Modify: `src/services/ledgerDomain.ts` (buildLedgerEntries invoice event, ~line 176)
- Test: `tests/services/ledgerDomain.test.ts`

- [ ] **Step 1: Failing test** — invoice with `created_at` in the past files before one created today:

```ts
it('files invoices by their created_at (issue) date, not insertion order', () => {
  const entries = buildLedgerEntries({ invoices: [
    mkInvoice({ id: 'new', invoice_number: 'INV-0002', created_at: '2026-09-28', final_amount: 100 }),
    mkInvoice({ id: 'old', invoice_number: 'INV-0001', created_at: '2026-09-01', final_amount: 100 }),
  ], advancePayments: [], accountAdjustments: [] });
  expect(entries.map((e) => e.reference_number)).toEqual(['INV-0001', 'INV-0002']);
});
```

Run `npx vitest run tests/services/ledgerDomain.test.ts` → PASS (engine already uses `new Date(inv.created_at)`; test locks the contract the UI change relies on).

- [ ] **Step 2: Stamp business date in addCase** — inside the `newInvoice` literal:

```tsx
issue_date: caseData.delivery_date,
due_date: caseData.delivery_date,
created_at: caseData.delivery_date || nowStr.split(' ')[0],
```

(`delivery_date` is user-editable in the case form → backdating works; invoice timestamp then derives from business date.)

- [ ] **Step 3: Verify** — vitest suite green; create backdated case in browser, ledger shows row under its business date behind newer rows.

### Task 4: Batch print = one summary sheet

**Files:**
- Modify: `src/components/billing/BatchInvoicePrintModal.tsx` (preview block ~lines 216–246)
- Modify: `src/components/print/printRenderer.tsx` (statementInvoices, ~line 124)

- [ ] **Step 1: printRenderer accepts invoice list** — props + body:

```tsx
invoices?: Invoice[] | null;
...
const statementInvoices: Invoice[] = invoices ? [...invoices] : (invoice ? [invoice] : []);
```

- [ ] **Step 2: Modal renders one summary doc** — replace the `selected.map(... PrintDocument kind="invoice" ...)` block:

```tsx
<PrintDocument
  kind="statement"
  sections={loadDocumentSections('statement', DEFAULT_ENABLED.statement)}
  branding={brandingSettings}
  printSettings={printSettings}
  invoices={selected}
  labName={selectedClinic?.name}
  period={{ from, to }}
/>
```

(no `.print-doc-page` wrapper → no forced page breaks; header shows clinic + period, table lists invoice/case/amount/balance, totals at end.)

- [ ] **Step 3: Verify** — open Batch Print, select several unpaid invoices, preview = single continuous sheet, browser print preview shows 1 page for small batches.

### Task 5: Gates

- [ ] `npx vitest run` all green
- [ ] `npx tsc --noEmit` silent
- [ ] `npx vite build` green
- [ ] Browser visual check of Tasks 1/2/4 via preview tab

---

## Shipped after the original plan (same session, uncommitted then committed)

### Task 6: Business-date stamping for advances, credit notes, refunds ✅

**Files:**
- `src/services/transactionDomain.ts` — `prepareAdvanceDeposit` + `buildCreditNoteAdjustment` honor `command.date` (default today).
- `src/context/hooks/useTransactionCommands.ts` — `recordAdvanceDepositV2` / `issueCreditNoteV2` command types gain `date?: string`.
- `src/context/AppContext.tsx` — `recordAccountAdjustment` gains optional 7th `date` param (`date || today`); `issueCreditNoteV2` interface gains `date?: string`.
- `src/components/billing/RecordTransactionModal.tsx` — payment/advance/credit-note/refund branches all pass the modal's picked date.
- `src/services/ledgerDomain.ts` — `buildLedgerEntries` sorts advances by `payment_date || created_at` and adjustments by `date || created_at` (business date first; created_at only fallback).
- Test: `tests/services/ledgerDomain.test.ts` — locks chronology across all four entry kinds (invoice → payment → advance → credit note) regardless of record time.

### Task 7: Dead legacy writers deleted ✅

- `recordAdvancePayment` (AppContext interface + impl + context obj) — zero callers; superseded by `recordAdvanceDepositV2`. Orphans removed: `generateAdvanceNumber` helper, `nextAdvanceNumber` + `buildAdvanceDepositNotification` imports.
- `recordPayment` (AppContext interface + ~96-line impl + context obj) — zero callers; superseded by `recordTransactionV2`. Orphan removed: `buildPaidInFullNotification` import.

### Task 8: Bulk Mark Paid gets a settlement date ✅

- `src/context/AppContext.tsx` — `bulkMarkPaid(invoiceIds, paymentDate?)`; settlement payments, receipts, journals and audit events stamp the picked date (default today).
- `src/components/billing/BillingView.tsx` — `bulkPayDate` state + native date input shown next to the Bulk Mark Paid button while invoices are selected; confirm dialog echoes the date.

**Gate status at Task 8 close:** 167/167 vitest, tsc silent, vite build green.
