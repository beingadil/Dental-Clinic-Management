import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Invoice } from '../../types';
import { 
  BarChart3, 
  BookmarkCheck, 
  Download, 
  Printer, 
  Trash2, 
  Search, 
  Calendar, 
  Building2,
  FileText,
  FileCheck
} from 'lucide-react';

interface BillingReportsViewProps {
  onPrintInvoice: (invoice: Invoice) => void;
  onViewCaseSlip: (caseItem: any) => void;
}

export const BillingReportsView: React.FC<BillingReportsViewProps> = ({
  onPrintInvoice,
  onViewCaseSlip,
}) => {
  const { invoices, cases, savedVouchers, deleteSavedVoucher } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'monthly' | 'vouchers'>('monthly');
  const [voucherSearch, setVoucherSearch] = useState<string>('');

  // Group invoices by Month (YYYY-MM) and then Dental Clinic
  const monthlyLabGroups = useMemo(() => {
    const groups: { [month: string]: { [labName: string]: { count: number; total: number; paid: number } } } = {};

    invoices.forEach((inv) => {
      const month = inv.created_at ? inv.created_at.substring(0, 7) : new Date().toISOString().substring(0, 7);
      if (!groups[month]) {
        groups[month] = {};
      }
      const clinicName = inv.lab_name || 'Dental Clinic';
      if (!groups[month][clinicName]) {
        groups[month][clinicName] = { count: 0, total: 0, paid: 0 };
      }
      groups[month][clinicName].count += 1;
      groups[month][clinicName].total += inv.final_amount;
      groups[month][clinicName].paid += (inv.amount_paid || 0);
    });

    return groups;
  }, [invoices]);

  // Export CSV of Monthly Statement
  const handleExportMonthlyCSV = () => {
    const csvRows = ['Month,Dental Clinic,Cases Billed,Total Amount (PKR),Collected (PKR),Remaining Unpaid (PKR)'];
    Object.entries(monthlyLabGroups).forEach(([month, labMap]) => {
      Object.entries(labMap).forEach(([labName, data]) => {
        csvRows.push(`"${month}","${labName}",${data.count},${data.total},${data.paid},${data.total - data.paid}`);
      });
    });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Dental_Solutions_Monthly_Billing_${new Date().toISOString().substring(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Filter saved vouchers
  const filteredVouchers = useMemo(() => {
    if (!voucherSearch.trim()) return savedVouchers;
    const q = voucherSearch.toLowerCase();
    return savedVouchers.filter((v) => {
      return (
        v.voucher_number.toLowerCase().includes(q) ||
        v.case_number.toLowerCase().includes(q) ||
        v.lab_name.toLowerCase().includes(q) ||
        v.doctor_name.toLowerCase().includes(q) ||
        (v.saved_by || '').toLowerCase().includes(q)
      );
    });
  }, [savedVouchers, voucherSearch]);

  return (
    <div className="space-y-5">
      
      {/* Sub-navigation bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveSubTab('monthly')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'monthly'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
            <span>Monthly Billing Breakdown</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-200 text-slate-700">
              {Object.keys(monthlyLabGroups).length} Months
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab('vouchers')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'vouchers'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookmarkCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Archived Slips & Vouchers</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-200 text-slate-700">
              {savedVouchers.length}
            </span>
          </button>
        </div>

        {activeSubTab === 'monthly' && (
          <button
            onClick={handleExportMonthlyCSV}
            className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export Monthly CSV</span>
          </button>
        )}

        {activeSubTab === 'vouchers' && (
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={voucherSearch}
              onChange={(e) => setVoucherSearch(e.target.value)}
              placeholder="Search voucher #, case #, clinic..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
          </div>
        )}
      </div>

      {/* Sub-Tab 1: Monthly Breakdown */}
      {activeSubTab === 'monthly' && (
        <div className="space-y-4">
          {Object.keys(monthlyLabGroups).length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
              No monthly billing records available.
            </div>
          ) : (
            Object.entries(monthlyLabGroups).map(([month, labMap]) => {
              const monthTotal = Object.values(labMap).reduce((s, d) => s + d.total, 0);
              const monthPaid = Object.values(labMap).reduce((s, d) => s + d.paid, 0);
              const monthDue = monthTotal - monthPaid;

              return (
                <div key={month} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                  {/* Month header */}
                  <div className="bg-slate-900 text-white px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-indigo-400" />
                      <span className="font-black text-sm">Billing Month: {month}</span>
                      <span className="text-xs text-slate-400 font-normal">
                        ({Object.keys(labMap).length} Active Clinics)
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span>Billed: <strong>PKR {monthTotal.toLocaleString()}</strong></span>
                      <span className="text-emerald-400">Paid: <strong>PKR {monthPaid.toLocaleString()}</strong></span>
                      <span className={monthDue > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                        Due: PKR {monthDue.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Clinics Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-500 uppercase text-[10px] tracking-wider">
                          <th className="py-2.5 px-4">Dental Clinic</th>
                          <th className="py-2.5 px-4 text-center">Cases Billed</th>
                          <th className="py-2.5 px-4 text-right">Total Billed</th>
                          <th className="py-2.5 px-4 text-right">Collected (Paid)</th>
                          <th className="py-2.5 px-4 text-right">Remaining Due</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {Object.entries(labMap).map(([labName, data]) => {
                          const rem = data.total - data.paid;
                          return (
                            <tr key={labName} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-2.5 px-4 font-bold text-slate-800 flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                <span>{labName}</span>
                              </td>
                              <td className="py-2.5 px-4 text-center font-semibold text-slate-600">
                                {data.count}
                              </td>
                              <td className="py-2.5 px-4 text-right font-bold text-slate-900 whitespace-nowrap">
                                PKR {data.total.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-4 text-right font-bold text-emerald-600 whitespace-nowrap">
                                PKR {data.paid.toLocaleString()}
                              </td>
                              <td className={`py-2.5 px-4 text-right font-bold whitespace-nowrap ${rem > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                                PKR {rem.toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Sub-Tab 2: Saved Vouchers */}
      {activeSubTab === 'vouchers' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
          {filteredVouchers.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              No saved vouchers recorded in audit log.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-bold uppercase text-[10px] text-slate-500 tracking-wider">
                    <th className="py-3 px-4">Voucher #</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3">Case #</th>
                    <th className="py-3 px-3">Dental Clinic</th>
                    <th className="py-3 px-3">Doctor</th>
                    <th className="py-3 px-3">Saved At</th>
                    <th className="py-3 px-3">Recorded By</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredVouchers.map((v) => {
                    const isInv = v.voucher_type === 'invoice';
                    return (
                      <tr key={v.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-900 font-mono whitespace-nowrap">
                          {v.voucher_number}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            isInv ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'
                          }`}>
                            {isInv ? <FileText className="w-3 h-3" /> : <FileCheck className="w-3 h-3" />}
                            <span>{isInv ? 'Invoice Voucher' : 'Workstation Slip'}</span>
                          </span>
                        </td>
                        <td className="py-3 px-3 font-bold text-indigo-600 font-mono whitespace-nowrap">
                          {v.case_number}
                        </td>
                        <td className="py-3 px-3 text-slate-800">
                          {v.lab_name}
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {v.doctor_name}
                        </td>
                        <td className="py-3 px-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                          {v.created_at}
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {v.saved_by || 'Staff'}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => {
                                if (isInv) {
                                  const inv = invoices.find(i => i.invoice_number === v.voucher_number || i.case_id === v.case_id);
                                  if (inv) onPrintInvoice(inv);
                                } else {
                                  const c = cases.find(cs => cs.case_number === v.case_number || cs.id === v.case_id);
                                  if (c) onViewCaseSlip(c);
                                }
                              }}
                              className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                              title="Re-print or View Voucher"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Re-Print</span>
                            </button>
                            <button
                              onClick={() => deleteSavedVoucher(v.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Delete Voucher Log"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  );
};
