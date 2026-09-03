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

test('external POC analysis validates 768D embeddings and prints no full vectors or image bytes', () => {
  assert.match(source, /item\.embedding\.length !== 768/);
  assert.match(source, /fullEmbeddingsPrinted: false/);
  assert.match(source, /imageBytesPrinted: false/);
  assert.doesNotMatch(source, /JSON\.stringify\(items\)/);
});

test('external POC analysis reports deterministic nearest-neighbor and ordered-pair summaries', () => {
  assert.match(source, /nearestNeighbors/);
  assert.match(source, /orderedPairs/);
  assert.match(source, /toFixed\(6\)/);
  assert.match(source, /localeCompare/);
});
