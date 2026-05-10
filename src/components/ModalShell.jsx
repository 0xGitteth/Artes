import React from 'react';

export default function ModalShell({ children, className = '' }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`w-full max-w-5xl max-h-[calc(100dvh-1rem)] overflow-hidden rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col ${className}`.trim()}>
        {children}
      </div>
    </div>
  );
}
