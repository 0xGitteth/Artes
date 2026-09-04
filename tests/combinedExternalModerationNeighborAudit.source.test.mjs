import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const combinedSource = readFileSync(new URL('../scripts/buildCombinedExternalModerationSeedV1.js', import.meta.url), 'utf8');
const auditSource = readFileSync(new URL('../scripts/auditCombinedExternalModerationNeighborsV1.js', import.meta.url), 'utf8');
const originalManifest = JSON.parse(readFileSync(new URL('../docs/moderation-external-poc-manifest-v1.json', import.meta.url), 'utf8'));
const expansionManifest = JSON.parse(readFileSync(new URL('../docs/moderation-external-expansion-poc-v1.json', import.meta.url), 'utf8'));

test('all external manifest entries carry an explicit source pool for leakage control', () => {
  const entries = [...(originalManifest.entries || []), ...(expansionManifest.entries || [])];
  assert.equal(entries.length, 8);
  for (const entry of entries) {
    assert.match(entry.sourcePoolId || '', /^[a-z0-9_]+$/);
  }
  assert.equal(new Set(entries.map((entry) => entry.sourcePoolId)).size, 2);
});

test('combined seed resolves source pools from manifests and requires leakage guarding', () => {
  assert.match(combinedSource, /moderation-external-poc-manifest-v1\.json/);
  assert.match(combinedSource, /moderation-external-expansion-poc-v1\.json/);
  assert.match(combinedSource, /combined_seed_missing_source_pool/);
  assert.match(combinedSource, /sourcePoolLeakageGuardRequired: true/);
  assert.match(combinedSource, /sourcePoolCounts/);
  assert.doesNotMatch(combinedSource, /sourcePoolLeakageGuardRequired: false/);
});

test('global neighbor audit compares all eight vectors without promoting label thresholds', () => {
  assert.match(auditSource, /items\.length !== 8/);
  assert.match(auditSource, /cosineDistance/);
  assert.match(auditSource, /nearestNeighborSameNudityRate/);
  assert.match(auditSource, /nearestNeighborSameSourcePoolRate/);
  assert.match(auditSource, /nearestNeighborSameSourcePoolDifferentNudityCount/);
  assert.match(auditSource, /closestCrossNudityPairs/);
  assert.match(auditSource, /visual_similarity_and_leakage_evidence_only/);
  assert.match(auditSource, /nudityThresholdRecommended: false/);
  assert.match(auditSource, /semanticClusterPromotionRecommended: false/);
  assert.match(auditSource, /trainingReady: false/);
});

test('global neighbor audit never prints or embeds raw vectors or image bytes in its report', () => {
  assert.match(auditSource, /fullEmbeddingsIncluded: false/);
  assert.match(auditSource, /imageBytesIncluded: false/);
  assert.match(auditSource, /fullEmbeddingsPrinted: false/);
  assert.match(auditSource, /imageBytesPrinted: false/);
  assert.doesNotMatch(auditSource, /JSON\.stringify\(items\)/);
});
