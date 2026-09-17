import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DollarSign, Plus, Trash2, Tag, ShieldAlert } from 'lucide-react';

interface LabPricingManagerProps {
  labId: string;
}

export const LabPricingManager: React.FC<LabPricingManagerProps> = ({ labId }) => {
  const { caseTypes, pricingOverrides, addPricingOverride, deletePricingOverride } = useApp();
  const labOverrides = pricingOverrides.filter((po) => po.lab_id === labId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [caseTypeId, setCaseTypeId] = useState(caseTypes[0]?.id || '');
  const [customPrice, setCustomPrice] = useState<number>(13500);
  const [discountPercent, setDiscountPercent] = useState<number>(10);
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    if (customPrice <= 0 || isNaN(customPrice)) {
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
      custom_price: customPrice,
      discount_percentage: discountPercent,
      effective_date: effectiveDate
    });

    setShowAddForm(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
            <Tag className="w-4 h-4 text-purple-600" /> Lab-Specific Custom Pricing & Discount Overrides
          </h3>
          <p className="text-xs text-slate-500">
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">Case Material Type</label>
              <select
                value={caseTypeId}
                onChange={(e) => {
                  setCaseTypeId(e.target.value);
                  const ct = caseTypes.find((c) => c.id === e.target.value);
                  if (ct) setCustomPrice(Math.round(ct.base_price * 0.9));
                }}
                className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
              >
                {caseTypes.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name} (Std PKR {ct.base_price.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Custom Price for this Lab (PKR) *</label>
              <input
                type="number"
                value={customPrice}
                onChange={(e) => setCustomPrice(Number(e.target.value))}
                className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg font-bold"
              />
              {errors.customPrice && <p className="text-[10px] text-rose-500 mt-0.5">{errors.customPrice}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Auto-Discount Percentage (%)</label>
              <input
                type="number"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(Number(e.target.value))}
                placeholder="10"
                className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
              />
              {errors.discountPercent && <p className="text-[10px] text-rose-500 mt-0.5">{errors.discountPercent}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Effective Date *</label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
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

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        {labOverrides.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">
            No custom pricing overrides configured. Default case type prices will apply.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-bold text-slate-500">
                <th className="py-2.5 px-3">Case Type</th>
                <th className="py-2.5 px-3">Standard Base Price</th>
                <th className="py-2.5 px-3">Lab Contract Price</th>
                <th className="py-2.5 px-3">Auto Discount</th>
                <th className="py-2.5 px-3">Effective Date</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {labOverrides.map((po) => (
                <tr key={po.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-3 font-bold text-slate-900">{po.case_type_name}</td>
                  <td className="py-2.5 px-3 text-slate-500 line-through">PKR {po.standard_price.toLocaleString()}</td>
                  <td className="py-2.5 px-3 font-bold text-emerald-600">PKR {po.custom_price.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-purple-700 font-semibold">{po.discount_percentage || 0}% OFF</td>
                  <td className="py-2.5 px-3 text-slate-500">{po.effective_date}</td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => deletePricingOverride(po.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded"
                      title="Remove Override"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
