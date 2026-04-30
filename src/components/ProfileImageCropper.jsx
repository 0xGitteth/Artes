import React, { useEffect, useMemo, useRef, useState } from 'react';

const AVATAR_SIZE = 600;
const HEADER_WIDTH = 1500;
const MAX_OUTPUT_BYTES = 320 * 1024;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const dataUrlBytes = (dataUrl) => {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return dataUrl.length;
  const b64 = dataUrl.slice(comma + 1);
  return Math.floor((b64.length * 3) / 4);
};

const encodeJpeg = (canvas) => {
  let quality = 0.9;
  let result = canvas.toDataURL('image/jpeg', quality);
  while (dataUrlBytes(result) > MAX_OUTPUT_BYTES && quality > 0.55) {
    quality -= 0.1;
    result = canvas.toDataURL('image/jpeg', quality);
  }
  return result;
};

function renderCrop(imageEl, imageRect, frameRect, outputWidth, outputHeight) {
  const scaleX = imageEl.naturalWidth / imageRect.width;
  const scaleY = imageEl.naturalHeight / imageRect.height;
  const sx = clamp((frameRect.left - imageRect.left) * scaleX, 0, imageEl.naturalWidth);
  const sy = clamp((frameRect.top - imageRect.top) * scaleY, 0, imageEl.naturalHeight);
  const sw = clamp(frameRect.width * scaleX, 1, imageEl.naturalWidth - sx);
  const sh = clamp(frameRect.height * scaleY, 1, imageEl.naturalHeight - sy);

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageEl, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
  return { dataUrl: encodeJpeg(canvas), sourceRect: { sw, sh } };
}

export default function ProfileImageCropper({ source, measuredHeaderAspectRatio = 3, onApply, onCancel }) {
  const imageAreaRef = useRef(null);
  const imgRef = useRef(null);
  const avatarFrameRef = useRef(null);
  const headerFrameRef = useRef(null);
  const pointerRef = useRef({ id: null, x: 0, y: 0 });
  const previewDebounceRef = useRef(null);

  const [active, setActive] = useState('avatar');
  const [imgNatural, setImgNatural] = useState({ width: 0, height: 0 });
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 });
  const [frameByKey, setFrameByKey] = useState({
    avatar: { cx: 0.3, cy: 0.35, scale: 0.45 },
    header: { cx: 0.5, cy: 0.72, scale: 0.72 },
  });
  const [preview, setPreview] = useState({ avatar: '', header: '' });
  const [lowQualityWarning, setLowQualityWarning] = useState(false);

  const headerAspect = Number.isFinite(measuredHeaderAspectRatio) && measuredHeaderAspectRatio > 0 ? measuredHeaderAspectRatio : 3;

  const imageAspect = useMemo(() => {
    if (!imgNatural.width || !imgNatural.height) return 1;
    return imgNatural.width / imgNatural.height;
  }, [imgNatural.width, imgNatural.height]);

  const headerPreviewHeight = Math.max(1, Math.round(220 / headerAspect));

  useEffect(() => {
    if (!imageAreaRef.current) return undefined;
    const el = imageAreaRef.current;
    const measure = () => setAreaSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setFrameByKey({
      avatar: { cx: 0.3, cy: 0.35, scale: 0.45 },
      header: { cx: 0.5, cy: 0.72, scale: 0.72 },
    });
    setPreview({ avatar: '', header: '' });
    setLowQualityWarning(false);
  }, [source]);

  const getFrameRatio = (key) => (key === 'avatar' ? 1 : headerAspect);

  const getScaleLimits = (key) => {
    const ratio = getFrameRatio(key);
    const minDim = 72;
    if (!areaSize.width || !areaSize.height) return { min: 0.2, max: 0.95 };
    const minByWidth = minDim / areaSize.width;
    const minByHeight = (minDim * ratio) / areaSize.height;
    const maxByWidth = 0.98;
    const maxByHeight = (areaSize.height * 0.98 * ratio) / areaSize.width;
    const maxScale = Math.max(0.01, Math.min(maxByWidth, maxByHeight));
    const desiredMinScale = Math.max(minByWidth, minByHeight, 0.12);
    const minScale = Math.min(desiredMinScale, maxScale);
    return { min: minScale, max: maxScale };
  };

  const toFrameRect = (key, model = frameByKey[key]) => {
    const ratio = getFrameRatio(key);
    const width = areaSize.width * model.scale;
    const height = width / ratio;
    const cx = model.cx * areaSize.width;
    const cy = model.cy * areaSize.height;
    return {
      width,
      height,
      left: cx - width / 2,
      top: cy - height / 2,
      right: cx + width / 2,
      bottom: cy + height / 2,
    };
  };

  const clampFrameModel = (key, model) => {
    const { min, max } = getScaleLimits(key);
    const scale = clamp(model.scale, min, max);
    if (!areaSize.width || !areaSize.height) return { ...model, scale };
    const rect = toFrameRect(key, { ...model, scale });
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;
    const minCx = halfW / areaSize.width;
    const maxCx = 1 - minCx;
    const minCy = halfH / areaSize.height;
    const maxCy = 1 - minCy;
    return {
      scale,
      cx: clamp(model.cx, minCx, maxCx),
      cy: clamp(model.cy, minCy, maxCy),
    };
  };

  const toDomFrameRect = (frameRect) => {
    const area = imageAreaRef.current?.getBoundingClientRect();
    if (!area) return null;
    return {
      left: area.left + frameRect.left,
      top: area.top + frameRect.top,
      right: area.left + frameRect.right,
      bottom: area.top + frameRect.bottom,
      width: frameRect.width,
      height: frameRect.height,
    };
  };

  const computeOutputs = () => {
    const img = imgRef.current;
    const area = imageAreaRef.current?.getBoundingClientRect();
    if (!img || !area || !imgNatural.width || !imgNatural.height) return null;

    const avatarRect = toFrameRect('avatar');
    const headerRect = toFrameRect('header');
    const avatarDomRect = toDomFrameRect(avatarRect);
    const headerDomRect = toDomFrameRect(headerRect);
    if (!avatarDomRect || !headerDomRect) return null;

    const headerHeight = Math.max(1, Math.round(HEADER_WIDTH / headerAspect));
    const avatarOut = renderCrop(img, area, avatarDomRect, AVATAR_SIZE, AVATAR_SIZE);
    const headerOut = renderCrop(img, area, headerDomRect, HEADER_WIDTH, headerHeight);

    return {
      avatar: avatarOut.dataUrl,
      header: headerOut.dataUrl,
      lowQuality: avatarOut.sourceRect.sw < AVATAR_SIZE
        || avatarOut.sourceRect.sh < AVATAR_SIZE
        || headerOut.sourceRect.sw < HEADER_WIDTH
        || headerOut.sourceRect.sh < headerHeight,
    };
  };

  useEffect(() => {
    if (!areaSize.width) return;
    setFrameByKey((prev) => ({
      avatar: clampFrameModel('avatar', prev.avatar),
      header: clampFrameModel('header', prev.header),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaSize.width, areaSize.height, headerAspect]);

  useEffect(() => {
    if (previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = null;
    }
    previewDebounceRef.current = setTimeout(() => {
      const outputs = computeOutputs();
      if (!outputs) return;
      setPreview({ avatar: outputs.avatar, header: outputs.header });
      setLowQualityWarning(outputs.lowQuality);
    }, 150);
    return () => {
      if (previewDebounceRef.current) {
        clearTimeout(previewDebounceRef.current);
        previewDebounceRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameByKey, areaSize.width, areaSize.height, imgNatural.width, imgNatural.height, headerAspect]);

  const onPointerDown = (e) => {
    pointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (pointerRef.current.id !== e.pointerId) return;
    const dx = e.clientX - pointerRef.current.x;
    const dy = e.clientY - pointerRef.current.y;
    pointerRef.current = { ...pointerRef.current, x: e.clientX, y: e.clientY };

    setFrameByKey((prev) => {
      if (!areaSize.width || !areaSize.height) return prev;
      const current = prev[active];
      const moved = {
        ...current,
        cx: current.cx + (dx / areaSize.width),
        cy: current.cy + (dy / areaSize.height),
      };
      return { ...prev, [active]: clampFrameModel(active, moved) };
    });
  };

  const onPointerUp = (e) => {
    if (pointerRef.current.id === e.pointerId) pointerRef.current = { id: null, x: 0, y: 0 };
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const setFrameScale = (key, nextScale) => {
    setFrameByKey((prev) => ({
      ...prev,
      [key]: clampFrameModel(key, { ...prev[key], scale: nextScale }),
    }));
  };

  const save = () => {
    const outputs = computeOutputs();
    if (!outputs) return;
    onApply?.({ avatar: outputs.avatar, headerImage: outputs.header });
  };

  const avatarRect = toFrameRect('avatar');
  const headerRect = toFrameRect('header');
  const activeScale = frameByKey[active]?.scale ?? 0.4;
  const activeScaleLimits = getScaleLimits(active);

  return (
    <div className="space-y-4 border rounded-2xl p-4 bg-slate-50 dark:bg-slate-900/40">
      <p className="text-xs text-slate-500 dark:text-slate-400">Je afbeelding wordt automatisch verkleind zodat je profiel sneller laadt.</p>
      {lowQualityWarning ? <p className="text-xs text-amber-600">Deze uitsnede kan onscherp worden.</p> : null}

      <div className="w-full flex justify-center">
        <div
          ref={imageAreaRef}
          className="relative w-full max-w-2xl bg-slate-200 rounded-xl overflow-hidden touch-none"
          style={{ aspectRatio: String(imageAspect), maxHeight: 480 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            ref={imgRef}
            src={source}
            alt="Crop source"
            className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none"
            draggable={false}
            onLoad={(e) => setImgNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          />

          <button
            type="button"
            ref={avatarFrameRef}
            onClick={() => setActive('avatar')}
            className={`absolute border-2 rounded-md bg-transparent ${active === 'avatar' ? 'border-blue-500 ring-2 ring-blue-300' : 'border-white/70 opacity-70'}`}
            style={{ left: avatarRect.left, top: avatarRect.top, width: avatarRect.width, height: avatarRect.height }}
          >
            <span className="absolute -top-6 left-0 text-xs bg-black/70 text-white px-2 py-0.5 rounded">Profielfoto</span>
          </button>

          <button
            type="button"
            ref={headerFrameRef}
            onClick={() => setActive('header')}
            className={`absolute border-2 rounded-md bg-transparent ${active === 'header' ? 'border-blue-500 ring-2 ring-blue-300' : 'border-white/70 opacity-70'}`}
            style={{ left: headerRect.left, top: headerRect.top, width: headerRect.width, height: headerRect.height }}
          >
            <span className="absolute -top-6 left-0 text-xs bg-black/70 text-white px-2 py-0.5 rounded">Header</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className="px-3 py-1 border rounded" onClick={() => setFrameScale(active, activeScale - 0.03)}>-</button>
        <input
          type="range"
          min={activeScaleLimits.min}
          max={activeScaleLimits.max}
          step={0.005}
          value={activeScale}
          onChange={(e) => setFrameScale(active, Number(e.target.value))}
        />
        <button type="button" className="px-3 py-1 border rounded" onClick={() => setFrameScale(active, activeScale + 0.03)}>+</button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold mb-1">Avatar preview</p>
          {preview.avatar ? <img src={preview.avatar} alt="Avatar preview" className="w-20 h-20 rounded-full object-cover border" /> : <div className="w-20 h-20 rounded-full bg-slate-200" />}
        </div>
        <div>
          <p className="text-xs font-semibold mb-1">Header preview</p>
          {preview.header ? (
            <div className="w-full rounded border overflow-hidden" style={{ aspectRatio: String(headerAspect), maxHeight: 120 }}>
              <img src={preview.header} alt="Header preview" className="w-full h-full object-cover" />
            </div>
          ) : <div className="w-full rounded bg-slate-200" style={{ height: headerPreviewHeight }} />}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" className="px-3 py-2 rounded border" onClick={onCancel}>Annuleren</button>
        <button type="button" className="px-3 py-2 rounded bg-blue-600 text-white" onClick={save} disabled={!preview.avatar || !preview.header}>Gebruik uitsnede</button>
      </div>
    </div>
  );
}
