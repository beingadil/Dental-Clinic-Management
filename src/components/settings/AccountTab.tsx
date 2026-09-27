import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  User,
  CheckCircle2,
  AlertCircle,
  Lock,
  Check,
} from 'lucide-react';

/** TAB: MY ACCOUNT & SECURITY — extracted verbatim from SettingsView (P3 split). */
export const AccountTab: React.FC = () => {
  const { user, updateUser, changePassword } = useApp();

  const [accountForm, setAccountForm] = useState({
    name: user?.name || '',
    username: user?.username || '',
    email: user?.email || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [accountMsg, setAccountMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-slate-100 text-slate-700 rounded-lg">
            <User className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">My Account Profile & Security</h2>
            <p className="text-xs text-slate-500">Update your account display name, login username, email, or security password</p>
          </div>
        </div>
      </div>

      {accountMsg && (
        <div className={`p-3.5 rounded-2xl text-xs font-semibold flex items-center gap-2 ${
          accountMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
        }`}>
          {accountMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
          <span>{accountMsg.text}</span>
        </div>
      )}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setAccountMsg(null);
          if (!user) return;

          // Password change logic
          if (accountForm.newPassword) {
            if (accountForm.newPassword !== accountForm.confirmPassword) {
              setAccountMsg({ type: 'error', text: 'New passwords do not match.' });
              return;
            }
            const res = await changePassword(user.id, accountForm.currentPassword, accountForm.newPassword);
            if (!res.success) {
              setAccountMsg({ type: 'error', text: res.message });
              return;
            }
          }

          updateUser(user.id, {
            name: accountForm.name,
            username: accountForm.username,
            email: accountForm.email
          });

          setAccountMsg({ type: 'success', text: 'Account settings & credentials updated successfully!' });
          setAccountForm((prev) => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
          setTimeout(() => setAccountMsg(null), 4000);
        }}
        className="space-y-5"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Full Display Name</label>
            <input
              type="text"
              required
              value={accountForm.name}
              onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Login Username</label>
            <input
              type="text"
              required
              value={accountForm.username}
              onChange={(e) => setAccountForm({ ...accountForm, username: e.target.value })}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Email Address</label>
            <input
              type="email"
              required
              value={accountForm.email}
              onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value })}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 space-y-4">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Lock className="w-4 h-4 text-indigo-600" /> Change Security Password
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Current Password</label>
              <input
                type="password"
                placeholder="Enter current password"
                value={accountForm.currentPassword}
                onChange={(e) => setAccountForm({ ...accountForm, currentPassword: e.target.value })}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">New Password</label>
              <input
                type="password"
                placeholder="New password"
                value={accountForm.newPassword}
                onChange={(e) => setAccountForm({ ...accountForm, newPassword: e.target.value })}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                placeholder="Confirm new password"
                value={accountForm.confirmPassword}
                onChange={(e) => setAccountForm({ ...accountForm, confirmPassword: e.target.value })}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Save Profile Changes</span>
          </button>
        </div>
      </form>
    </div>
  );
};
