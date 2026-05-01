import React from 'react';
import { AlertOctagon } from 'lucide-react';
import { Button } from './ui';

export default function SensitiveOverlay({ onReveal, className = '' }) {
  return (
    <div
      className={`absolute inset-0 z-20 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center pointer-events-auto ${className}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <AlertOctagon className="w-12 h-12 text-orange-500 mb-4" />
      <h4 className="text-white font-bold text-lg mb-2">Gevoelige inhoud</h4>
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
