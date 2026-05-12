import { classifyAdaptivePhotoTile } from './adaptivePhotoGrid.js';

// Simple 32-bit string hash (FNV-1a like) returning unsigned int
const hashString32 = (str) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

const defaultGetId = (item) => {
  if (!item) return '';
  if (item.type === 'post' && item.data && item.data.id) return String(item.data.id);
  if (item.type === 'user' && item.data && item.data.uid) return String(item.data.uid);
  if (item.id) return String(item.id);
  if (item.uid) return String(item.uid);
  return JSON.stringify(item);
};

const defaultGetType = (item) => (item && item.type) ? item.type : (item && item.isPost ? 'post' : 'post');

const defaultClassify = (item) => {
  if (!item) return 'unknown';
  const type = defaultGetType(item);
  if (type === 'user') return 'user';
  const post = item.data || item.post || item;
  try {
    // If we have explicit aspect information prefer that
    const aspect = (post && post.imageMeta && (Number(post.imageMeta.aspectRatio) || (Number(post.imageMeta.width) && Number(post.imageMeta.height) ? (Number(post.imageMeta.width) / Number(post.imageMeta.height)) : null))) || null;
    return classifyAdaptivePhotoTile(post, aspect);
  } catch (e) {
    return 'fallback';
  }
};

export function stableDiscoverOrder(items = [], options = {}) {
  const {
    sessionSeed = '',
    query = '',
    getId = defaultGetId,
    getType = defaultGetType,
    classify = defaultClassify,
    maxSameRun = 3,
  } = options || {};

  if (!Array.isArray(items) || items.length <= 1) return Array.isArray(items) ? items.slice() : [];

  const seedBase = `${sessionSeed || ''}::${query || ''}`;

  // Build sortable entries using deterministic hash per id
  const entries = items.map((it, idx) => {
    const id = String(getId(it) ?? idx);
    const key = hashString32(`${seedBase}:${id}`);
    const type = getType(it) || 'post';
    const shape = classify(it) || 'unknown';
    return { item: it, id, key, type, shape, idx };
  });

  // seeded shuffle by sorting on key, tie-breaking by original index
  entries.sort((a, b) => (a.key === b.key ? a.idx - b.idx : a.key - b.key));

  // Single-pass interleaving to avoid long runs of same type/shape
  const remaining = entries.slice();
  const result = [];

  let lastType = null;
  let lastShape = null;
  let runCount = 0;

  while (remaining.length) {
    const candidate = remaining.shift();
    const candType = candidate.type;
    const candShape = candidate.shape;

    if (result.length === 0) {
      result.push(candidate);
      lastType = candType;
      lastShape = candShape;
      runCount = 1;
      continue;
    }

    if ((candType === lastType || candShape === lastShape) && runCount >= maxSameRun) {
      // find next entry that breaks both type and shape if possible
      const swapIdx = remaining.findIndex((e) => e.type !== lastType && e.shape !== lastShape);
      if (swapIdx >= 0) {
        const next = remaining.splice(swapIdx, 1)[0];
        // push the better candidate first, put original candidate to the end
        result.push(next);
        remaining.push(candidate);
        lastType = next.type;
        lastShape = next.shape;
        runCount = 1;
        continue;
      }
      // no better candidate, fall through and place candidate
    }

    // default append
    if (candType === lastType && candShape === lastShape) {
      runCount += 1;
    } else {
      lastType = candType;
      lastShape = candShape;
      runCount = 1;
    }
    result.push(candidate);
  }

  return result.map((e) => e.item);
}

export default stableDiscoverOrder;
