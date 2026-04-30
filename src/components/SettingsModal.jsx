import React, { useState } from 'react';
import { X, Moon, Sun, Shield } from 'lucide-react';
import { Button } from './ui';

const PREFERENCES = [
  { id: 'cover', label: 'Cover', desc: 'toon blur overlay en laat gebruiker het openen' },
  { id: 'show', label: 'Show', desc: 'altijd tonen' },
  { id: 'hideFeed', label: 'Hide feed', desc: 'verberg gevoelige posts' },
];

export default function SettingsModal({ onClose, darkMode, onToggleDark, preference, onPreferenceChange, onLogout }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Settings</p>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Voorkeuren</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
            <X />
          </button>
        </div>
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200">
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-white">Dark mode</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Wordt ook bewaard in je profiel</p>
            </div>
            <Button variant="secondary" onClick={onToggleDark} className="justify-center">
              {darkMode ? <Sun size={16} /> : <Moon size={16} />} {darkMode ? 'Light' : 'Dark'}
            </Button>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <Shield size={16} /> Gevoelige content
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              {PREFERENCES.map((opt) => (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => onPreferenceChange(opt.id)}
                  className={`p-4 rounded-2xl border text-left transition ${
                    preference === opt.id
                      ? 'border-blue-300 bg-blue-50 dark:border-blue-800/80 dark:bg-blue-900/20 text-blue-800 dark:text-blue-100'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <p className="font-semibold">{opt.label}</p>
                  <p className="text-sm opacity-80">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="danger" onClick={onLogout} className="justify-center">
              Log uit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
