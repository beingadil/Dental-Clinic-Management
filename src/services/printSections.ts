/**
 * The account summary is printed as separately tickable rows, not one block.
 * This module is the single place the four row ids are defined: the print
 * renderer, the section catalog and the stored-list migration all read from
 * here so the three cannot disagree.
 *
 * Kept dependency-free on purpose. The print code imports it, and several
 * test files mock the rest of the print settings service with a deliberately
 * small surface — an extra constant imported from that module would vanish
 * under their mocks and crash the renderer.
 *
 * `balanceSummary` is the retired id the first single-toggle version of the
 * setting used; stored lists carrying it are expanded onto these four on
 * read, so an operator's paper never changes silently.
 */
export const ACCOUNT_BALANCE_ROWS = ['openingBalance', 'invoiceAmount', 'cashPaid', 'closingBalance'] as const;

export type AccountBalanceRow = (typeof ACCOUNT_BALANCE_ROWS)[number];

/** True for one of the four account-summary row ids (the retired id is not). */
export const isAccountBalanceRow = (id: string): boolean =>
  (ACCOUNT_BALANCE_ROWS as readonly string[]).includes(id);
