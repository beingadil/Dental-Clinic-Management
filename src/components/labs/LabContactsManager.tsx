import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { LabContact, LabAddress } from '../../types';
import { UserCheck, MapPin, Plus, Trash2, Edit2, Check, ShieldAlert, Star } from 'lucide-react';

interface LabContactsManagerProps {
  labId: string;
}

export const LabContactsManager: React.FC<LabContactsManagerProps> = ({ labId }) => {
  const { 
    labContacts, 
    labAddresses, 
    addLabContact, 
    updateLabContact, 
    deleteLabContact, 
    addLabAddress, 
    updateLabAddress, 
    deleteLabAddress 
  } = useApp();

  const contacts = labContacts.filter((c) => c.lab_id === labId);
  const addresses = labAddresses.filter((a) => a.lab_id === labId);

  const [showAddContact, setShowAddContact] = useState(false);
  const [showAddAddress, setShowAddAddress] = useState(false);

  // Contact Form
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cRole, setCRole] = useState('');
  const [cNotes, setCNotes] = useState('');
  const [cPrimary, setCPrimary] = useState(false);
  const [contactErrs, setContactErrs] = useState<Record<string, string>>({});

  // Address Form
  const [aType, setAType] = useState<LabAddress['type']>('billing');
  const [aStreet, setAStreet] = useState('');
  const [aCity, setACity] = useState('Islamabad');
  const [aState, setAState] = useState('ICT');
  const [aPostal, setAPostal] = useState('44000');
  const [aCountry, setACountry] = useState('Pakistan');
  const [aDefault, setADefault] = useState(false);
  const [addressErrs, setAddressErrs] = useState<Record<string, string>>({});

  const validateContact = () => {
    const errs: Record<string, string> = {};
    if (!cName.trim() || cName.trim().length < 2 || cName.trim().length > 100) {
      errs.name = 'Name must be between 2 and 100 characters';
    }
    if (!cPhone.trim() || !/^[0-9+--\s()]{10,20}$/.test(cPhone.trim())) {
      errs.phone = 'Valid phone number required (10-15 digits)';
    }
    if (!cEmail.trim() || !/\S+@\S+\.\S+/.test(cEmail.trim())) {
      errs.email = 'Valid email address required';
    }
    setContactErrs(errs);
    return Object.keys(errs).length === 0;
  };

  const validateAddress = () => {
    const errs: Record<string, string> = {};
    if (!aStreet.trim() || aStreet.trim().length < 5 || aStreet.trim().length > 200) {
      errs.street = 'Street address must be between 5 and 200 characters';
    }
    if (!aCity.trim()) errs.city = 'City is required';
    if (!aState.trim()) errs.state = 'State is required';
    if (!aPostal.trim()) errs.postal_code = 'Postal code is required';
    setAddressErrs(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAddContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateContact()) return;

    addLabContact({
      lab_id: labId,
      name: cName.trim(),
      phone: cPhone.trim(),
      email: cEmail.trim(),
      role: cRole.trim() || 'Staff',
      notes: cNotes.trim(),
      is_primary: cPrimary
    });

    setCName('');
    setCPhone('');
    setCEmail('');
    setCRole('');
    setCNotes('');
    setCPrimary(false);
    setShowAddContact(false);
  };

  const handleAddAddressSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAddress()) return;

    addLabAddress({
      lab_id: labId,
      type: aType,
      street: aStreet.trim(),
      city: aCity.trim(),
      state: aState.trim(),
      postal_code: aPostal.trim(),
      country: aCountry.trim(),
      is_default: aDefault
    });

    setAStreet('');
    setShowAddAddress(false);
  };

  return (
    <div className="space-y-6">
      {/* Contacts Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-blue-600" /> Key Lab Contacts ({contacts.length})
          </h3>
          <button
            onClick={() => setShowAddContact(!showAddContact)}
            className="px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Add Contact
          </button>
        </div>

        {showAddContact && (
          <form onSubmit={handleAddContactSubmit} className="p-4 bg-blue-50/50 border border-blue-200 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-blue-900 uppercase">New Lab Contact Person</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  placeholder="e.g. Dr. Ayesha Malik"
                  className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
                />
                {contactErrs.name && <p className="text-[10px] text-rose-500 mt-0.5">{contactErrs.name}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Role / Designation</label>
                <input
                  type="text"
                  value={cRole}
                  onChange={(e) => setCRole(e.target.value)}
                  placeholder="e.g. Chief Prosthodontist"
                  className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number *</label>
                <input
                  type="text"
                  value={cPhone}
                  onChange={(e) => setCPhone(e.target.value)}
                  placeholder="+92 300 5551234"
                  className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
                />
                {contactErrs.phone && <p className="text-[10px] text-rose-500 mt-0.5">{contactErrs.phone}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address *</label>
                <input
                  type="email"
                  value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)}
                  placeholder="name@lab.pk"
                  className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
                />
                {contactErrs.email && <p className="text-[10px] text-rose-500 mt-0.5">{contactErrs.email}</p>}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={cPrimary}
                onChange={(e) => setCPrimary(e.target.checked)}
                className="rounded text-blue-600"
              />
              <span>Set as Primary Contact for this Lab</span>
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg"
              >
                Save Contact
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {contacts.map((c) => (
            <div key={c.id} className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-slate-900">{c.name}</span>
                  {c.is_primary && (
                    <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[9px] font-extrabold rounded uppercase">
                      Primary
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">{c.role || 'Staff'}</div>
                <div className="text-[11px] text-slate-600 mt-1 font-medium">{c.phone} • {c.email}</div>
              </div>
              <button
                onClick={() => deleteLabContact(c.id)}
                className="p-1.5 text-slate-400 hover:text-rose-600 rounded"
                title="Delete Contact"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Addresses Section */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-emerald-600" /> Lab Location Addresses ({addresses.length})
          </h3>
          <button
            onClick={() => setShowAddAddress(!showAddAddress)}
            className="px-3 py-1 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Add Address
          </button>
        </div>

        {showAddAddress && (
          <form onSubmit={handleAddAddressSubmit} className="p-4 bg-emerald-50/50 border border-emerald-200 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-emerald-900 uppercase">New Address Details</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Address Type</label>
                <select
                  value={aType}
                  onChange={(e) => setAType(e.target.value as any)}
                  className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
                >
                  <option value="billing">Billing Address</option>
                  <option value="shipping">Shipping / Dispatch Bay</option>
                  <option value="lab_location">Lab Main Facility</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Street Address *</label>
                <input
                  type="text"
                  value={aStreet}
                  onChange={(e) => setAStreet(e.target.value)}
                  placeholder="Suite 402, Blue Area..."
                  className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
                />
                {addressErrs.street && <p className="text-[10px] text-rose-500 mt-0.5">{addressErrs.street}</p>}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={aCity}
                onChange={(e) => setACity(e.target.value)}
                placeholder="City"
                className="p-2 text-xs bg-white border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                value={aState}
                onChange={(e) => setAState(e.target.value)}
                placeholder="State/Province"
                className="p-2 text-xs bg-white border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                value={aPostal}
                onChange={(e) => setAPostal(e.target.value)}
                placeholder="Postal Code"
                className="p-2 text-xs bg-white border border-slate-200 rounded-lg"
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={aDefault}
                onChange={(e) => setADefault(e.target.checked)}
                className="rounded text-emerald-600"
              />
              <span>Set as Default Dispatch Address</span>
            </label>

            <div className="flex justify-end">
              <button
                type="submit"
                className="px-4 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg"
              >
                Save Address
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {addresses.map((a) => (
            <div key={a.id} className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs uppercase text-slate-800">{a.type}</span>
                  {a.is_default && (
                    <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[9px] font-extrabold rounded uppercase">
                      Default
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {a.street}, {a.city}, {a.state} {a.postal_code}
                </div>
              </div>
              <button
                onClick={() => deleteLabAddress(a.id)}
                className="p-1.5 text-slate-400 hover:text-rose-600 rounded"
                title="Delete Address"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
