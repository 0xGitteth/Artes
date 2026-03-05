import React, { useEffect, useMemo, useState } from 'react';

const getSystemDarkPreference = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const getAppDarkMode = () => {
  if (typeof document === 'undefined') return null;
  const appRoot = document.getElementById('root')?.firstElementChild;
  if (appRoot?.classList?.contains('dark')) return true;
  if (appRoot) return false;
  return null;
};

export default function MaskIcon({
  src,
  size = 16,
  active = false,
  activeColor = '#ef4444',
  inactiveColorLight = 'rgba(15, 23, 42, 0.65)',
  inactiveColorDark = 'rgba(255, 255, 255, 0.72)',
  disabled = false,
}) {
  const [prefersDark, setPrefersDark] = useState(getSystemDarkPreference);
  const [appDarkMode, setAppDarkMode] = useState(getAppDarkMode);

  useEffect(() => {
    const appRoot = document.getElementById('root')?.firstElementChild;
    const observer = new MutationObserver(() => setAppDarkMode(getAppDarkMode()));
    if (appRoot) {
      observer.observe(appRoot, { attributes: true, attributeFilter: ['class'] });
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = (event) => setPrefersDark(event.matches);
    media.addEventListener('change', onMediaChange);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', onMediaChange);
    };
  }, []);

  const isDarkMode = appDarkMode ?? prefersDark;
  const color = active ? activeColor : (isDarkMode ? inactiveColorDark : inactiveColorLight);

  const iconStyle = useMemo(() => ({
    width: size,
    height: size,
    display: 'inline-block',
    backgroundColor: color,
    maskImage: `url(${src})`,
    WebkitMaskImage: `url(${src})`,
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    opacity: disabled ? 0.5 : 1,
    flexShrink: 0,
  }), [color, disabled, size, src]);

  return <span aria-hidden="true" style={iconStyle} />;
}
