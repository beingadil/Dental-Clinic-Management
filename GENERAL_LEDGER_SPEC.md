# General Ledger — Portable Specification

This document describes the **General Ledger** feature of the Dental Clinic
software, extracted so it can be implemented in another application with the
same design. It covers the data model, the posting engine, the sign
convention, the UI, filtering, exports and edge cases.

Everything here is the contract the rest of the clinic's billing (invoices,
payments, advances, adjustments, monthly statement) is built on. Implement
these rules exactly and the numbers will agree with the source system.

---

## 1. Purpose

A per-clinic, double-entry style ledger of **money movement against
receivables**. One row per posting (invoice raised, payment received, advance
deposit, credit note, debit adjustment, refund, write-off, opening balance).
Each row carries a running outstanding balance so the operator can see, at any
date, what a clinic owes or is owed.

Sign convention: **positive = clinic owes us (Dr), negative = credit (Cr)**.
Debits increase the receivable; credits decrease it.

---

## 2. Core data model

### 2.1 `LedgerEntry`

```ts
type LedgerEntryType =
  | 'invoice'
  | 'payment'
  | 'advance_payment'
  | 'advance_allocation'
  | 'credit_note'
  | 'write_off'
  | 'debit_adjustment'
  | 'refund'
  | 'opening_balance';

interface LedgerEntry {
  id: string;                  // 'ledg-{idx}-{reference_id}'
  date: string;                // 'YYYY-MM-DD' business date
  posted_at?: string;          // ISO instant — THE ordering key
  lab_id: string;              // clinic id
  lab_name: string;
  entry_type: LedgerEntryType;
  type?: LedgerEntryType;      // alias of entry_type
  reference_id: string;        // invoice_id / payment_id / advance_id / adjustment_id
  reference_number: string;    // INV-XXXX / PAY-XXXX / ADV-XXXX / ADJ-XXXX / OPENING
  case_id?: string;
  case_number?: string;
  doctor_name?: string;
  description: string;
  debit: number;               // receivable increase
  credit: number;              // receivable decrease
  running_balance: number;      // outstanding after this posting
  payment_method?: PaymentMethod;
  attachments_count?: number;
  attachments?: PaymentAttachment[];
  notes?: string;
  recorded_by?: string;
  journal_id?: string;
}
```

### 2.2 Source documents

- **Invoice**: `id, invoice_number, case_id, case_number, lab_id, lab_name,
  case_type_name, doctor_name, amount, discount, final_amount, amount_paid,
  payment_status, created_at (booking day), due_date, payments[]`.
- **PaymentRecord**: `id, payment_number?, invoice_id, amount, payment_date,
  payment_method (cash|bank|cheque|advance|…), payment_type?
  (advance_allocation when applying advance credit), advance_payment_id?,
  reference_number?, attachments[], notes?, recorded_by, case_id?, case_number?`.
- **AdvancePayment**: `id, payment_number, lab_id, lab_name, amount,
  allocated_amount, remaining_amount, payment_method, payment_date,
  created_at, notes?, attachments[], recorded_by`.
- **AccountAdjustment**: `id, adjustment_number, lab_id, lab_name,
  type ('credit_note' | 'debit_adjustment' | 'refund'), amount, reason,
  date, created_at, reference_number?, attachments[], recorded_by`.
- **DentalLab**: `id, name, doctor_name, phone, address, opening_balance,
  opening_balance_type ('debit' | 'credit'), created_at`.
- **DentalCase**: `id, case_number, patient_name, case_type_name, doctor_name,
  selected_teeth[], shade, material, received_date, delivery_date, status, history[]`.

### 2.3 Account codes (display only)

```
ACCOUNTS_RECEIVABLE: code '1100', name 'Accounts Receivable — Clinics'
```

---

## 3. Posting engine: `buildLedgerEntries(input)`

Inputs: `invoices[], advancePayments[], accountAdjustments[], labs?,
filterLabId?`.

Returns entries **newest-first** for the UI, but `running_balance` is
computed oldest-to-newest before reversing.

### 3.1 Rule 0 — Opening balance (per clinic)

For each lab with `opening_balance > 0`:
- dated at `lab.created_at` (or today) so it sorts ahead of every invoice;
- if `opening_balance_type === 'credit'`: debit 0, credit = opening;
- else: debit = opening, credit 0;
- entry_type `'opening_balance'`, reference_number `'OPENING'`.

### 3.2 Rule 1 — Invoices → Debit

For each invoice:
- business date = `invoice.created_at` (the booking day, NOT the delivery date);
- debit = `final_amount` (or `amount` if final missing);
- entry_type `'invoice'`, reference_number = invoice_number;
- case_id/case_number/doctor_name carried.

### 3.3 Rule 2 — Payments per invoice → Credit or memo

For each `payment` on the invoice:
- business date = `payment.payment_date || invoice.created_at`;
- if the payment applies advance credit
  (`payment_method === 'advance'` or `payment_type === 'advance_allocation'`):
  entry_type `'advance_allocation'`, debit 0, credit 0 (a 0/0 memo — the
  deposit already credited the ledger when banked);
- else: entry_type `'payment'`, debit 0, credit = `payment.amount`;
- timestamp offset by index so same-day payments sort after the invoice.

### 3.4 Rule 3 — Advance deposits → Credit

For each advance payment:
- business date = `payment_date || created_at`;
- entry_type `'advance_payment'`, debit 0, credit = `amount`;
- timestamp offset.

### 3.5 Rule 4 — Account adjustments

For each adjustment:
- business date = `date || created_at`;
- credit_note → entry_type `'credit_note'`, debit 0, credit = amount;
- debit_adjustment → entry_type `'debit_adjustment'`, debit = amount, credit 0;
- refund → entry_type `'refund'`, debit = amount, credit 0;
- timestamp offset.

### 3.6 Write-offs

entry_type `'write_off'`, debit 0, credit = amount (reduces receivable).

### 3.7 Ordering and running balance

1. Sort all raw events by `timestamp` ascending (oldest first). Tie-break is
   implicit in insertion order.
2. Walk oldest→newest: `running_balance += debit - credit`. Store on each entry.
3. Reverse the array for the UI (newest first). `running_balance` stays.

`filterLabId` restricts invoices/advances/adjustments/labs to one clinic.

---

## 4. UI design — General Ledger view

### 4.1 Layout

- **Filter row**: clinic picker (hidden when `lockedClinicId` is set), date
  range picker, Export PDF button, Preview button.
- **Empty state** when no clinic selected: "Select a clinic to view its ledger".
- **Clinic banner** when a clinic is selected: avatar initials, name, doctor,
  phone, address, and the statement period.
- **Ledger table** with columns:
  `Sr No. | Date | Clinic | Case/Job | Narration | Debit (PKR) | Credit (PKR) | Closing Balance`.
- **Opening balance row** (synthetic, amber, italic): "Balance brought
  forward" with the opening amount in the Closing column; only shown when
  there are entries.
- **Total period activity row** (tfoot): `Total Period Activity:` spanning
  first 5 cols, then total debits, total credits, `—`.
- **Closing balance bar** below the table: label + amount + Dr/Cr.
- **Pagination**: cap at 400 rows with "Show N more".

### 4.2 Narration (per entry_type)

| entry_type | badge | colour |
|---|---|---|
| invoice | Case Invoice | blue |
| payment (cash/bank/cheque) | Cash/Bank/Cheque Payment | emerald/indigo/purple |
| advance_payment | Advance Deposit | teal |
| advance_allocation | Advance Credit Applied | sky |
| credit_note | Credit | emerald |
| debit_adjustment | Debit | rose |
| refund | Refund | amber |
| write_off | Write Off | slate |
| opening_balance | Opening Balance / Opening Credit | amber/emerald |

Each row also shows the case detail block (patient, procedure, teeth, shade)
when an invoice row resolves to a case, and an invoice chip + payment voucher
chip for drill-down.

### 4.3 Settlement badge

For invoice rows only: Paid / Partial / Unpaid, derived from
`invoiceBalanceDue(invoice)` (not the stored `payment_status`, which drifts
after credit notes). Plus "Paid on {date}" when settled.

The decision AND the words come from one place — `invoiceSettlementStatus()`
and `SETTLEMENT_LABEL` in `src/services/financeDomain.ts` — and every other
surface reads them: the invoice register chip, the printed invoice's Status
column, the header's invoice pill, the sidebar's unpaid count, the dashboard's
overdue figures, the reminder and escalation sweeps, the invoice CSV and the
clinic summary. That makes "the ledger, the register and the paper agree" a
property of the code rather than a habit: `tests/components/invoiceStatusAgreement.test.tsx`
pins one invoice per state across the three of them. An invoice's status is
never read off the stored column anywhere in the UI.

### 4.4 Date filtering

- Default window = today (startDate = endDate = today).
- Opening balance = sum of `(debit - credit)` for all entries with
  `date < startDate`.
- Active entries = those with `startDate <= date <= endDate`.
- Entries after endDate are excluded.
- "All Time" preset clears both → all entries, no opening line unless
  startDate set.
- Running balance recomputed over the filtered set starting from openingBalance.

### 4.5 Permissions

- View: `ledger:view` (Super Admin, Audit Checker by default).
- Posting/editing payments: `canPost`.

---

## 5. PDF export

`buildLedgerPdf(entries[], meta)` produces a real PDF with:
- header: lab name, clinic label, period label, case filter (optional),
  account name/code, generated date;
- opening balance line;
- table: Date | Clinic | Case/Job | Narration | Debit | Credit | Closing;
- totals row: total debits, total credits;
- closing balance.

File name: `Ledger_{Clinic}_{CaseFilter}_{date}.pdf`.

---

## 6. Edge cases & invariants

1. **Business date, not created_at**: invoices use `created_at` as the
   booking day (the old case-edit bug copied delivery date into issue_date;
   never use issue_date for ledger posting).
2. **Advance allocations are 0/0 memos**: the deposit already credited the
   ledger when banked, so applying it later must not double-count.
3. **`collected` (monthly statement) == ledger Credit column** for the
   clinic-month, by construction.
4. **Running balance is per-clinic when filterLabId is set**, but the global
   engine walks all clinics in one chain for the unfiltered statement's
   carrying balances. For the per-clinic ledger view, filter first then walk.
5. **Opening balance is derived**, not stored as a row — editing the field
   re-posts the entry.
6. **Empty ledger** returns `[]`, not throw.
7. **Sort by posted_at timestamp**, not document number, to keep same-day
   ordering stable.
8. **Attachments** travel with entries for the voucher drill-down.

---

## 7. Suggested implementation order

1. Define types (§2).
2. Implement `buildLedgerEntries` (§3).
3. Implement `invoiceBalanceDue` + `formatPKR`.
4. Build the view (§4) with clinic picker + date range + table + opening row
   + totals + closing bar.
5. Add narration badges + case detail block + drill-down chips.
6. Add PDF export (§5).
7. Gate behind `ledger:view` permission.

---

## 8. Reference: key helper functions

- `getTodayStr()` → 'YYYY-MM-DD'.
- `formatDate(date)` → human date.
- `formatPKR(n)` → 'PKR 1,234'.
- `formatDoctorName(name, fallback)`.
- `invoiceBalanceDue(invoice)` → outstanding balance.
- `findCaseForEntry(entry, cases)` → resolved DentalCase.
- `caseDetailLines(case)` → `{label, value}[]`.
- `ledgerPrintDescription(case, title)` → compact print line.
- `attributeAdjustmentsToInvoices(invoices, adjustments)` → Map.

---

*Source: Dental Clinic software, General Ledger module.*
