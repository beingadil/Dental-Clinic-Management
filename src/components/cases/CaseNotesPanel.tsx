import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { MessageSquare, Plus, Edit2, Trash2, Check, X, User } from 'lucide-react';

interface CaseNotesPanelProps {
  caseId: string;
}

export const CaseNotesPanel: React.FC<CaseNotesPanelProps> = ({ caseId }) => {
  const { caseNotes, addCaseNote, editCaseNote, deleteCaseNote, user } = useApp();
  const notes = caseNotes[caseId] || [];

  const [newNoteText, setNewNoteText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) {
      setErrorMsg('Note content cannot be empty');
      return;
    }
    if (newNoteText.length > 500) {
      setErrorMsg('Note cannot exceed 500 characters');
      return;
    }

    addCaseNote(caseId, newNoteText.trim(), user ? user.name : 'Lab Technician');
    setNewNoteText('');
    setErrorMsg('');
  };

  const startEdit = (id: string, currentText: string) => {
    setEditingId(id);
    setEditText(currentText);
  };

  const saveEdit = (id: string) => {
    if (!editText.trim() || editText.length > 500) return;
    editCaseNote(caseId, id, editText.trim());
    setEditingId(null);
  };

  return (
    <div className="space-y-4">
      {/* Add New Note Input Form */}
      <form onSubmit={handleAddNote} className="space-y-2">
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
          Add Clinical / Technician Note
        </label>
        <div className="relative">
          <textarea
            value={newNoteText}
            onChange={(e) => {
              setNewNoteText(e.target.value);
              if (errorMsg) setErrorMsg('');
            }}
            maxLength={500}
            rows={3}
            placeholder="e.g. Doctor approved wax-up adjustment over phone; incisal translucency boosted to shade A2..."
            className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400 resize-none"
          />
          <div className="absolute right-3 bottom-3 text-[10px] text-slate-400">
            {newNoteText.length}/500 chars
          </div>
        </div>
        {errorMsg && <p className="text-xs text-rose-500 font-medium">{errorMsg}</p>}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!newNoteText.trim()}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg shadow-xs flex items-center gap-1.5 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Post Note</span>
          </button>
        </div>
      </form>

      {/* Notes Chronological Timeline */}
      <div className="space-y-3 pt-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Case Note History ({notes.length})
        </h4>

        {notes.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            No notes logged for this case yet.
          </div>
        ) : (
          <div className="space-y-3">
            {notes.map((n) => (
              <div
                key={n.id}
                className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2 relative"
              >
                <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-1.5">
                  <div className="flex items-center gap-2 font-semibold text-slate-800">
                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">
                      {n.author.substring(0, 2).toUpperCase()}
                    </div>
                    <span>{n.author}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <span>{n.created_at}</span>
                    <button
                      type="button"
                      onClick={() => startEdit(n.id, n.note_text)}
                      className="p-1 hover:text-blue-600 rounded"
                      title="Edit Note"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('Delete this case note?')) deleteCaseNote(caseId, n.id);
                      }}
                      className="p-1 hover:text-rose-600 rounded"
                      title="Delete Note"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {editingId === n.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      maxLength={500}
                      rows={2}
                      className="w-full p-2 text-xs bg-slate-50 border border-blue-400 rounded-lg focus:outline-none"
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => saveEdit(n.id)}
                        className="px-2.5 py-1 bg-blue-600 text-white text-[11px] font-semibold rounded flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" /> Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-2.5 py-1 bg-slate-200 text-slate-700 text-[11px] font-semibold rounded flex items-center gap-1"
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{n.note_text}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
