import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtesDetectorLabel } from '../functions/moderationLearningDataset.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DATASET = 'external-expansion-v1';
const BASE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', DATASET);
const IMAGE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-images', DATASET);
const INTAKE_PATH = path.join(BASE_DIR, 'intake.json');
const LABELS_PATH = path.join(BASE_DIR, 'labels.reviewed.json');
const SOURCES_PATH = path.join(IMAGE_DIR, 'sources.json');
const OUTPUT_PATH = path.join(BASE_DIR, 'reviewed-analysis.json');

const EXPECTED_MODEL = 'dinov2_vitb14';
const EXPECTED_DIMENSION = 768;

const shortName = (fileName) => String(fileName || '').replace(/\.(?:jpe?g|png|webp)$/i, '');
const stableGroupId = (names) => `poc_mnn_${crypto.createHash('sha256').update([...names].sort().join('|')).digest('hex').slice(0, 12)}`;

const suggestionByFacet = (facet = '') => {
  if (facet.includes('genitalia')) return { nudity: 'genitalia', sexualContext: 'none' };
  if (facet.includes('underwear') || facet.includes('panties') || facet.includes('lingerie')) {
    return {
      nudity: 'underwear_swimwear',
      sexualContext: facet.includes('lingerie_bed') ? 'suggestive' : 'none',
    };
  }
  return { nudity: null, sexualContext: null };
};

const vectorOf = (item) => {
  const embedding = item?.embedding;
  const vector = embedding?.vector;
  if (embedding?.model !== EXPECTED_MODEL || embedding?.dimension !== EXPECTED_DIMENSION) {
    throw new Error(`invalid_embedding_metadata:${item?.fileName || 'unknown'}`);
  }
  if (!Array.isArray(vector) || vector.length !== EXPECTED_DIMENSION || !vector.every(Number.isFinite)) {
    throw new Error(`invalid_embedding_vector:${item?.fileName || 'unknown'}`);
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
  if (normA === 0 || normB === 0) throw new Error('zero_norm_embedding');
  return 1 - (dot / (Math.sqrt(normA) * Math.sqrt(normB)));
};

const [intake, labels, sources] = await Promise.all([
  readFile(INTAKE_PATH, 'utf8').then(JSON.parse),
  readFile(LABELS_PATH, 'utf8').then(JSON.parse),
  readFile(SOURCES_PATH, 'utf8').then(JSON.parse),
]);

const intakeItems = Array.isArray(intake?.items) ? intake.items : [];
const labelItems = Array.isArray(labels?.items) ? labels.items : [];
const sourceRecords = Array.isArray(sources?.records) ? sources.records : [];
if (intakeItems.length < 2) throw new Error('reviewed_expansion_needs_at_least_two_items');
if (labels?.labelStatus !== 'complete') throw new Error(`reviewed_labels_not_complete:${labels?.labelStatus || 'missing'}`);
if (labelItems.length !== intakeItems.length) throw new Error('reviewed_label_count_mismatch');
if (labels?.trainingReady === true) throw new Error('reviewed_labels_must_not_be_training_ready');

const intakeByFile = new Map(intakeItems.map((item) => [item.fileName, item]));
const sourceByFile = new Map(sourceRecords.map((item) => [item.fileName, item]));
const reviewedByFile = new Map();

for (const labelItem of labelItems) {
  if (!labelItem?.fileName || reviewedByFile.has(labelItem.fileName)) throw new Error('duplicate_or_missing_reviewed_file');
  const intakeItem = intakeByFile.get(labelItem.fileName);
  if (!intakeItem) throw new Error(`reviewed_label_unknown_file:${labelItem.fileName}`);
  if (labelItem.sha256 !== intakeItem.sha256) throw new Error(`reviewed_label_sha_mismatch:${labelItem.fileName}`);
  if (labelItem.labelStatus !== 'human_confirmed' || labelItem.labelSource !== 'local_human_review') {
    throw new Error(`reviewed_label_not_human_confirmed:${labelItem.fileName}`);
  }
  const validation = validateArtesDetectorLabel(labelItem.detectorLabel);
  if (!validation.valid) throw new Error(`invalid_reviewed_detector_label:${labelItem.fileName}:${validation.errors.join(',')}`);
  vectorOf(intakeItem);
  reviewedByFile.set(labelItem.fileName, labelItem);
}

for (const intakeItem of intakeItems) {
  if (!reviewedByFile.has(intakeItem.fileName)) throw new Error(`missing_reviewed_label:${intakeItem.fileName}`);
}

const pairs = [];
for (let i = 0; i < intakeItems.length; i += 1) {
  for (let j = i + 1; j < intakeItems.length; j += 1) {
    const left = intakeItems[i];
    const right = intakeItems[j];
    const leftLabel = reviewedByFile.get(left.fileName).detectorLabel;
    const rightLabel = reviewedByFile.get(right.fileName).detectorLabel;
    pairs.push({
      a: shortName(left.fileName),
      b: shortName(right.fileName),
      cosineDistance: cosineDistance(vectorOf(left), vectorOf(right)),
      sameNudity: leftLabel.nudity === rightLabel.nudity,
      sameSexualContext: leftLabel.sexualContext === rightLabel.sexualContext,
    });
  }
}
pairs.sort((a, b) => a.cosineDistance - b.cosineDistance || a.a.localeCompare(b.a) || a.b.localeCompare(b.b));

const nearestByFile = new Map();
for (const item of intakeItems) {
  const vector = vectorOf(item);
  const candidates = intakeItems
    .filter((other) => other.fileName !== item.fileName)
    .map((other) => ({ fileName: other.fileName, cosineDistance: cosineDistance(vector, vectorOf(other)) }))
    .sort((a, b) => a.cosineDistance - b.cosineDistance || a.fileName.localeCompare(b.fileName));
  nearestByFile.set(item.fileName, candidates[0]);
}

const mutualPairs = [];
const seenMutual = new Set();
for (const item of intakeItems) {
  const nearest = nearestByFile.get(item.fileName);
  const reverse = nearestByFile.get(nearest.fileName);
  if (reverse?.fileName !== item.fileName) continue;
  const key = [item.fileName, nearest.fileName].sort().join('|');
  if (seenMutual.has(key)) continue;
  seenMutual.add(key);
  mutualPairs.push({
    groupId: stableGroupId([item.fileName, nearest.fileName]),
    items: [shortName(item.fileName), shortName(nearest.fileName)].sort(),
    cosineDistance: Number(nearest.cosineDistance.toFixed(6)),
  });
}
mutualPairs.sort((a, b) => a.cosineDistance - b.cosineDistance || a.groupId.localeCompare(b.groupId));

const groupByFile = new Map();
for (const pair of mutualPairs) {
  for (const short of pair.items) {
    const full = intakeItems.find((item) => shortName(item.fileName) === short)?.fileName;
    if (full) groupByFile.set(full, pair.groupId);
  }
}

const itemSummaries = intakeItems.map((item) => {
  const reviewed = reviewedByFile.get(item.fileName);
  const source = sourceByFile.get(item.fileName) || {};
  const nearest = nearestByFile.get(item.fileName);
  const suggestion = suggestionByFacet(source.visualFacet || '');
  const suggestionDisagreements = [];
  if (suggestion.nudity && suggestion.nudity !== reviewed.detectorLabel.nudity) suggestionDisagreements.push('nudity');
  if (suggestion.sexualContext && suggestion.sexualContext !== reviewed.detectorLabel.sexualContext) suggestionDisagreements.push('sexualContext');
  return {
    item: shortName(item.fileName),
    fileName: item.fileName,
    sha256: item.sha256,
    sourceFacet: source.visualFacet || null,
    detectorLabel: reviewed.detectorLabel,
    metadataSuggestion: suggestion,
    metadataSuggestionDisagreements: suggestionDisagreements,
    humanOverrodeMetadataSuggestion: suggestionDisagreements.length > 0,
    nearestNeighbor: shortName(nearest.fileName),
    nearestCosineDistance: Number(nearest.cosineDistance.toFixed(6)),
    pocNeighborGroupId: groupByFile.get(item.fileName) || null,
    humanConfirmed: true,
    trainingReady: false,
  };
}).sort((a, b) => a.item.localeCompare(b.item));

const output = {
  schemaVersion: 1,
  analysisType: 'external_expansion_v1_human_label_validation',
  labelVersion: labels.labelVersion,
  embeddingModel: EXPECTED_MODEL,
  embeddingDimension: EXPECTED_DIMENSION,
  itemCount: itemSummaries.length,
  humanConfirmedLabelCount: itemSummaries.length,
  labelsComplete: true,
  trainingReady: false,
  semanticGroupingStatus: 'poc_mutual_nearest_neighbor_only',
  thresholdSelected: false,
  humanOverridesMetadataSuggestions: itemSummaries.filter((item) => item.humanOverrodeMetadataSuggestion).map((item) => ({
    item: item.item,
    fields: item.metadataSuggestionDisagreements,
  })),
  items: itemSummaries,
  mutualNearestNeighborPairs: mutualPairs,
  orderedPairs: pairs.map((pair) => ({ ...pair, cosineDistance: Number(pair.cosineDistance.toFixed(6)) })),
  fullEmbeddingsIncluded: false,
  imageBytesIncluded: false,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  dataset: DATASET,
  itemCount: output.itemCount,
  humanConfirmedLabelCount: output.humanConfirmedLabelCount,
  labelsComplete: output.labelsComplete,
  embeddingModel: output.embeddingModel,
  embeddingDimension: output.embeddingDimension,
  humanOverridesMetadataSuggestions: output.humanOverridesMetadataSuggestions,
  mutualNearestNeighborPairs: output.mutualNearestNeighborPairs,
  itemSummaries: output.items.map((item) => ({
    item: item.item,
    nudity: item.detectorLabel.nudity,
    sexualContext: item.detectorLabel.sexualContext,
    confidence: item.detectorLabel.confidence,
    nearestNeighbor: item.nearestNeighbor,
    nearestCosineDistance: item.nearestCosineDistance,
    humanOverrodeMetadataSuggestion: item.humanOverrodeMetadataSuggestion,
  })),
  trainingReady: false,
  thresholdSelected: false,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  fullEmbeddingsPrinted: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
