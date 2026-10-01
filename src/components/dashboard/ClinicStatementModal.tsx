import React, { useMemo } from 'react';
import { Invoice, DentalLab, DentalCase } from '../../types';
import { useApp } from '../../context/AppContext';
import { ClinicStatementModal as BillingClinicStatementModal } from '../billing/ClinicStatementModal';

/**
 * B8: there used to be two statement renderers — this 44 KB print-only copy and
 * the billing/ one (date ranges, ledger drill-down, RFC-4180 CSV export, print
 * settings). The dashboard entry point now resolves the clinic it was handed
 * and renders the single shared implementation, so both routes produce the
 * same statement.
 *
 * `invoices` / `cases` / `labs` props are still accepted for call-site
 * compatibility (DashboardView passes them) but the shared modal reads live
 * state from the app context.
 */
interface ClinicStatementModalProps {
  clinicName?: string;
  invoices?: Invoice[];
  cases?: DentalCase[];
  labs?: DentalLab[];
  onClose: () => void;
}

export const ClinicStatementModal: React.FC<ClinicStatementModalProps> = ({
  clinicName,
  onClose,
}) => {
  const { labs } = useApp();

  const clinicId = useMemo(() => {
    const wanted = (clinicName || '').trim().toLowerCase();
    if (wanted) {
      const match = labs.find((l) => l.name.trim().toLowerCase() === wanted);
      if (match) return match.id;
    }
    return labs[0]?.id ?? '';
  }, [labs, clinicName]);

  if (!clinicId) return null;

  return (
    <BillingClinicStatementModal isOpen onClose={onClose} clinicId={clinicId} />
  );
};
