import { useEffect, useRef, useState } from 'react';

const parsePixelValue = (value, fallback = 0) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
};

const getAdaptiveGridMetrics = (element) => {
  if (!element || typeof window === 'undefined') return null;

  const styles = window.getComputedStyle(element);
  const gridTemplate = styles.gridTemplateColumns || '';
  // try to extract pixel widths first (e.g. "120px 120px ...")
  const pxMatches = gridTemplate.match(/(-?\d+\.?\d*)px/g);
  let columns = [];
  if (pxMatches && pxMatches.length > 0) {
    columns = pxMatches.map((m) => Number.parseFloat(m.replace('px', ''))).filter((n) => Number.isFinite(n) && n > 0);
  } else {
    columns = gridTemplate
      .split(' ')
      .map((column) => Number.parseFloat(column))
      .filter((columnWidth) => Number.isFinite(columnWidth) && columnWidth > 0);
  }
  const columnGap = parsePixelValue(styles.columnGap, 0);
  const rowGap = parsePixelValue(styles.rowGap, 0);
  const rowHeight = parsePixelValue(styles.gridAutoRows, 4);
  const measuredWidth = element.getBoundingClientRect().width;

  // try to infer column count from explicit columns or repeat() syntax
  let columnCount = columns.length;
  if (!columnCount) {
    const repeatMatch = gridTemplate.match(/repeat\((\d+),/);
    if (repeatMatch) columnCount = Number.parseInt(repeatMatch[1], 10);
  }
  columnCount = columnCount || 1;
  const fallbackColumnWidth = Math.max(1, (measuredWidth - (columnGap * Math.max(0, columnCount - 1))) / columnCount);
  const columnWidth = columns[0] || fallbackColumnWidth;

  return { columnWidth, columnGap, rowHeight, rowGap, columnCount, measuredWidth };
};

const areAdaptiveGridMetricsEqual = (a, b) => Boolean(a && b
  && Math.abs(a.columnWidth - b.columnWidth) < 0.5
  && Math.abs(a.columnGap - b.columnGap) < 0.5
  && Math.abs(a.rowHeight - b.rowHeight) < 0.5
  && Math.abs(a.rowGap - b.rowGap) < 0.5
  && a.columnCount === b.columnCount
  && Math.abs(a.measuredWidth - b.measuredWidth) < 0.5);

export default function useAdaptivePhotoGridMetrics(refreshKey) {
  const gridRef = useRef(null);
  const [gridMetrics, setGridMetrics] = useState(null);

  useEffect(() => {
    const element = gridRef.current;
    if (!element || typeof window === 'undefined') return undefined;

    const isValidMetrics = (m) => m
      && Number.isFinite(Number(m.measuredWidth)) && Number(m.measuredWidth) > 0
      && Number.isFinite(Number(m.columnWidth)) && Number(m.columnWidth) > 0
      && Number.isFinite(Number(m.columnCount)) && Number(m.columnCount) > 0
      && Number.isFinite(Number(m.rowHeight)) && Number(m.rowHeight) > 0
      && Number.isFinite(Number(m.columnGap)) && Number(m.columnGap) >= 0;

    const updateGridMetrics = (attempt = 0) => {
      const nextMetrics = getAdaptiveGridMetrics(element);
      if (nextMetrics && isValidMetrics(nextMetrics)) {
        setGridMetrics((previousMetrics) => (areAdaptiveGridMetricsEqual(previousMetrics, nextMetrics) ? previousMetrics : nextMetrics));
        return;
      }

      // Schedule a short retry sequence if the first measurement looks invalid
      if (attempt === 0) {
        requestAnimationFrame(() => updateGridMetrics(1));
      } else if (attempt === 1) {
        setTimeout(() => updateGridMetrics(2), 50);
      }
      // If still invalid after retries, keep the last valid metrics (do not overwrite)
    };

    // run measurement in the next animation frame to avoid layout-thrashing early
    requestAnimationFrame(() => updateGridMetrics());

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateGridMetrics);
      return () => window.removeEventListener('resize', updateGridMetrics);
    }

    const resizeObserver = new ResizeObserver(updateGridMetrics);
    resizeObserver.observe(element);
    window.addEventListener('resize', updateGridMetrics);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateGridMetrics);
    };
  }, [refreshKey]);

  return { gridRef, gridMetrics };
}
