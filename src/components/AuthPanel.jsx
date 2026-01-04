import React, { useState } from 'react';
import { Mail, Lock, UserPlus } from 'lucide-react';
import { Button, Input } from './ui';

export default function AuthPanel({ onLogin, onRegister, error }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [localError, setLocalError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    try {
      if (mode === 'login') {
        await onLogin(form.email, form.password);
      } else {
        await onRegister(form.email, form.password, form.displayName);
      }
    } catch (err) {
      setLocalError(err.message);
    }
  };

  return (
    <div className="max-w-3xl mx-auto bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl shadow-slate-800/10 overflow-hidden">
      <div className="grid md:grid-cols-2">
        <div className="p-10 bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-white">
          <p className="text-sm uppercase tracking-widest opacity-80 mb-3">Artes</p>
          <h1 className="text-3xl font-bold mb-4">Log in of maak een account</h1>
          <p className="opacity-90 leading-relaxed">
            Behoud de vertrouwde Artes ervaring maar nu met echte Firebase-authenticatie. Werk samen, deel posts en beheer je profiel.
          </p>
          <div className="mt-8 space-y-3 text-sm opacity-90">
            <div className="flex items-center gap-3"><Mail size={18} /> Email + wachtwoord</div>
            <div className="flex items-center gap-3"><Lock size={18} /> Sessies blijven bewaard</div>
            <div className="flex items-center gap-3"><UserPlus size={18} /> Onboarding maakt direct je profiel aan</div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="p-10 bg-white dark:bg-slate-950/80">
          <div className="flex gap-2 mb-6">
            <button type="button" onClick={() => setMode('login')} className={`flex-1 py-3 rounded-xl text-sm font-semibold border ${mode === 'login' ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800' : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'}`}>
              Log in
            </button>
            <button type="button" onClick={() => setMode('register')} className={`flex-1 py-3 rounded-xl text-sm font-semibold border ${mode === 'register' ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800' : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'}`}>
              Registreren
            </button>
          </div>
          {mode === 'register' && (
            <Input
              label="Naam"
              placeholder="Je naam"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            />
          )}
          <Input
            label="Email"
            type="email"
            placeholder="studio@artes.app"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <Input
            label="Wachtwoord"
            type="password"
            placeholder="Minimaal 6 tekens"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
          {(localError || error) && <p className="text-red-500 text-sm mb-3">{localError || error}</p>}
          <Button type="submit" className="w-full justify-center">{mode === 'login' ? 'Log in' : 'Maak account'}</Button>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-4 text-center">
            Door verder te gaan accepteer je onze community richtlijnen.
          </p>
        </form>
      </div>
    </div>
  );
}

