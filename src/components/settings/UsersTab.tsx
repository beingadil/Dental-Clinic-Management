import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Users,
  Trash2,
  Key,
  UserPlus,
} from 'lucide-react';
import { Modal, DataTable } from '../common/ui';
import { useTransientMessage, TransientBanner } from '../common/useTransient';

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
  const [userMsg, flashUserMsg, clearUserMsg] = useTransientMessage(4000);
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
              clearUserMsg();
              setNewUserForm({ name: '', username: '', email: '', role: 'Technician', password: '' });
            }}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-600/20 flex items-center gap-2 cursor-pointer self-start sm:self-auto"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add New User</span>
          </button>
        </div>

        <TransientBanner message={userMsg} />

        {/* DataTable owns the header row, the row hover, the divide and the
            horizontal-scroll wrapper. It renders a BARE table on purpose — the card
            around this table belongs to the view, so adopting it cannot double the
            hairline. See common/ui/DataTable. */}
        <DataTable<{ id: string; name: string; username: string; email: string; role: string; created_at?: string }>
          data={visibleUsers}
          rowKey={(u) => u.id}
          emptyState={
            <div className="p-8 text-center text-ink-muted text-xs">
              No additional users registered. Click &quot;Add New User&quot; above to create one.
            </div>
          }
          columns={[
            {
              header: 'User & Name',
              render: (u) => (
                <span className="font-bold text-slate-900 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-[10px]">
                    {u.name ? u.name.substring(0, 2).toUpperCase() : 'US'}
                  </span>
                  {u.name}
                </span>
              ),
            },
            { header: 'Username', render: (u) => <span className="font-mono font-semibold text-slate-700">{u.username}</span> },
            { header: 'Email', render: (u) => <span className="text-slate-600">{u.email}</span> },
            {
              header: 'System Role',
              render: (u) => (
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    u.role === 'Lab Admin'
                      ? 'bg-indigo-100 text-indigo-700'
                      : u.role === 'Technician'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {u.role}
                </span>
              ),
            },
            { header: 'Joined Date', render: (u) => <span className="text-slate-500 text-[11px]">{u.created_at || '—'}</span> },
            {
              header: 'Actions',
              align: 'right',
              render: (u) => (
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
                        flashUserMsg('success', `User account "${u.name}" deleted.`);
                      }
                    }}
                    className="p-1.5 hover:bg-rose-50 rounded-lg text-rose-500 hover:text-rose-700 cursor-pointer"
                    title="Delete User"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      </div>

      {/* MODAL: ADD NEW USER
          Runs on `ui/Modal` rather than a hand-rolled overlay. This dialog was
          one of five that drew their own backdrop and close button and so had
          no Escape handling, no focus trap and no `role="dialog"` — meaning a
          keyboard user could tab straight out of it into the page behind, and a
          screen reader announced it as ordinary content.

          The bespoke header is preserved verbatim through `header`; Modal only
          takes over the backdrop, the card, the close button and the focus/Escape
          behaviour. */}
      <Modal
        open={showAddUserModal}
        onClose={() => setShowAddUserModal(false)}
        label="Add New System User"
        maxWidth="max-w-md"
        headerClassName="px-6 py-4"
        header={
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-base">Add New System User</h3>
              <p className="text-xs text-slate-500">Create login credentials for new staff member</p>
            </div>
          </div>
        }
      >
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
                flashUserMsg('success', `User "${newUserForm.name}" created successfully!`);
              }}
              className="space-y-4 text-xs p-6 pt-4"
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
      </Modal>

      {/* MODAL: RESET USER PASSWORD — same conversion as above. */}
      <Modal
        open={Boolean(resetPwdUserId)}
        onClose={() => setResetPwdUserId(null)}
        label="Reset Password"
        maxWidth="max-w-sm"
        headerClassName="px-6 py-3"
        header={
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-indigo-600" />
            <h3 className="font-extrabold text-slate-900 text-sm">Reset Password</h3>
          </div>
        }
      >
          <div className="space-y-4 p-6 pt-4">
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
                  if (!resetPwdUserId) return;
                  updateUser(resetPwdUserId, { password: resetPwdValue });
                  setResetPwdUserId(null);
                  flashUserMsg('success', 'User password reset successfully!');
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer"
              >
                Update Password
              </button>
            </div>
          </div>
      </Modal>
    </>
  );
};
