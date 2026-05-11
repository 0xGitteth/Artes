import { useEffect, useRef, useState } from 'react';

const parsePixelValue = (value, fallback = 0) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
};

const getGridMetrics = (element) => {
  if (!element || typeof window === 'undefined') return null;

  const styles = window.getComputedStyle(element);
  const columns = styles.gridTemplateColumns
    .split(' ')
    .map((column) => Number.parseFloat(column))
    .filter((columnWidth) => Number.isFinite(columnWidth) && columnWidth > 0);
  const columnGap = parsePixelValue(styles.columnGap, 0);
  const rowGap = parsePixelValue(styles.rowGap, 0);
  const rowHeight = parsePixelValue(styles.gridAutoRows, 4);
  const measuredWidth = element.getBoundingClientRect().width;
  const columnCount = columns.length || 1;
  const fallbackColumnWidth = Math.max(1, (measuredWidth - (columnGap * Math.max(0, columnCount - 1))) / columnCount);
  const columnWidth = columns[0] || fallbackColumnWidth;

  return { columnWidth, columnGap, rowHeight, rowGap, columnCount, containerWidth: measuredWidth };
};

const areGridMetricsEqual = (a, b) => Boolean(a && b
  && Math.abs(a.columnWidth - b.columnWidth) < 0.5
  && Math.abs(a.columnGap - b.columnGap) < 0.5
  && Math.abs(a.rowHeight - b.rowHeight) < 0.5
  && Math.abs(a.rowGap - b.rowGap) < 0.5
  && a.columnCount === b.columnCount
  && Math.abs(a.containerWidth - b.containerWidth) < 0.5);

export default function useAdaptivePhotoGridMetrics() {
  const gridRef = useRef(null);
  const [gridMetrics, setGridMetrics] = useState(null);

  useEffect(() => {
    const element = gridRef.current;
    if (!element || typeof window === 'undefined') return undefined;

    const updateGridMetrics = () => {
      const nextMetrics = getGridMetrics(element);
      if (!nextMetrics) return;
      setGridMetrics((previousMetrics) => (areGridMetricsEqual(previousMetrics, nextMetrics) ? previousMetrics : nextMetrics));
    };

    updateGridMetrics();

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
  }, []);

  return { gridRef, gridMetrics };
}
