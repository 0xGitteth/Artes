import { useState } from 'react';

export default function AppLogo({ size = 28, alt = 'Artes', className = '', variant = 'default' }) {
  const [hasError, setHasError] = useState(false);
  const dimension = Number.isFinite(Number(size)) ? Number(size) : 28;

  const variantStyle =
    variant === 'rounded' ? { borderRadius: '8px' } : variant === 'square' ? { borderRadius: 0 } : {};

  if (hasError) {
    return (
      <span
        className={className}
        style={{
          display: 'block',
          width: `${dimension}px`,
          lineHeight: `${dimension}px`,
          textAlign: 'center',
          fontWeight: 700,
          fontSize: `${Math.max(12, Math.round(dimension * 0.45))}px`,
        }}
      >
        Artes
      </span>
    );
  }

  return (
    <img
      src="/brand/logo.png"
      alt={alt}
      className={className}
      style={{
        width: `${dimension}px`,
        height: `${dimension}px`,
        display: 'block',
        objectFit: 'contain',
        ...variantStyle,
      }}
      onError={() => setHasError(true)}
    />
  );
}
