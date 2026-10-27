import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { PERMISSION_MODULES, DESTRUCTIVE_ACTIONS, ROLE_BASELINE, roleBaselineFor } from '../../services/permissions';
import type { UserProfile } from '../../types';
import {
  Users,
  Trash2,
  Key,
  UserPlus,
} from 'lucide-react';
import { Modal, DataTable } from '../common/ui';
import { useTransientMessage, TransientBanner } from '../common/useTransient';

/** TAB: USER MANAGEMENT (ADMIN ONLY) — extracted verbatim from SettingsView (P3 split). */
const ROLE_RIGHTS: Record<UserProfile['role'], string[]> = {
  'Super Admin': ['Everything: all modules, destructive actions, user management, settings.'],
  'Clinic Entry Manager': [
    'Cases: create, edit, status updates.',
    'Payments: receive, advance deposits.',
    'Notifications: send.',
    'No pricing edits, credit notes, refunds, voids, deletes, clinic CRUD or settings.',
  ],
  'Audit Checker': [
    'Read-only: dashboard, cases, clinics, billing views, Analytics & Reports (ledger, statements, audit trail), exports.',
    'No write actions anywhere.',
  ],
};

export const UsersTab: React.FC = () => {
  const { user, users, addUser, updateUser, deleteUser, labs, setUserClinicScope, setUserPermissions, roles, addRole, updateRole, deleteRole } = useApp();

  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    username: '',
    email: '',
    role: 'Clinic Entry Manager' as string,
    password: '',
    permissions: [...ROLE_BASELINE['Clinic Entry Manager']] as string[],
  });
  const [userMsg, flashUserMsg, clearUserMsg] = useTransientMessage(4000);
  const [resetPwdUserId, setResetPwdUserId] = useState<string | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState('');
  const [scopeUserId, setScopeUserId] = useState<string | null>(null);
  const [scopeSelected, setScopeSelected] = useState<string[]>([]);
  const [permUserId, setPermUserId] = useState<string | null>(null);
  const [permSelected, setPermSelected] = useState<string[]>([]);
  // RBAC v4: create / edit custom roles.
  const [roleModal, setRoleModal] = useState<{ mode: 'add' | 'edit'; id?: string; name: string; description: string; perms: string[] } | null>(null);

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
              setNewUserForm({ name: '', username: '', email: '', role: 'Clinic Entry Manager', password: '', permissions: [...ROLE_BASELINE['Clinic Entry Manager']] });
            }}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-600/20 flex items-center gap-2 cursor-pointer self-start sm:self-auto"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add New User</span>
          </button>
        </div>

        <TransientBanner message={userMsg} />

        {/* RBAC v4: roles — built-ins locked, custom roles editable. */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div>
              <p className="font-bold text-slate-800 text-xs">Roles</p>
              <p className="text-[10px] text-slate-500">Built-in roles are fixed. Create custom roles with their own default ticks, then assign them to users.</p>
            </div>
            <button
              onClick={() => setRoleModal({ mode: 'add', name: '', description: '', perms: [] })}
              className="px-3 py-2 bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-700 text-slate-700 font-bold text-[11px] rounded-xl cursor-pointer flex items-center gap-1.5 self-start sm:self-auto"
            >
              + New Role
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(roles || []).map((r) => {
              const inUse = users.filter((u) => u.role === r.name).length;
              return (
                <div
                  key={r.id}
                  className={`group flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] ${r.is_system ? 'bg-white border-slate-200' : 'bg-white border-indigo-200'}`}
                  title={r.description || r.name}
                >
                  <span className="font-bold text-slate-800">{r.name}</span>
                  <span className="text-slate-400">{inUse} user{inUse === 1 ? '' : 's'}</span>
                  {!r.is_system && (
                    <>
                      <button
                        onClick={() => setRoleModal({ mode: 'edit', id: r.id, name: r.name, description: r.description || '', perms: [...r.permissions] })}
                        className="text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
                        title="Edit role & default ticks"
                      >
                        ticks
                      </button>
                      <button
                        onClick={() => {
                          if (inUse > 0) { flashUserMsg('error', `"${r.name}" is assigned to ${inUse} user(s) — reassign them first.`); return; }
                          const done = deleteRole(r.id);
                          if (!done) flashUserMsg('error', `Could not delete "${r.name}".`);
                          else flashUserMsg('success', `Role "${r.name}" deleted.`);
                        }}
                        className="text-rose-500 hover:text-rose-700 font-bold cursor-pointer"
                        title="Delete role"
                      >
                        ×
                      </button>
                    </>
                  )}
                  {r.is_system && <span className="text-[9px] text-slate-400 uppercase">built-in</span>}
                </div>
              );
            })}
          </div>
        </div>

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
                    u.role === 'Super Admin'
                      ? 'bg-indigo-100 text-indigo-700'
                      : u.role === 'Clinic Entry Manager'
                        ? 'bg-emerald-100 text-emerald-800'
                        : u.role === 'Audit Checker'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {u.role}
                </span>
              ),
            },
            {
              header: 'Clinic scope',
              render: (u) => {
                const ids = (u as any).clinic_ids || [];
                return (
                  <span className="text-[11px] text-slate-600">
                    {ids.length ? `${ids.length} clinic(s)` : 'All clinics'}
                  </span>
                );
              },
            },
            { header: 'Joined Date', render: (u) => <span className="text-slate-500 text-[11px]">{u.created_at || '—'}</span> },
            {
              header: 'Actions',
              align: 'right',
              render: (u) => (
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => {
                      setPermUserId(u.id);
                      setPermSelected((u as any).permissions || []);
                    }}
                    className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-indigo-600 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    title="Permissions"
                  >
                    <span className="hidden sm:inline text-[11px]">Perms</span>
                  </button>
                  <button
                    onClick={() => {
                      setScopeUserId(u.id);
                      setScopeSelected((u as any).clinic_ids || []);
                    }}
                    className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-indigo-600 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    title="Clinic scope"
                  >
                    <span className="hidden sm:inline text-[11px]">Scope</span>
                  </button>
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
        maxWidth="max-w-4xl"
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

                void (async () => {
                  await addUser({
                    name: newUserForm.name.trim(),
                    username: newUserForm.username.trim().toLowerCase(),
                    email: newUserForm.email.trim() || `${newUserForm.username.trim().toLowerCase()}@localhost`,
                    role: newUserForm.role,
                    password: newUserForm.password,
                    permissions: newUserForm.role === 'Super Admin' ? [...ROLE_BASELINE['Super Admin']] : [...newUserForm.permissions],
                  });
                  setShowAddUserModal(false);
                  flashUserMsg('success', `User "${newUserForm.name}" created successfully!`);
                })();
              }}
              className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs p-6 pt-4"
            >
              {/* LEFT: identity + credentials */}
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Usman Tech"
                    value={newUserForm.name}
                    onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                    className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-1">Login Username *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. usman"
                    value={newUserForm.username}
                    onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                    className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl font-mono focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    placeholder="e.g. usman@localhost (optional)"
                    value={newUserForm.email}
                    onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                    className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-1">System Role *</label>
                  <select
                    value={newUserForm.role}
                    onChange={(e) => {
                      const role = e.target.value;
                      // Picking a role pre-ticks its baseline (built-in or custom); Super Admin can still adjust below.
                      setNewUserForm((f) => ({ ...f, role, permissions: [...roleBaselineFor(role)] }));
                    }}
                    className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl font-bold"
                  >
                    {['Super Admin', 'Clinic Entry Manager', 'Audit Checker', ...(roles || []).filter((r) => !r.is_system).map((r) => r.name)].map((roleName) => (
                      <option key={roleName} value={roleName}>{roleName}</option>
                    ))}
                  </select>
                </div>

                {/* Role rights summary — what this role may actually do. */}
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600">
                  <p className="font-bold text-slate-700 mb-1">Effective rights</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {(ROLE_RIGHTS[newUserForm.role] || [
                      `Custom role — the module tick list on the right sets exactly what this account may do.`,
                      (roles || []).find((r) => r.name === newUserForm.role)?.description || 'Adjust ticks before creating the user.',
                    ]).map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-1">Account Password *</label>
                  <input
                    type="password"
                    required
                    placeholder="Set initial password"
                    value={newUserForm.password}
                    onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                    className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
                  />
                </div>
              </div>

              {/* RIGHT: module permissions — exactly what this account will be allowed to do. */}
              <div className="space-y-2">
                <label className="block text-[13px] font-bold text-slate-700">Module permissions</label>
                <p className="text-[11px] text-slate-500">
                  Tick what this user may do in each module. You can change these later via the Perms button.
                </p>
                <div className="max-h-[26rem] overflow-y-auto rounded-xl border border-slate-200 p-3 space-y-2.5 bg-white">
                  {PERMISSION_MODULES.map((mod) => {
                    const keys = mod.actions.map((a) => a.key);
                    const allOn = keys.every((k) => newUserForm.permissions.includes(k));
                    const someOn = keys.some((k) => newUserForm.permissions.includes(k));
                    return (
                      <div key={mod.module} className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-bold text-slate-800 text-[13px]">{mod.module}</p>
                          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={allOn}
                              ref={(el) => { if (el) el.indeterminate = !allOn && someOn; }}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? Array.from(new Set([...newUserForm.permissions, ...keys]))
                                  : newUserForm.permissions.filter((k) => !keys.includes(k));
                                setNewUserForm((f) => ({ ...f, permissions: next }));
                              }}
                            />
                            <span className="font-semibold">{allOn ? 'all' : someOn ? 'some' : 'none'}</span>
                          </label>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {mod.actions.map((a) => {
                            const destructive = DESTRUCTIVE_ACTIONS.has(a.key);
                            const forcedSuper = destructive && newUserForm.role === 'Super Admin';
                            const disabled = forcedSuper || (destructive && newUserForm.role !== 'Super Admin');
                            return (
                              <label key={a.key} className={`flex items-center gap-2 text-[12px] text-slate-700 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
                                <input
                                  type="checkbox"
                                  disabled={disabled}
                                  checked={forcedSuper || newUserForm.permissions.includes(a.key)}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...newUserForm.permissions, a.key]
                                      : newUserForm.permissions.filter((k) => k !== a.key);
                                    setNewUserForm((f) => ({ ...f, permissions: next }));
                                  }}
                                />
                                <span>{a.label}{destructive ? ' (Super Admin only)' : ''}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="md:col-span-2 flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
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
      {/* MODAL: CLINIC SCOPE */}
      {scopeUserId && (
        <Modal
          open={!!scopeUserId}
          onClose={() => setScopeUserId(null)}
          label="Clinic scope"
          maxWidth="max-w-md"
        >
          <div className="p-6 space-y-4">
            <h3 className="font-extrabold text-slate-900 text-base">Clinic scope</h3>
            <p className="text-xs text-slate-500">
              Leave empty for unrestricted (all clinics). Assign clinics to narrow what this user sees.
            </p>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 p-2 space-y-1">
              {(labs || []).map((l: any) => (
                <label key={l.id} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scopeSelected.includes(l.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...scopeSelected, l.id]
                        : scopeSelected.filter((id: string) => id !== l.id);
                      setScopeSelected(next);
                    }}
                  />
                  <span>{l.name}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setScopeUserId(null)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (scopeUserId) setUserClinicScope(scopeUserId, scopeSelected);
                  setScopeUserId(null);
                }}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Save scope
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: PERMISSIONS */}
      {permUserId && (
        <Modal
          open={!!permUserId}
          onClose={() => setPermUserId(null)}
          label="Permissions"
          maxWidth="max-w-2xl"
        >
          <div className="p-6 space-y-4">
            <h3 className="font-extrabold text-slate-900 text-base">Permissions</h3>
            <p className="text-xs text-slate-500">
              Tick the actions this user may perform. Destructive actions are Super Admin only.
            </p>
            <div className="max-h-80 overflow-y-auto space-y-3">
              {PERMISSION_MODULES.map((mod) => {
                const keys = mod.actions.map((a) => a.key);
                const allOn = keys.every((k) => permSelected.includes(k));
                const someOn = keys.some((k) => permSelected.includes(k));
                return (
                  <div key={mod.module} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-bold text-slate-800 text-xs">{mod.module}</p>
                      <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allOn}
                          ref={(el) => { if (el) el.indeterminate = !allOn && someOn; }}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? Array.from(new Set([...permSelected, ...keys]))
                              : permSelected.filter((k) => !keys.includes(k));
                            setPermSelected(next);
                          }}
                        />
                        <span>all</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {mod.actions.map((a) => {
                        const destructive = DESTRUCTIVE_ACTIONS.has(a.key);
                        const disabled = destructive && !users.find((u) => u.id === permUserId)?.isSuperAdmin;
                        return (
                          <label key={a.key} className={`flex items-center gap-2 text-xs ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
                            <input
                              type="checkbox"
                              disabled={disabled}
                              checked={permSelected.includes(a.key)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...permSelected, a.key]
                                  : permSelected.filter((k) => k !== a.key);
                                setPermSelected(next);
                              }}
                            />
                            <span>{a.label}{destructive ? ' (Super Admin only)' : ''}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPermUserId(null)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (permUserId) setUserPermissions(permUserId, permSelected);
                  setPermUserId(null);
                }}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Save permissions
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: ROLE EDITOR (RBAC v4) — create or re-tick a custom role. */}
      {roleModal && (
        <Modal
          open={!!roleModal}
          onClose={() => setRoleModal(null)}
          label={roleModal.mode === 'add' ? 'New Role' : 'Edit Role'}
          maxWidth="max-w-2xl"
        >
          <div className="p-6 space-y-4">
            <h3 className="font-extrabold text-slate-900 text-base">{roleModal.mode === 'add' ? 'New Role' : `Edit Role: ${roleModal.name}`}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-bold text-slate-700 mb-1">Role name *</label>
                <input
                  type="text"
                  value={roleModal.name}
                  onChange={(e) => setRoleModal({ ...roleModal, name: e.target.value })}
                  placeholder="e.g. Production Supervisor"
                  className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-slate-700 mb-1">Description (shown on the user form)</label>
                <input
                  type="text"
                  value={roleModal.description}
                  onChange={(e) => setRoleModal({ ...roleModal, description: e.target.value })}
                  placeholder="e.g. Tracks production status, no billing access"
                  className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              These ticks are the defaults for NEW users created with this role. Existing users of the role keep their own per-user ticks — edit those from their Perms button. Destructive actions stay Super Admin only.
            </p>
            <div className="max-h-80 overflow-y-auto space-y-2.5">
              {PERMISSION_MODULES.map((mod) => {
                const keys = mod.actions.map((a) => a.key);
                const allOn = keys.every((k) => roleModal.perms.includes(k));
                const someOn = keys.some((k) => roleModal.perms.includes(k));
                return (
                  <div key={mod.module} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-bold text-slate-800 text-[13px]">{mod.module}</p>
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allOn}
                          ref={(el) => { if (el) el.indeterminate = !allOn && someOn; }}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? Array.from(new Set([...roleModal.perms, ...keys]))
                              : roleModal.perms.filter((k) => !keys.includes(k));
                            setRoleModal({ ...roleModal, perms: next });
                          }}
                        />
                        <span className="font-semibold">{allOn ? 'all' : someOn ? 'some' : 'none'}</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {mod.actions.map((a) => {
                        const destructive = DESTRUCTIVE_ACTIONS.has(a.key);
                        return (
                          <label key={a.key} className={`flex items-center gap-2 text-[12px] text-slate-700 ${destructive ? 'opacity-40' : 'cursor-pointer'}`}>
                            <input
                              type="checkbox"
                              disabled={destructive}
                              checked={roleModal.perms.includes(a.key)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...roleModal.perms, a.key]
                                  : roleModal.perms.filter((k) => k !== a.key);
                                setRoleModal({ ...roleModal, perms: next });
                              }}
                            />
                            <span>{a.label}{destructive ? ' (Super Admin only)' : ''}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRoleModal(null)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const clean = roleModal.name.trim();
                  if (!clean) { flashUserMsg('error', 'Role name is required.'); return; }
                  if (roleModal.mode === 'add') {
                    const created = addRole(clean, roleModal.description.trim(), roleModal.perms);
                    if (!created) { flashUserMsg('error', `Role name "${clean}" is already taken.`); return; }
                    flashUserMsg('success', `Role "${clean}" created.`);
                  } else if (roleModal.id) {
                    if ((['Super Admin', 'Clinic Entry Manager', 'Audit Checker'] as string[]).includes(clean)) {
                      flashUserMsg('error', 'That name is reserved for built-in roles.');
                      return;
                    }
                    updateRole(roleModal.id, { name: clean, description: roleModal.description.trim(), permissions: roleModal.perms });
                    flashUserMsg('success', `Role "${clean}" updated.`);
                  }
                  setRoleModal(null);
                }}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                {roleModal.mode === 'add' ? 'Create role' : 'Save role'}
              </button>
            </div>
          </div>
        </Modal>
      )}

    </>
  );
};
