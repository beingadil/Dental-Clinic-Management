import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { getTodayStr } from '../../utils/dateUtils';
import { Invoice } from '../../types';
import { PageHeader, TabsNav } from '../common/ui';
import { REPORTS_TABS, labelOf, type ReportsTab } from '../common/financeTabs';
import { AnalyticsView } from '../analytics/AnalyticsView';
import { ClinicAccountsTable } from '../billing/ClinicAccountsTable';
import { GeneralLedgerView } from '../billing/GeneralLedgerView';
import { AuditLogView } from '../billing/AuditLogView';
import { BillingReportsView } from '../billing/BillingReportsView';
import { RecordTransactionModal } from '../billing/RecordTransactionModal';
import { JournalEntryModal } from '../billing/JournalEntryModal';
import { ClinicStatementModal } from '../billing/ClinicStatementModal';
import { InvoiceStatementModal } from '../billing/InvoiceStatementModal';
import { CaseJobSlipModal } from '../cases/CaseJobSlipModal';

/**
 * Read-only side of the money: business intelligence, clinic balances, the
 * double-entry ledger, the immutable audit trail and the monthly statement
 * archives. Billing keeps the operational tabs (invoices, payments) — money in.
 * This view is money out, looked back on.
 */
export const ReportsView: React.FC = () => {
  const { labs, invoices, cases, setCurrentView } = useApp();

  const [activeTab, setActiveTab] = useState<ReportsTab>('overview');
  const [collectLabId, setCollectLabId] = useState<string | undefined>();
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [clinicStatementId, setClinicStatementId] = useState<string | null>(null);
  const [journalRefId, setJournalRefId] = useState<string | null>(null);
  const [printInvoice, setPrintInvoice] = useState<Invoice | null>(null);
  const [viewSlipCase, setViewSlipCase] = useState<any>(null);

  return (
    <div className="space-y-6 billing-module no-scrollbar">
      <PageHeader
        title="Analytics & Reports"
        subtitle="Business intelligence, clinic balances, double-entry ledger, audit trail & monthly statement archives"
        breadcrumbs={[{ label: 'Financial Hub' }, { label: labelOf(REPORTS_TABS, activeTab) }]}
      />

      <TabsNav
        activeTab={activeTab}
        onChange={setActiveTab}
        fit="fill"
        variant="pills"
        tabs={[...REPORTS_TABS]}
      />

      {activeTab === 'overview' && <AnalyticsView />}

      {activeTab === 'clinic_accounts' && (
        <ClinicAccountsTable
          labs={labs}
          invoices={invoices}
          cases={cases}
          todayStr={getTodayStr()}
          onCollect={(clinicId) => {
            setCollectLabId(clinicId);
            setIsRecordModalOpen(true);
          }}
          onStatement={(clinicId) => setClinicStatementId(clinicId)}
          onOpenClinics={() => setCurrentView('labs')}
        />
      )}

      {activeTab === 'general_ledger' && (
        <GeneralLedgerView />
      )}

      {activeTab === 'audit_log' && <AuditLogView />}

      {activeTab === 'statements' && (
        <BillingReportsView
          onPrintInvoice={(inv) => setPrintInvoice(inv)}
          onViewCaseSlip={(caseItem) => setViewSlipCase(caseItem)}
          /* `journalRefId` was initialised to null and rendered into a modal
             gated on it, but NOTHING ever called `setJournalRefId` — so the
             Double-Entry Journal Inspector on this page could never open, even
             though the identical inspector works from Billing. The statements
             tab is the only tab that lists saved vouchers, which is exactly
             where an auditor wants to trace one to its journal lines, so this
             is wired rather than deleted. */
          onOpenJournalModal={(refId) => setJournalRefId(refId)}
        />
      )}

      {/* Collect a payment against a clinic balance from the accounts table */}
      {isRecordModalOpen && (
        <RecordTransactionModal
          isOpen={isRecordModalOpen}
          onClose={() => {
            setIsRecordModalOpen(false);
            setCollectLabId(undefined);
          }}
          initialMode="payment"
          initialLabId={collectLabId}
          initialInvoiceId={undefined}
        />
      )}

      {/* Double-Entry Journal Entry Inspector Modal */}
      <JournalEntryModal
        isOpen={!!journalRefId}
        onClose={() => setJournalRefId(null)}
        referenceId={journalRefId || ''}
      />

      {/* Official Clinic Statement of Account Modal */}
      {clinicStatementId && (
        <ClinicStatementModal
          isOpen={!!clinicStatementId}
          onClose={() => setClinicStatementId(null)}
          clinicId={clinicStatementId}
        />
      )}

      {/* Invoice Statement Printable Modal */}
      {printInvoice && (
        <InvoiceStatementModal
          invoice={printInvoice}
          caseData={cases.find((c) => c.id === printInvoice.case_id || c.case_number === printInvoice.case_number)}
          onClose={() => setPrintInvoice(null)}
        />
      )}

      {/* Case Job Slip Modal */}
      {viewSlipCase && (
        <CaseJobSlipModal caseData={viewSlipCase} onClose={() => setViewSlipCase(null)} />
      )}
    </div>
  );
};