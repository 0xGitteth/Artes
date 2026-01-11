import React, { useState } from 'react';
import { Mail, Lock, UserPlus } from 'lucide-react';
import { Button, Input } from './ui';
import {
  ensureUserProfile,
  loginWithEmail,
  registerWithEmail,
  signInWithApple,
  signInWithGoogle,
} from '../firebase';

export default function AuthPanel({ onAuthSuccess, error }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [localError, setLocalError] = useState(null);
  const enableEmail = import.meta.env.VITE_ENABLE_EMAIL_SIGNIN !== 'false';
  const enableGoogle = import.meta.env.VITE_ENABLE_GOOGLE_SIGNIN !== 'false';
  const enableApple = import.meta.env.VITE_ENABLE_APPLE_SIGNIN === 'true';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    if (!enableEmail) {
      setLocalError('Email login staat nog uit.');
      return;
    }
    try {
      if (mode === 'login') {
        const cred = await loginWithEmail(form.email, form.password);
        await ensureUserProfile(cred.user);
      } else {
        const user = await registerWithEmail(form.email, form.password, form.displayName);
        await ensureUserProfile(user);
      }
      onAuthSuccess?.();
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
          <Button type="submit" className="w-full justify-center" disabled={!enableEmail}>
            {mode === 'login' ? 'Log in' : 'Maak account'}
          </Button>
          <div className="mt-6 space-y-3">
            {enableGoogle && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const user = await signInWithGoogle();
                    if (user) {
                      await ensureUserProfile(user);
                    }
                    onAuthSuccess?.();
                  } catch (err) {
                    setLocalError(err?.message || 'Google login mislukt.');
                  }
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                Continue with Google
              </button>
            )}
            <button
              type="button"
              disabled={!enableApple}
              onClick={async () => {
                if (!enableApple) {
                  setLocalError('Apple login staat nog uit. Komt later.');
                  return;
                }
                try {
                  const user = await signInWithApple();
                  if (user) {
                    await ensureUserProfile(user);
                  }
                  onAuthSuccess?.();
                } catch (e) {
                  const msg = e?.code === 'auth/operation-not-allowed'
                    ? 'Apple login is nog niet geactiveerd in Firebase.'
                    : e?.code === 'auth/unauthorized-domain'
                      ? 'Dit domein is nog niet toegestaan in Firebase Auth.'
                      : 'Apple login mislukt.';
                  setLocalError(msg);
                }
              }}
              className={`w-full border border-slate-200 dark:border-slate-700 rounded-xl py-3 text-sm font-semibold transition ${enableApple ? 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800' : 'text-slate-400 dark:text-slate-500 cursor-not-allowed bg-slate-50 dark:bg-slate-800/40'}`}
            >
              Continue with Apple {enableApple ? '' : '(soon)'}
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-4 text-center">
            Door verder te gaan accepteer je onze community richtlijnen.
          </p>
        </form>
      </div>
    </div>
  );
}
