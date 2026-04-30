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
  const viewportRef = useRef(null);
  const imgRef = useRef(null);
  const avatarFrameRef = useRef(null);
  const headerFrameRef = useRef(null);
  const pointerRef = useRef({ id: null, x: 0, y: 0 });

  const [active, setActive] = useState('avatar');
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [imgNatural, setImgNatural] = useState({ width: 0, height: 0 });
  const [zoomByKey, setZoomByKey] = useState({ avatar: 1, header: 1 });
  const [offsetByKey, setOffsetByKey] = useState({ avatar: { x: 0, y: 0 }, header: { x: 0, y: 0 } });
  const [preview, setPreview] = useState({ avatar: '', header: '' });
  const [lowQualityWarning, setLowQualityWarning] = useState(false);

  const headerAspect = Number.isFinite(measuredHeaderAspectRatio) && measuredHeaderAspectRatio > 0 ? measuredHeaderAspectRatio : 3;

  const frameStyles = useMemo(() => ({
    avatar: { width: 140, height: 140, left: '6%', top: '10%' },
    header: { width: '88%', aspectRatio: String(headerAspect), left: '6%', bottom: '10%' },
  }), [headerAspect]);

  const headerPreviewHeight = Math.max(1, Math.round(220 / headerAspect));

  const baseScale = useMemo(() => {
    if (!viewportSize.width || !viewportSize.height || !imgNatural.width || !imgNatural.height) return 1;
    return Math.min(viewportSize.width / imgNatural.width, viewportSize.height / imgNatural.height);
  }, [viewportSize.width, viewportSize.height, imgNatural.width, imgNatural.height]);

  const getFrameRect = (key) => {
    const frameEl = key === 'avatar' ? avatarFrameRef.current : headerFrameRef.current;
    return frameEl?.getBoundingClientRect() || null;
  };

  const getViewportRect = () => viewportRef.current?.getBoundingClientRect() || null;

  const getImageLayout = (key, offsetOverride = null, zoomOverride = null) => {
    const viewportRect = getViewportRect();
    if (!viewportRect || !imgNatural.width || !imgNatural.height) return null;
    const zoom = zoomOverride ?? zoomByKey[key] ?? 1;
    const renderedWidth = imgNatural.width * baseScale * zoom;
    const renderedHeight = imgNatural.height * baseScale * zoom;
    const centerLeft = (viewportRect.width - renderedWidth) / 2;
    const centerTop = (viewportRect.height - renderedHeight) / 2;
    const offset = offsetOverride || offsetByKey[key] || { x: 0, y: 0 };
    const left = viewportRect.left + centerLeft + offset.x;
    const top = viewportRect.top + centerTop + offset.y;
    return {
      viewportRect,
      imageRect: {
        left,
        top,
        width: renderedWidth,
        height: renderedHeight,
        right: left + renderedWidth,
        bottom: top + renderedHeight,
      },
    };
  };

  const getMinZoomForFrame = (key) => {
    const viewportRect = getViewportRect();
    const frameRect = getFrameRect(key);
    if (!viewportRect || !frameRect || !imgNatural.width || !imgNatural.height || !baseScale) return 1;
    const frameW = frameRect.width;
    const frameH = frameRect.height;
    const minZoomW = frameW / (imgNatural.width * baseScale);
    const minZoomH = frameH / (imgNatural.height * baseScale);
    return Math.max(1, minZoomW, minZoomH);
  };

  const clampOffset = (key, candidateOffset, zoomOverride = null) => {
    const frameRect = getFrameRect(key);
    const layout = getImageLayout(key, candidateOffset, zoomOverride);
    if (!frameRect || !layout) return candidateOffset;

    const { viewportRect, imageRect } = layout;
    const centerLeft = imageRect.left - viewportRect.left - candidateOffset.x;
    const centerTop = imageRect.top - viewportRect.top - candidateOffset.y;

    const minX = frameRect.right - viewportRect.left - centerLeft - imageRect.width;
    const maxX = frameRect.left - viewportRect.left - centerLeft;
    const minY = frameRect.bottom - viewportRect.top - centerTop - imageRect.height;
    const maxY = frameRect.top - viewportRect.top - centerTop;

    return {
      x: clamp(candidateOffset.x, minX, maxX),
      y: clamp(candidateOffset.y, minY, maxY),
    };
  };

  const computeOutputs = () => {
    const img = imgRef.current;
    const avatarFrame = avatarFrameRef.current;
    const headerFrame = headerFrameRef.current;
    if (!img || !avatarFrame || !headerFrame) return null;

    const avatarLayout = getImageLayout('avatar');
    const headerLayout = getImageLayout('header');
    if (!avatarLayout || !headerLayout) return null;

    const avatarRect = avatarFrame.getBoundingClientRect();
    const headerRect = headerFrame.getBoundingClientRect();
    const headerHeight = Math.max(1, Math.round(HEADER_WIDTH / headerAspect));

    const avatarOut = renderCrop(img, avatarLayout.imageRect, avatarRect, AVATAR_SIZE, AVATAR_SIZE);
    const headerOut = renderCrop(img, headerLayout.imageRect, headerRect, HEADER_WIDTH, headerHeight);

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
    setZoomByKey({ avatar: 1, header: 1 });
    setOffsetByKey({ avatar: { x: 0, y: 0 }, header: { x: 0, y: 0 } });
    setPreview({ avatar: '', header: '' });
    setLowQualityWarning(false);
  }, [source]);

  useEffect(() => {
    if (!viewportRef.current) return undefined;
    const viewport = viewportRef.current;
    const measure = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!imgNatural.width || !viewportSize.width) return;
    setZoomByKey((prev) => {
      const minAvatar = getMinZoomForFrame('avatar');
      const minHeader = getMinZoomForFrame('header');
      return {
        avatar: clamp(prev.avatar, minAvatar, 4),
        header: clamp(prev.header, minHeader, 4),
      };
    });
    setOffsetByKey((prev) => ({
      avatar: clampOffset('avatar', prev.avatar),
      header: clampOffset('header', prev.header),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgNatural.width, imgNatural.height, viewportSize.width, viewportSize.height, headerAspect]);

  useEffect(() => {
    const outputs = computeOutputs();
    if (!outputs) return;
    setPreview({ avatar: outputs.avatar, header: outputs.header });
    setLowQualityWarning(outputs.lowQuality);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomByKey, offsetByKey, imgNatural.width, imgNatural.height, viewportSize.width, viewportSize.height, headerAspect]);

  const onPointerDown = (e) => {
    pointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (pointerRef.current.id !== e.pointerId) return;
    const dx = e.clientX - pointerRef.current.x;
    const dy = e.clientY - pointerRef.current.y;
    pointerRef.current = { ...pointerRef.current, x: e.clientX, y: e.clientY };
    setOffsetByKey((prev) => {
      const current = prev[active];
      const next = { x: current.x + dx, y: current.y + dy };
      return { ...prev, [active]: clampOffset(active, next) };
    });
  };

  const onPointerUp = (e) => {
    if (pointerRef.current.id === e.pointerId) pointerRef.current = { id: null, x: 0, y: 0 };
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const setZoom = (nextZoom) => {
    const minZoom = getMinZoomForFrame(active);
    const zoom = clamp(nextZoom, minZoom, 4);
    setZoomByKey((prev) => ({ ...prev, [active]: zoom }));
    setOffsetByKey((prev) => {
      const current = prev[active];
      return { ...prev, [active]: clampOffset(active, current, zoom) };
    });
  };

  const save = () => {
    const outputs = computeOutputs();
    if (!outputs) return;
    onApply?.({ avatar: outputs.avatar, headerImage: outputs.header });
  };

  const activeZoom = zoomByKey[active] || 1;
  const activeOffset = offsetByKey[active] || { x: 0, y: 0 };
  const layout = getImageLayout(active, activeOffset, activeZoom);

  return (
    <div className="space-y-4 border rounded-2xl p-4 bg-slate-50 dark:bg-slate-900/40">
      <p className="text-xs text-slate-500 dark:text-slate-400">Je afbeelding wordt automatisch verkleind zodat je profiel sneller laadt.</p>
      {lowQualityWarning ? <p className="text-xs text-amber-600">Deze uitsnede kan onscherp worden.</p> : null}

      <div
        ref={viewportRef}
        className="relative w-full h-72 md:h-96 rounded-xl overflow-hidden bg-slate-200 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {layout ? (
          <img
            ref={imgRef}
            src={source}
            alt="Crop source"
            className="absolute pointer-events-none select-none"
            draggable={false}
            style={{
              left: layout.imageRect.left - layout.viewportRect.left,
              top: layout.imageRect.top - layout.viewportRect.top,
              width: layout.imageRect.width,
              height: layout.imageRect.height,
            }}
            onLoad={(e) => setImgNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          />
        ) : (
          <img
            ref={imgRef}
            src={source}
            alt="Crop source"
            className="absolute opacity-0 pointer-events-none"
            onLoad={(e) => setImgNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          />
        )}

        <button type="button" ref={avatarFrameRef} onClick={() => setActive('avatar')} className={`absolute border-2 rounded-md bg-transparent ${active === 'avatar' ? 'border-blue-500 ring-2 ring-blue-300' : 'border-white/70 opacity-70'}`} style={frameStyles.avatar}>
          <span className="absolute -top-6 left-0 text-xs bg-black/70 text-white px-2 py-0.5 rounded">Profielfoto</span>
        </button>
        <button type="button" ref={headerFrameRef} onClick={() => setActive('header')} className={`absolute border-2 rounded-md bg-transparent ${active === 'header' ? 'border-blue-500 ring-2 ring-blue-300' : 'border-white/70 opacity-70'}`} style={frameStyles.header}>
          <span className="absolute -top-6 left-0 text-xs bg-black/70 text-white px-2 py-0.5 rounded">Header</span>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className="px-3 py-1 border rounded" onClick={() => setZoom(activeZoom - 0.1)}>-</button>
        <input type="range" min={getMinZoomForFrame(active)} max={4} step={0.01} value={activeZoom} onChange={(e) => setZoom(Number(e.target.value))} />
        <button type="button" className="px-3 py-1 border rounded" onClick={() => setZoom(activeZoom + 0.1)}>+</button>
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
