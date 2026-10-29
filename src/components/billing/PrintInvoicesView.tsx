import React from 'react';
import { PageHeader } from '../common/ui';
import { CaseListView } from '../cases/CaseListView';

/**
 * Print Invoices — a dedicated full-view surface under Billing. Reuses the
 * workstation's case selection + bulk action bar, but leads with the
 * "Print Invoices" pipeline so the operator lands on invoice printing instead
 * of job slips. The batch printer itself is the existing BulkPrintModal.
 */
export const PrintInvoicesView: React.FC = () => {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Print Invoices"
        subtitle="Select cases below, then batch-print their invoices. Job slips remain on the Dental Workstation."
      />
      <CaseListView primaryBulkType="invoices" />
    </div>
  );
};

export default PrintInvoicesView;
