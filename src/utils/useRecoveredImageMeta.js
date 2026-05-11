import { useCallback, useState } from 'react';

export default function useRecoveredImageMeta() {
  const [state, setState] = useState({ overrides: {}, version: 0 });

  const getOverride = useCallback((key) => (state.overrides || {})[key], [state.overrides]);

  const onImageLoad = useCallback((key) => (event) => {
    const img = event.currentTarget || event.target;
    if (!img) return;
    const width = Number(img.naturalWidth);
    const height = Number(img.naturalHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

    setState((prev) => {
      const existing = prev.overrides?.[key];
      if (existing && existing.width === width && existing.height === height) return prev;
      return {
        overrides: { ...prev.overrides, [key]: { width, height, aspectRatio: width / height } },
        version: prev.version + 1,
      };
    });
  }, []);

  return { overrides: state.overrides, getOverride, onImageLoad, version: state.version };
}
