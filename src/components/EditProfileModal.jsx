import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Input } from './ui';

const ROLES = [
  { id: 'photographer', label: 'Fotograaf' },
  { id: 'model', label: 'Model' },
  { id: 'artist', label: 'Artist' },
  { id: 'stylist', label: 'Stylist' },
  { id: 'mua', label: 'MUA' },
  { id: 'fan', label: 'Fan' },
];

export default function EditProfileModal({ profile, onSave, onClose }) {
  const [form, setForm] = useState(profile || {});
  const [error, setError] = useState(null);

  const toggleRole = (role) => {
    setForm((prev) => {
      const roles = prev.roles || [];
      return roles.includes(role)
        ? { ...prev, roles: roles.filter((r) => r !== role) }
        : { ...prev, roles: [...roles, role] };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-3xl w-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Profiel</p>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Bewerk profiel</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
            <X />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Input label="Naam" value={form.displayName || ''} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            <Input label="Website" value={form.website || ''} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </div>
          <Input
            label="Bio"
            multiline
            placeholder="Wie ben je, wat doe je?"
            value={form.bio || ''}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
          />
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Rollen</p>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((role) => (
                <button
                  type="button"
                  key={role.id}
                  onClick={() => toggleRole(role.id)}
                  className={`px-3 py-2 rounded-full text-sm border ${form.roles?.includes(role.id) ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300'}`}
                >
                  {role.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose} className="justify-center">
              Sluiten
            </Button>
            <Button type="submit" className="justify-center">
              Opslaan
            </Button>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </form>
      </div>
    </div>
  );
}
