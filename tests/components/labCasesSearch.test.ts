import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The clinic case list gained a search box and a patient-name column.
 *
 * The search itself is component state, so this file pins two things that are
 * easy to break silently:
 *
 *  1. The haystack covers every column an operator might type into — a search
 *     that only matches the case number looks broken the moment someone searches
 *     for a patient, which is the thing they actually search for.
 *  2. Patient name is rendered on each card, not just searchable. Searching for
 *     a name you cannot see is a poor substitute for showing it.
 *
 * The matching rules themselves (AND across tokens, punctuation-insensitive for
 * digits) are the reason the box behaves the way an operator expects: "ali pfm"
 * narrows rather than widens, and "ds0048" finds "DS-0048".
 */

const src = readFileSync(
  join(process.cwd(), 'src/components/labs/LabDetailModal.tsx'),
  'utf8'
);

describe('the clinic case search covers every useful field', () => {
  const haystack = src.slice(
    src.indexOf('const caseHaystack'),
    src.indexOf('const caseQuery =')
  );

  it('matches patient name', () => expect(haystack).toMatch(/c\.patient_name/));
  it('matches case number', () => expect(haystack).toMatch(/c\.case_number/));
  it('matches doctor name', () => expect(haystack).toMatch(/c\.doctor_name/));
  it('matches material', () => expect(haystack).toMatch(/c\.case_type_name/));
  it('matches shade', () => expect(haystack).toMatch(/c\.shade/));
  it('matches status and priority', () => {
    expect(haystack).toMatch(/c\.status/);
    expect(haystack).toMatch(/c\.priority/);
  });
  it('matches delivery date and teeth', () => {
    expect(haystack).toMatch(/c\.delivery_date/);
    expect(haystack).toMatch(/selected_teeth/);
  });

  it('is lower-cased so matching is case-insensitive', () => {
    expect(haystack).toMatch(/\.toLowerCase\(\)/);
    expect(src).toMatch(/caseSearch\.trim\(\)\.toLowerCase\(\)/);
  });

  it('narrows with every word typed rather than widening on any of them', () => {
    /* An OR search can only ever return more rows as you type, which is the
       opposite of what narrowing by successive words means to an operator. */
    expect(src).toMatch(/caseQueryTokens\.every\(/);
    expect(src).toMatch(/split\(\/\\s\+\/\)/);
  });

  it('matches digits against a copy with the punctuation removed', () => {
    /* "ds0123" for "DS-0123". The hyphen is the single most common reason a
       search box appears broken to the person using it. The behaviour is pinned
       in labCaseSearchMatching.test.ts, which is where the regression lives. */
    expect(src).toMatch(/replace\(\/\[\^a-z0-9\]\/g, ''\)/);
    expect(src).toMatch(/entry\.bare\.includes\(bareToken\)/);
  });

  it('is wired to a visible, labelled, clearable input', () => {
    expect(src).toMatch(/type="search"/);
    expect(src).toMatch(/aria-label="Search cases for this clinic"/);
    expect(src).toMatch(/setCaseSearch\(''\)/);
    expect(src).toMatch(/aria-label="Clear search"/);
  });

  it('reports how many of the total are showing', () => {
    expect(src).toMatch(/\{labCases\.length\} of \{allLabCases\.length\}/);
  });

  it('counts the filtered list in the tab label only while searching', () => {
    /* Before a search the tab must show the real case count, not a filtered one
       that happens to equal the total because the box is empty. */
    expect(src).toMatch(/caseQuery \? labCases\.length : allLabCases\.length/);
  });
});

describe('the filtered-empty state is not the never-had-cases state', () => {
  it('offers Clear search rather than Create First Case when nothing matched', () => {
    /* Telling someone with 40 cases to "Create First Case" because their search
       found nothing is the kind of small wrongness that costs trust in the
       whole screen. */
    expect(src).toMatch(/No case matches/);
    expect(src).toMatch(/Create First Case/);
    expect(src).toMatch(/allLabCases\.length === 0 \?/);
  });
});

describe('patient name is on the card, not only in the search index', () => {
  it('renders the patient name beside the case number', () => {
    expect(src).toMatch(/\{c\.patient_name \|\|/);
  });

  it('says so plainly when a case has no patient name on file', () => {
    expect(src).toMatch(/No patient name/);
  });
});

describe('the delete button is never blocked by history', () => {
  /* The button was gated on `disabled={labCases.length > 0}`, which made it
     unusable for exactly the clinics anyone would want to delete: a clinic with
     cases. Removing the reassignment prompt without removing the gate would have
     looked like the feature worked and silently done nothing. */
  it('is never disabled', () => {
    expect(src).not.toMatch(/disabled=\{labCases\.length > 0\}/);
    expect(src).toMatch(/onClick=\{\(\) => \{ setDeleteModalOpen\(true\)/);
  });

  it('no longer promises the operator they can reassign cases away', () => {
    expect(src).not.toMatch(/resolve or reassign them before deleting/);
  });

  it('shows what will be destroyed, with money totalled, before they type DELETE', () => {
    expect(src).toMatch(/Will be permanently deleted/);
    expect(src).toMatch(/deletionImpact\.totalPaid/);
    expect(src).toMatch(/deletionImpact\.totalBilled/);
    expect(src).toMatch(/type="text"[\s\S]{0,400}confirmInput/);
    expect(src).toMatch(/confirmInput\.trim\(\) !== 'DELETE'/);
  });

  it('resets the typed confirmation each time the dialog opens', () => {
    /* Otherwise typing DELETE, cancelling, and reopening leaves it armed. */
    expect(src).toMatch(/setConfirmInput\(""\)/);
  });
});

describe('the clinic ledger is the shared General Ledger, not a second one', () => {
  /* The tab was originally a bespoke ledger table with its own payment index
     and row matcher. Two implementations of the same figures are free to
     disagree, and the operator asked for "the same general ledger that we have
     in reports and analytics" — one component, one set of numbers. */
  it('renders GeneralLedgerView, locked to this clinic', () => {
    expect(src).toMatch(/activeTab === 'ledger' && <GeneralLedgerView lockedClinicId=\{lab\.id\} \/>/);
  });

  it('offers the tab again, and still accepts it as an initial tab', () => {
    expect(src).toMatch(/initialTab\?: 'cases' \| 'ledger' \| 'info' \| 'contacts' \| 'pricing'/);
    expect(src).toMatch(/id: 'ledger', label: 'Account Ledger'/);
  });

  it('keeps the bespoke ledger implementation deleted', () => {
    expect(src).not.toMatch(/ledgerRowMeta/);
    expect(src).not.toMatch(/paymentIndex/);
    expect(src).not.toMatch(/getLedgerEntries/);
    expect(src).not.toMatch(/getLabFinancialSummary/);
  });
});

describe('the embedded ledger cannot be pointed at a different clinic', () => {
  const ledger = readFileSync(
    join(process.cwd(), 'src/components/billing/GeneralLedgerView.tsx'),
    'utf8'
  );

  it('takes an optional lockedClinicId', () => {
    expect(ledger).toMatch(/lockedClinicId\?: string/);
  });

  it('prefers the lock over whatever was picked', () => {
    expect(ledger).toMatch(/const selectedClinicId = lockedClinicId \?\? pickedClinicId/);
  });

  it('hides the clinic picker when locked', () => {
    /* Offering a picker inside one clinic's own page would let an operator read
       a different clinic's statement there — the kind of confusion that ends
       with the wrong statement sent to a clinic. */
    expect(ledger).toMatch(/\{!lockedClinicId && \(\s*<ClinicPicker/);
  });

  it('still shows the picker when not locked', () => {
    /* The Analytics & Reports tab has to keep letting the operator choose. */
    expect(ledger).toMatch(/lockedClinicId \?\? pickedClinicId/);
    expect(ledger).toMatch(/onChange=\{setPickedClinicId\}/);
  });
});