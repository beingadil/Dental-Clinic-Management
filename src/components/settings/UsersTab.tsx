import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Users,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Key,
  UserPlus,
  X,
} from 'lucide-react';

/** TAB: USER MANAGEMENT (ADMIN ONLY) — extracted verbatim from SettingsView (P3 split). */
export const UsersTab: React.FC = () => {
  const { user, users, addUser, updateUser, deleteUser } = useApp();

  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    username: '',
    email: '',
    role: 'Technician' as 'Lab Admin' | 'Technician' | 'Billing Manager',
    password: ''
  });
  const [userMsg, setUserMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [resetPwdUserId, setResetPwdUserId] = useState<string | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState('');

  // Super Admins manage accounts; hidden service rows never enter app state.
  const visibleUsers = users.filter((u) => !u.isSuperAdmin);
  void user; // role gate handled by the container (tab only rendered for admins)

  return (
    <>
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">System User Accounts</h2>
              <p className="text-xs text-slate-500">Only Admins can register new laboratory personnel or manage credentials</p>
            </div>
          </div>

          <button
            onClick={() => {
              setShowAddUserModal(true);
              setUserMsg(null);
              setNewUserForm({ name: '', username: '', email: '', role: 'Technician', password: '' });
            }}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-600/20 flex items-center gap-2 cursor-pointer self-start sm:self-auto"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add New User</span>
          </button>
        </div>

        {userMsg && (
          <div className={`p-3.5 rounded-2xl text-xs font-semibold flex items-center gap-2 ${
            userMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}>
            {userMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
            <span>{userMsg.text}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[10px] bg-slate-50/50">
                <th className="p-3">User & Name</th>
                <th className="p-3">Username</th>
                <th className="p-3">Email</th>
                <th className="p-3">System Role</th>
                <th className="p-3">Joined Date</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    No additional users registered. Click "Add New User" above to create one.
                  </td>
                </tr>
              ) : (
                visibleUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-bold text-slate-900 flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-[10px]">
                        {u.name ? u.name.substring(0, 2).toUpperCase() : 'US'}
                      </div>
                      {u.name}
                    </td>
                    <td className="p-3 font-mono font-semibold text-slate-700">{u.username}</td>
                    <td className="p-3 text-slate-600">{u.email}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        u.role === 'Lab Admin' ? 'bg-indigo-100 text-indigo-700' :
                        u.role === 'Technician' ? 'bg-amber-100 text-amber-800' :
                        'bg-emerald-100 text-emerald-800'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500 text-[11px]">{u.created_at || '—'}</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setResetPwdUserId(u.id);
                            setResetPwdValue('');
                          }}
                          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-indigo-600 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          title="Reset Password"
                        >
                          <Key className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline text-[11px]">Password</span>
                        </button>

                        <button
                          onClick={() => {
                            if (confirm(`Are you sure you want to remove user "${u.name}"?`)) {
                              deleteUser(u.id);
                              setUserMsg({ type: 'success', text: `User account "${u.name}" deleted.` });
                              setTimeout(() => setUserMsg(null), 4000);
                            }
                          }}
                          className="p-1.5 hover:bg-rose-50 rounded-lg text-rose-500 hover:text-rose-700 cursor-pointer"
                          title="Delete User"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: ADD NEW USER */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 border border-slate-200 shadow-2xl space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">Add New System User</h3>
                  <p className="text-xs text-slate-500">Create login credentials for new staff member</p>
                </div>
              </div>

              <button
                onClick={() => setShowAddUserModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newUserForm.username.trim() || !newUserForm.name.trim() || !newUserForm.password) {
                  return;
                }
                if (users.some((u) => u.username.toLowerCase() === newUserForm.username.trim().toLowerCase())) {
                  alert('Username already exists. Please choose a different username.');
                  return;
                }

                addUser({
                  name: newUserForm.name.trim(),
                  username: newUserForm.username.trim().toLowerCase(),
                  email: newUserForm.email.trim() || `${newUserForm.username.trim().toLowerCase()}@localhost`,
                  role: newUserForm.role,
                  password: newUserForm.password
                });

                setShowAddUserModal(false);
                setUserMsg({ type: 'success', text: `User "${newUserForm.name}" created successfully!` });
                setTimeout(() => setUserMsg(null), 4000);
              }}
              className="space-y-4 text-xs"
            >
              <div>
                <label className="block font-bold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Usman Tech"
                  value={newUserForm.name}
                  onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Login Username *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. usman"
                  value={newUserForm.username}
                  onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  placeholder="e.g. usman@localhost (optional)"
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">System Role *</label>
                <select
                  value={newUserForm.role}
                  onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value as any })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                >
                  <option value="Lab Admin">Lab Admin (Full Access)</option>
                  <option value="Technician">Technician (Lab Works & Cases)</option>
                  <option value="Billing Manager">Billing Manager (Invoices & Vouchers)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Account Password *</label>
                <input
                  type="password"
                  required
                  placeholder="Set initial password"
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-600/20 cursor-pointer flex items-center gap-1.5"
                >
                  <UserPlus className="w-4 h-4" /> Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESET USER PASSWORD */}
      {resetPwdUserId && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 border border-slate-200 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-indigo-600" />
                <h3 className="font-extrabold text-slate-900 text-sm">Reset Password</h3>
              </div>
              <button onClick={() => setResetPwdUserId(null)} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Set a new password for account <strong className="text-slate-900 font-mono">{users.find((u) => u.id === resetPwdUserId)?.username}</strong>:
            </p>

            <input
              type="password"
              placeholder="Enter new password"
              value={resetPwdValue}
              onChange={(e) => setResetPwdValue(e.target.value)}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setResetPwdUserId(null)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!resetPwdValue}
                onClick={() => {
                  updateUser(resetPwdUserId, { password: resetPwdValue });
                  setResetPwdUserId(null);
                  setUserMsg({ type: 'success', text: 'User password reset successfully!' });
                  setTimeout(() => setUserMsg(null), 4000);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer"
              >
                Update Password
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
