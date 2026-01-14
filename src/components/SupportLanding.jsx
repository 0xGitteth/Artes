import React, { useState } from 'react';
import { Copy, Mail, MessageCircle } from 'lucide-react';

export default function SupportLanding({ onOpenChat, canOpenChat }) {
  const [copyState, setCopyState] = useState('idle');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText('admin@artes.app');
      setCopyState('success');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch (error) {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold dark:text-white">Support</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Je kunt contact opnemen met Artes via chat of e-mail. We reageren binnen 3 werkdagen.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-blue-600" />
          <h2 className="text-xl font-semibold dark:text-white">Chat met Artes Moderatie</h2>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Om spam te voorkomen kun je maximaal 1 bericht sturen totdat wij reageren.
        </p>
        <button
          type="button"
          onClick={onOpenChat}
          disabled={!canOpenChat}
          className="inline-flex items-center justify-center gap-2 bg-blue-600 text-white rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-50"
        >
          <MessageCircle className="w-4 h-4" /> Open chat
        </button>
        {!canOpenChat && (
          <p className="text-xs text-amber-600">Log in om de support chat te openen.</p>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-blue-600" />
          <h2 className="text-xl font-semibold dark:text-white">E-mail</h2>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Liever mailen? Stuur een e-mail naar admin@artes.app. We reageren binnen 3 werkdagen.
        </p>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-full px-5 py-2 text-sm font-semibold"
        >
          <Copy className="w-4 h-4" /> Kopieer e-mail
        </button>
        {copyState === 'success' && (
          <p className="text-xs text-emerald-600">E-mailadres gekopieerd.</p>
        )}
        {copyState === 'error' && (
          <p className="text-xs text-amber-600">Kopiëren mislukt. Probeer opnieuw.</p>
        )}
      </div>
    </div>
  );
}
