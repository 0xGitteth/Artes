import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const BASE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', 'combined-external-v1');
const SEED_PATH = path.join(BASE_DIR, 'seed-v1.json');
const OUTPUT_PATH = path.join(BASE_DIR, 'neighbor-audit-v1.json');
const EXPECTED_MODEL = 'dinov2_vitb14';
const EXPECTED_DIMENSION = 768;

const shortName = (fileName) => String(fileName || '').replace(/\.(?:jpe?g|png|webp)$/i, '');

const vectorOf = (item) => {
  const embedding = item?.embedding;
  const vector = embedding?.vector;
  if (embedding?.model !== EXPECTED_MODEL || embedding?.dimension !== EXPECTED_DIMENSION) {
    throw new Error(`combined_neighbor_invalid_embedding_metadata:${item?.sourceFileName || 'unknown'}`);
  }
  if (!Array.isArray(vector) || vector.length !== EXPECTED_DIMENSION || !vector.every(Number.isFinite)) {
    throw new Error(`combined_neighbor_invalid_embedding_vector:${item?.sourceFileName || 'unknown'}`);
  }
  return vector;
};

const cosineDistance = (a, b) => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) throw new Error('combined_neighbor_zero_norm');
  return 1 - (dot / (Math.sqrt(normA) * Math.sqrt(normB)));
};

const seed = JSON.parse(await readFile(SEED_PATH, 'utf8'));
const items = Array.isArray(seed?.items) ? seed.items : [];
if (seed?.seedVersion !== 'combined_external_seed_v1' || items.length !== 8) throw new Error('combined_neighbor_seed_invalid');
if (seed?.trainingReady !== false || seed?.thresholdSelected !== false || seed?.sourcePoolLeakageGuardRequired !== true) {
  throw new Error('combined_neighbor_seed_must_remain_unpromoted');
}
for (const item of items) {
  if (!item.sourcePoolId) throw new Error(`combined_neighbor_missing_source_pool:${item.sourceFileName}`);
  if (!item?.detectorLabel?.nudity) throw new Error(`combined_neighbor_missing_label:${item.sourceFileName}`);
  vectorOf(item);
}

const pairs = [];
for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
    const left = items[leftIndex];
    const right = items[rightIndex];
    pairs.push({
      a: shortName(left.sourceFileName),
      b: shortName(right.sourceFileName),
      distance: cosineDistance(vectorOf(left), vectorOf(right)),
      aNudity: left.detectorLabel.nudity,
      bNudity: right.detectorLabel.nudity,
      sameNudity: left.detectorLabel.nudity === right.detectorLabel.nudity,
      sameSexualContext: left.detectorLabel.sexualContext === right.detectorLabel.sexualContext,
      sameSourcePool: left.sourcePoolId === right.sourcePoolId,
      sourcePoolId: left.sourcePoolId === right.sourcePoolId ? left.sourcePoolId : null,
    });
  }
}
pairs.sort((a, b) => a.distance - b.distance || a.a.localeCompare(b.a) || a.b.localeCompare(b.b));

const nearest = items.map((item) => {
  const candidates = items
    .filter((other) => other !== item)
    .map((other) => ({
      item: shortName(other.sourceFileName),
      distance: cosineDistance(vectorOf(item), vectorOf(other)),
      nudity: other.detectorLabel.nudity,
      sourcePoolId: other.sourcePoolId,
      sameNudity: item.detectorLabel.nudity === other.detectorLabel.nudity,
      sameSourcePool: item.sourcePoolId === other.sourcePoolId,
    }))
    .sort((a, b) => a.distance - b.distance || a.item.localeCompare(b.item));
  return {
    item: shortName(item.sourceFileName),
    nudity: item.detectorLabel.nudity,
    sourcePoolId: item.sourcePoolId,
    nearest: candidates[0],
  };
});

const sameNudityNearest = nearest.filter((entry) => entry.nearest.sameNudity).length;
const sameSourcePoolNearest = nearest.filter((entry) => entry.nearest.sameSourcePool).length;
const sameSourcePoolDifferentNudityNearest = nearest.filter((entry) => entry.nearest.sameSourcePool && !entry.nearest.sameNudity).length;
const sourcePools = {};
for (const item of items) {
  if (!sourcePools[item.sourcePoolId]) sourcePools[item.sourcePoolId] = { itemCount: 0, nudityCounts: {} };
  sourcePools[item.sourcePoolId].itemCount += 1;
  const nudity = item.detectorLabel.nudity;
  sourcePools[item.sourcePoolId].nudityCounts[nudity] = (sourcePools[item.sourcePoolId].nudityCounts[nudity] || 0) + 1;
}

const roundPair = (pair) => ({ ...pair, distance: Number(pair.distance.toFixed(6)) });
const output = {
  schemaVersion: 1,
  auditType: 'combined_external_embedding_neighbor_audit_v1',
  seedVersion: seed.seedVersion,
  itemCount: items.length,
  pairCount: pairs.length,
  embeddingModel: EXPECTED_MODEL,
  embeddingDimension: EXPECTED_DIMENSION,
  metrics: {
    nearestNeighborSameNudityCount: sameNudityNearest,
    nearestNeighborSameNudityRate: Number((sameNudityNearest / items.length).toFixed(4)),
    nearestNeighborSameSourcePoolCount: sameSourcePoolNearest,
    nearestNeighborSameSourcePoolRate: Number((sameSourcePoolNearest / items.length).toFixed(4)),
    nearestNeighborSameSourcePoolDifferentNudityCount: sameSourcePoolDifferentNudityNearest,
  },
  sourcePools,
  nearestNeighbors: nearest.map((entry) => ({
    ...entry,
    nearest: { ...entry.nearest, distance: Number(entry.nearest.distance.toFixed(6)) },
  })),
  closestCrossNudityPairs: pairs.filter((pair) => !pair.sameNudity).slice(0, 8).map(roundPair),
  closestSameNudityPairs: pairs.filter((pair) => pair.sameNudity).slice(0, 8).map(roundPair),
  embeddingUseRecommendation: 'visual_similarity_and_leakage_evidence_only',
  nudityThresholdRecommended: false,
  semanticClusterPromotionRecommended: false,
  sourcePoolLeakageGuardRequired: true,
  trainingReady: false,
  fullEmbeddingsIncluded: false,
  imageBytesIncluded: false,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  itemCount: output.itemCount,
  pairCount: output.pairCount,
  embeddingModel: output.embeddingModel,
  metrics: output.metrics,
  sourcePools: output.sourcePools,
  nearestNeighbors: output.nearestNeighbors,
  closestCrossNudityPairs: output.closestCrossNudityPairs,
  embeddingUseRecommendation: output.embeddingUseRecommendation,
  nudityThresholdRecommended: false,
  semanticClusterPromotionRecommended: false,
  sourcePoolLeakageGuardRequired: true,
  trainingReady: false,
  output: '.tmp/moderation-test-set/combined-external-v1/neighbor-audit-v1.json',
  fullEmbeddingsPrinted: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
