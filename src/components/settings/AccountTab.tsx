import React, { useState } from 'react';
import { useTransientMessage, TransientBanner } from '../common/useTransient';
import { useApp } from '../../context/AppContext';
import {
  User,
  Lock,
  Check,
} from 'lucide-react';

/** TAB: MY ACCOUNT & SECURITY — extracted verbatim from SettingsView (P3 split). */
export const AccountTab: React.FC = () => {
  const { user, users, updateUser, changePassword } = useApp();

  const [accountForm, setAccountForm] = useState({
    name: user?.name || '',
    username: user?.username || '',
    email: user?.email || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [accountMsg, flashAccountMsg, clearAccountMsg] = useTransientMessage(4000);

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

      <TransientBanner message={accountMsg} className="rounded-2xl font-semibold" />

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          clearAccountMsg();
          if (!user) return;

          /* Username must stay unique, exactly as the Add-User form enforces it.
             This screen wrote `username` straight through, so two accounts could
             end up sharing a login name — created here, invisible until the
             second person could no longer sign in unambiguously. */
          const wanted = accountForm.username.trim();
          if (wanted && wanted !== user.username) {
            const taken = users.some((u) => u.id !== user.id && u.username?.toLowerCase() === wanted.toLowerCase());
            if (taken) {
              flashAccountMsg('error', 'That username is already taken.');
              return;
            }
          }

          // Password change logic
          if (accountForm.newPassword) {
            if (accountForm.newPassword !== accountForm.confirmPassword) {
              flashAccountMsg('error', 'New passwords do not match.');
              return;
            }
            const res = await changePassword(user.id, accountForm.currentPassword, accountForm.newPassword);
            if (!res.success) {
              flashAccountMsg('error', res.message);
              return;
            }
          }

          updateUser(user.id, {
            name: accountForm.name,
            username: wanted,
            email: accountForm.email
          });

          flashAccountMsg('success', 'Account settings & credentials updated successfully!');
          setAccountForm((prev) => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
          /* No timer here: `flashAccountMsg` armed one when it was called on the
             line above, and the hook clears it on unmount. */
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
