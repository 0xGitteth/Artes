import React, { useState } from 'react';
import { X, UploadCloud, Shield, Image as ImageIcon, Check } from 'lucide-react';
import { Button, Input } from './ui';

export default function UploadModal({ onClose, onPublish, initialStyles = [] }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    imageUrl: '',
    styles: initialStyles,
    makerTags: [],
  });
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await onPublish(form);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleArrayValue = (key, value) => {
    setForm((prev) => {
      const exists = prev[key].includes(value);
      return { ...prev, [key]: exists ? prev[key].filter((v) => v !== value) : [...prev[key], value] };
    });
  };

  const themeOptions = [
    {
      label: 'Nature',
      palette: {
        selected:
          'border-2 border-emerald-500 bg-emerald-50 text-emerald-900 shadow-sm hover:border-emerald-600 hover:bg-emerald-100 dark:border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-50 dark:hover:bg-emerald-900/60',
        base:
          'border border-emerald-200 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-200 dark:hover:border-emerald-500 dark:hover:bg-emerald-900/50',
        focusRing: 'focus-visible:outline-emerald-500 dark:focus-visible:outline-emerald-400',
        icon: 'text-emerald-600 dark:text-emerald-200',
      },
    },
    {
      label: 'Fashion',
      palette: {
        selected:
          'border-2 border-rose-500 bg-rose-50 text-rose-900 shadow-sm hover:border-rose-600 hover:bg-rose-100 dark:border-rose-400 dark:bg-rose-900/40 dark:text-rose-50 dark:hover:bg-rose-900/60',
        base:
          'border border-rose-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-100 dark:hover:border-rose-500 dark:hover:bg-rose-900/50',
        focusRing: 'focus-visible:outline-rose-500 dark:focus-visible:outline-rose-400',
        icon: 'text-rose-600 dark:text-rose-200',
      },
    },
    {
      label: 'Street',
      palette: {
        selected:
          'border-2 border-amber-500 bg-amber-50 text-amber-900 shadow-sm hover:border-amber-600 hover:bg-amber-100 dark:border-amber-400 dark:bg-amber-900/40 dark:text-amber-50 dark:hover:bg-amber-900/60',
        base:
          'border border-amber-200 text-amber-700 hover:border-amber-300 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-100 dark:hover:border-amber-500 dark:hover:bg-amber-900/50',
        focusRing: 'focus-visible:outline-amber-500 dark:focus-visible:outline-amber-400',
        icon: 'text-amber-600 dark:text-amber-200',
      },
    },
    {
      label: 'Portrait',
      palette: {
        selected:
          'border-2 border-indigo-500 bg-indigo-50 text-indigo-900 shadow-sm hover:border-indigo-600 hover:bg-indigo-100 dark:border-indigo-400 dark:bg-indigo-900/40 dark:text-indigo-50 dark:hover:bg-indigo-900/60',
        base:
          'border border-indigo-200 text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-100 dark:hover:border-indigo-500 dark:hover:bg-indigo-900/50',
        focusRing: 'focus-visible:outline-indigo-500 dark:focus-visible:outline-indigo-400',
        icon: 'text-indigo-600 dark:text-indigo-200',
      },
    },
    {
      label: 'Minimalist',
      palette: {
        selected:
          'border-2 border-slate-500 bg-slate-50 text-slate-900 shadow-sm hover:border-slate-600 hover:bg-slate-100 dark:border-slate-300 dark:bg-slate-800/50 dark:text-white dark:hover:bg-slate-800/70',
        base:
          'border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-800/60',
        focusRing: 'focus-visible:outline-slate-500 dark:focus-visible:outline-slate-300',
        icon: 'text-slate-700 dark:text-slate-200',
      },
    },
    {
      label: 'Conceptual',
      palette: {
        selected:
          'border-2 border-violet-500 bg-violet-50 text-violet-900 shadow-sm hover:border-violet-600 hover:bg-violet-100 dark:border-violet-400 dark:bg-violet-900/40 dark:text-violet-50 dark:hover:bg-violet-900/60',
        base:
          'border border-violet-200 text-violet-700 hover:border-violet-300 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-100 dark:hover:border-violet-500 dark:hover:bg-violet-900/50',
        focusRing: 'focus-visible:outline-violet-500 dark:focus-visible:outline-violet-400',
        icon: 'text-violet-600 dark:text-violet-200',
      },
    },
  ];
  const triggerOptions = [
    { id: 'nudityErotic', label: 'Naakt (erotisch)' },
    { id: 'explicit18', label: 'Expliciet 18+' },
    { id: 'kinkBdsm', label: 'Kink / BDSM' },
    { id: 'breathRestriction', label: 'Ademrestrictie' },
    { id: 'bloodInjury', label: 'Bloed / verwonding' },
    { id: 'horrorScare', label: 'Horror / schrik' },
    { id: 'needlesInjections', label: 'Naalden / injecties' },
    { id: 'spidersInsects', label: 'Spinnen / insecten' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-3xl w-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Upload</p>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Nieuwe post</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
            <X />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Input label="Titel" placeholder="Titel van je werk" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Input label="Image URL" placeholder="https://" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
          </div>
          <Input
            label="Beschrijving"
            multiline
            placeholder="Credits, concept, gear..."
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Stijlen</p>
              <div className="flex flex-wrap gap-2">
                {themeOptions.map(({ label, palette }) => {
                  const isSelected = form.styles.includes(label);
                  return (
                    <button
                      type="button"
                      key={label}
                      onClick={() => toggleArrayValue('styles', label)}
                      className={`group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${palette.focusRing} ${
                        isSelected ? palette.selected : palette.base
                      }`}
                    >
                      {isSelected && <Check size={16} className={palette.icon} />}
                      <span className="leading-tight">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 flex items-center gap-2">
                <Shield size={16} /> Maker-tags
              </p>
              <div className="flex flex-wrap gap-2">
                {triggerOptions.map((trigger) => (
                  <button
                    type="button"
                    key={trigger.id}
                    onClick={() => toggleArrayValue('makerTags', trigger.id)}
                    className={`px-3 py-2 rounded-full text-sm border ${form.makerTags.includes(trigger.id) ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800' : 'border-slate-200 dark:border-slate-800 text-slate-500'}`}
                  >
                    {trigger.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <UploadCloud size={14} /> Bewaar direct in Firestore
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose} className="justify-center">
              Annuleren
            </Button>
            <Button type="submit" className="justify-center">
              <ImageIcon size={16} /> Plaats post
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
