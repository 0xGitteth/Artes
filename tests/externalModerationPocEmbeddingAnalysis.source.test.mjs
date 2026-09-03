import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/analyzeExternalModerationPocEmbeddings.js', import.meta.url), 'utf8');

test('external POC analysis reads only local intake and uses cosine distance', () => {
  assert.match(source, /\.tmp.*moderation-test-set.*external-poc.*intake\.json/s);
  assert.match(source, /cosineSimilarity/);
  assert.match(source, /cosineDistance/);
  assert.match(source, /smallerMeansMoreSimilar/);
  assert.doesNotMatch(source, /fetch\(/);
});

test('external POC analysis validates stored DINO embedding object and 768D vector', () => {
  assert.match(source, /embedding\?\.vector/);
  assert.match(source, /embedding\.model !== EXPECTED_MODEL/);
  assert.match(source, /embedding\.dimension !== EXPECTED_DIMENSION/);
  assert.match(source, /vector\.length !== EXPECTED_DIMENSION/);
  assert.match(source, /vector\.every\(Number\.isFinite\)/);
  assert.match(source, /EXPECTED_MODEL = 'dinov2_vitb14'/);
  assert.match(source, /EXPECTED_DIMENSION = 768/);
});

test('external POC analysis prints no full vectors or image bytes', () => {
  assert.match(source, /fullEmbeddingsPrinted: false/);
  assert.match(source, /imageBytesPrinted: false/);
  assert.doesNotMatch(source, /JSON\.stringify\(rawItems\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(items\)/);
});

test('external POC analysis reports deterministic nearest-neighbor and ordered-pair summaries', () => {
  assert.match(source, /nearestNeighbors/);
  assert.match(source, /orderedPairs/);
  assert.match(source, /toFixed\(6\)/);
  assert.match(source, /localeCompare/);
});
