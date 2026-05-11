import React from 'react';
import { AlertOctagon } from 'lucide-react';
import { Button } from './ui';

export default function SensitiveOverlay({ onReveal, className = '' }) {
  return (
    <div
      className={`absolute inset-0 z-20 flex min-h-full flex-col items-center justify-center bg-black/95 p-3 text-center backdrop-blur-md pointer-events-auto sm:p-5 ${className}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <AlertOctagon className="mb-2 h-8 w-8 shrink-0 text-orange-500 sm:mb-3 sm:h-10 sm:w-10" />
      <h4 className="mb-2 text-sm font-bold leading-tight text-white sm:text-base">Gevoelige inhoud</h4>
      <Button
        variant="outline"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onReveal?.();
        }}
      >
        Toch bekijken
      </Button>
    </div>
  );
}
