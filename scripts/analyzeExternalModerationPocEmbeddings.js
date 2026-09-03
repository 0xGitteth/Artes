import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const INTAKE_PATH = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', 'external-poc', 'intake.json');
const EXPECTED_MODEL = 'dinov2_vitb14';
const EXPECTED_DIMENSION = 768;

const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    throw new Error('invalid_embedding_pair');
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i]);
    const bv = Number(b[i]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) throw new Error('non_finite_embedding_value');
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) throw new Error('zero_norm_embedding');
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const cosineDistance = (a, b) => 1 - cosineSimilarity(a, b);

const shortName = (fileName) => String(fileName || '').replace(/\.(?:jpe?g|png|webp)$/i, '');

const extractEmbeddingVector = (item) => {
  const embedding = item?.embedding;
  const vector = embedding?.vector;
  if (
    !embedding
    || embedding.model !== EXPECTED_MODEL
    || embedding.dimension !== EXPECTED_DIMENSION
    || !Array.isArray(vector)
    || vector.length !== EXPECTED_DIMENSION
    || !vector.every(Number.isFinite)
  ) {
    throw new Error(`invalid_embedding:${item?.fileName || 'unknown'}`);
  }
  return vector;
};

const intake = JSON.parse(await readFile(INTAKE_PATH, 'utf8'));
const rawItems = Array.isArray(intake?.items) ? intake.items : [];
if (rawItems.length < 2) {
  console.error('Need at least two embedded items in external POC intake.');
  process.exit(2);
}

const items = rawItems.map((item) => ({
  fileName: item.fileName,
  vector: extractEmbeddingVector(item),
}));

const pairs = [];
for (let i = 0; i < items.length; i += 1) {
  for (let j = i + 1; j < items.length; j += 1) {
    pairs.push({
      a: shortName(items[i].fileName),
      b: shortName(items[j].fileName),
      cosineDistance: cosineDistance(items[i].vector, items[j].vector),
    });
  }
}

pairs.sort((left, right) => left.cosineDistance - right.cosineDistance || left.a.localeCompare(right.a) || left.b.localeCompare(right.b));

const nearest = items.map((item) => {
  const name = shortName(item.fileName);
  const candidates = items
    .filter((other) => other !== item)
    .map((other) => ({
      item: shortName(other.fileName),
      cosineDistance: cosineDistance(item.vector, other.vector),
    }))
    .sort((a, b) => a.cosineDistance - b.cosineDistance || a.item.localeCompare(b.item));
  return { item: name, nearest: candidates[0] };
});

const roundedPairs = pairs.map((pair) => ({ ...pair, cosineDistance: Number(pair.cosineDistance.toFixed(6)) }));
const roundedNearest = nearest.map((entry) => ({
  item: entry.item,
  nearest: {
    item: entry.nearest.item,
    cosineDistance: Number(entry.nearest.cosineDistance.toFixed(6)),
  },
}));

process.stdout.write(`${JSON.stringify({
  ok: true,
  source: '.tmp/moderation-test-set/external-poc/intake.json',
  itemCount: items.length,
  embeddingModel: EXPECTED_MODEL,
  embeddingDimension: EXPECTED_DIMENSION,
  metric: 'cosine_distance',
  smallerMeansMoreSimilar: true,
  pairCount: roundedPairs.length,
  nearestNeighbors: roundedNearest,
  orderedPairs: roundedPairs,
  fullEmbeddingsPrinted: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
