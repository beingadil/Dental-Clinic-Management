import { formatPKR } from '../../services/financeDomain';
import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { getTodayStr } from '../../utils/dateUtils';
import { Plus, Trash2, Tag } from 'lucide-react';
import { DataTable } from '../common/ui';
import { GlassSelect } from '../common/ui/GlassSelect';

interface LabPricingManagerProps {
  labId: string;
}

export const LabPricingManager: React.FC<LabPricingManagerProps> = ({ labId }) => {
  const { caseTypes, pricingOverrides, addPricingOverride, deletePricingOverride } = useApp();
  const labOverrides = pricingOverrides.filter((po) => po.lab_id === labId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [caseTypeId, setCaseTypeId] = useState(caseTypes[0]?.id || '');
  const [customPrice, setCustomPrice] = useState<number | ''>('');
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [effectiveDate, setEffectiveDate] = useState(getTodayStr());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    if (customPrice === '' || customPrice <= 0 || isNaN(customPrice)) {
      errs.customPrice = 'Custom price must be a positive number';
    }
    if (discountPercent < 0 || discountPercent > 100 || isNaN(discountPercent)) {
      errs.discountPercent = 'Discount percentage must be between 0 and 100';
    }
    if (!effectiveDate) {
      errs.effectiveDate = 'Effective date is required';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const selectedCT = caseTypes.find((ct) => ct.id === caseTypeId);
    if (!selectedCT) return;

    addPricingOverride({
      lab_id: labId,
      case_type_id: caseTypeId,
      case_type_name: selectedCT.name,
      standard_price: selectedCT.base_price,
      custom_price: customPrice as number,
      discount_percentage: discountPercent,
      effective_date: effectiveDate
    });

    setShowAddForm(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-ds-ink flex items-center gap-2">
            <Tag className="w-4 h-4 text-purple-600" /> Lab-Specific Custom Pricing & Discount Overrides
          </h3>
          <p className="text-xs text-ink-muted">
            Override default case material prices and apply contract discounts for this lab
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-1 bg-purple-600 text-white text-xs font-semibold rounded-lg hover:bg-purple-700 flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Add Custom Price
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="p-4 bg-purple-50/50 border border-purple-200 rounded-xl space-y-3">
          <h4 className="text-xs font-bold text-purple-900 uppercase">New Custom Contract Price</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ds-body mb-1">Case Material Type</label>
              <GlassSelect
                value={caseTypeId}
                onChange={(v) => {
                  setCaseTypeId(v);
                  const ct = caseTypes.find((c) => c.id === v);
                  if (ct) setCustomPrice(Math.round(ct.base_price * 0.9));
                }}
                ariaLabel="Case material type"
                className="w-full p-2 text-xs"
                options={caseTypes.map((ct) => ({ value: ct.id, label: `${ct.name} (Std ${formatPKR(ct.base_price)})` }))}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ds-body mb-1">Custom Price for this Lab (PKR) *</label>
              <input
                type="number"
                value={customPrice}
                onChange={(e) => setCustomPrice(Number(e.target.value))}
                className="w-full p-2 text-xs bg-ds-sunken border border-ds-line rounded-lg font-bold"
              />
              {errors.customPrice && <p className="text-[10px] text-rose-500 mt-0.5">{errors.customPrice}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-ds-body mb-1">Auto-Discount Percentage (%)</label>
              <input
                type="number"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(Number(e.target.value))}
                placeholder="10"
                className="w-full p-2 text-xs bg-ds-sunken border border-ds-line rounded-lg"
              />
              {errors.discountPercent && <p className="text-[10px] text-rose-500 mt-0.5">{errors.discountPercent}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-ds-body mb-1">Effective Date *</label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full p-2 text-xs bg-ds-sunken border border-ds-line rounded-lg"
              />
              {errors.effectiveDate && <p className="text-[10px] text-rose-500 mt-0.5">{errors.effectiveDate}</p>}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="submit"
              className="px-4 py-1.5 bg-purple-600 text-white text-xs font-semibold rounded-lg shadow-xs"
            >
              Save Custom Override
            </button>
          </div>
        </form>
      )}

      {/* DataTable renders a BARE table — it owns the thead/ds-th row, the
          divide-y tbody, the hover row state and the horizontal-scroll wrapper.
          The card above stays here, where it always was. */}
      <div className="bg-ds-surface/60 rounded-xl border border-ds-line overflow-hidden shadow-xs">
        <DataTable
          data={labOverrides}
          rowKey={(po) => po.id}
          emptyState={
            <div className="p-6 text-center text-xs text-ink-muted">
              No custom pricing overrides configured. Default case type prices will apply.
            </div>
          }
          columns={[
            {
              header: 'Case Type',
              className: 'py-2.5 font-bold text-ds-ink',
              render: (po) => po.case_type_name,
            },
            {
              header: 'Standard Base Price',
              className: 'py-2.5 text-ink-muted line-through',
              render: (po) => formatPKR(po.standard_price),
            },
            {
              header: 'Lab Contract Price',
              className: 'py-2.5 font-bold text-ink-success',
              render: (po) => formatPKR(po.custom_price),
            },
            {
              header: 'Auto Discount',
              className: 'py-2.5 text-purple-700 font-semibold',
              render: (po) => `${po.discount_percentage || 0}% OFF`,
            },
            {
              header: 'Effective Date',
              className: 'py-2.5 text-ink-muted',
              render: (po) => po.effective_date,
            },
            {
              header: 'Action',
              align: 'right',
              className: 'py-2.5',
              render: (po) => (
                <button
                  onClick={() => deletePricingOverride(po.id)}
                  className="p-1 text-ink-muted hover:text-ink-danger rounded"
                  title="Remove Override"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
};
