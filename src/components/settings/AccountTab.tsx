import React, { useState } from 'react';
import { useTransientMessage, TransientBanner } from '../common/useTransient';
import { useApp } from '../../context/AppContext';
import {
  User,
  Lock,
  Check,
  Edit2,
  Mail,
  AtSign,
} from 'lucide-react';

/** TAB: MY ACCOUNT & SECURITY — read-only summary first, edit on demand. */
export const AccountTab: React.FC = () => {
  const { user, users, updateUser, changePassword } = useApp();

  const [isEditing, setIsEditing] = useState(false);
  const [accountForm, setAccountForm] = useState({
    name: user?.name || '',
    username: user?.username || '',
    email: user?.email || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [accountMsg, flashAccountMsg, clearAccountMsg] = useTransientMessage(4000);

  const roleLabel = user?.role || 'User';
  const roleTone =
    roleLabel === 'Super Admin'
      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
      : roleLabel === 'Lab Admin'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : roleLabel === 'Billing Manager'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-slate-100 text-slate-700 border-slate-200';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAccountMsg();
    if (!user) return;

    const wanted = accountForm.username.trim();
    if (wanted && wanted !== user.username) {
      const taken = users.some((u) => u.id !== user.id && u.username?.toLowerCase() === wanted.toLowerCase());
      if (taken) {
        flashAccountMsg('error', 'That username is already taken.');
        return;
      }
    }

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
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setAccountForm({
      name: user?.name || '',
      username: user?.username || '',
      email: user?.email || '',
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    });
    clearAccountMsg();
    setIsEditing(false);
  };

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
        {!isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" /> Edit
          </button>
        )}
      </div>

      <TransientBanner message={accountMsg} className="rounded-2xl font-semibold" />

      {!isEditing ? (
        /* Read-only summary */
        <div className="space-y-4">
          <div className="flex items-center gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white font-bold text-lg flex items-center justify-center shrink-0">
              {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-slate-900 truncate">{user?.name || '—'}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${roleTone}`}>
                  {roleLabel}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <AtSign className="w-3 h-3" /> {user?.username || '—'}
                </span>
                <span className="flex items-center gap-1">
                  <Mail className="w-3 h-3" /> {user?.email || '—'}
                </span>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Click <strong>Edit</strong> above to change your display name, username, email, or security password.
          </p>
        </div>
      ) : (
        <form
          onSubmit={handleSave}
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

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={cancelEdit}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Save Profile Changes</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};