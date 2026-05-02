import React from 'react';

export const Button = ({ children, onClick, variant = 'primary', className = '', type = 'button', disabled }) => {
  const baseStyle =
    'px-6 py-3 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 active:scale-95 cursor-pointer';
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed',
    secondary:
      'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700',
    ghost: 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400',
    outline:
      'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 dark:border-white/40 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 backdrop-blur-md',
  };

  return (
    <button type={type} onClick={onClick} className={`${baseStyle} ${variants[variant]} ${className}`} disabled={disabled}>
      {children}
    </button>
  );
};

export const Badge = ({ children, colorClass, onClick, className = '' }) => (
  <span
    onClick={(e) => {
      e.stopPropagation();
      if (onClick) onClick();
    }}
    className={`px-3 py-1 rounded-full text-xs font-semibold border ${
      onClick ? 'cursor-pointer hover:opacity-80' : ''
    } ${colorClass} ${className}`}
  >
    {children}
  </span>
);

export const Input = ({ label, type = 'text', placeholder, value, onChange, error, multiline = false, className = '' }) => (
  <div className={`mb-4 w-full ${className}`}>
    {label && <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>}
    {multiline ? (
      <textarea
        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
        placeholder={placeholder}
        value={value}
        rows={4}
        onChange={onChange}
      />
    ) : (
      <input
        type={type}
        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
    )}
    {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
  </div>
);
