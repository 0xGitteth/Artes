import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plan = JSON.parse(readFileSync(new URL('../docs/moderation-nudity-head-dataset-gates-v1.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../scripts/assessNudityHeadDatasetReadiness.js', import.meta.url), 'utf8');

test('nudity pilot defines all seven visual classes and keeps later moderation heads separate', () => {
  assert.deepEqual(plan.scope.classes, [
    'none',
    'underwear_swimwear',
    'implied_nude',
    'bare_buttocks',
    'female_bare_breasts',
    'genitalia',
    'male_topless',
  ]);
  assert.ok(plan.scope.outOfScopeForFirstHead.includes('sexualContext'));
  assert.ok(plan.scope.outOfScopeForFirstHead.includes('sensitiveSignals'));
});

test('experimental and preferred gates require both image and independent source-pool coverage', () => {
  assert.ok(plan.experimentalProbeGate.minimumTotalHumanLabeledImages >= 100);
  assert.ok(plan.experimentalProbeGate.minimumSourcePoolsTotal >= 8);
  assert.ok(plan.preferredPilotTrainingGate.minimumTotalHumanLabeledImages >= 250);
  assert.ok(plan.preferredPilotTrainingGate.minimumSourcePoolsTotal >= 15);
  assert.ok(plan.preferredPilotTrainingGate.minimumSourcePoolsPerClass >= 4);
  assert.ok(plan.preferredPilotTrainingGate.maxSingleSourcePoolFraction <= 0.2);
});

test('benchmark is separate and no data gate grants runtime authority', () => {
  assert.equal(plan.pilotGoldenBenchmark.sourcePoolsMustBeDisjointFromTraining, true);
  assert.equal(plan.pilotGoldenBenchmark.benchmarkOnly, true);
  assert.equal(plan.experimentalProbeGate.runtimeEligible, false);
  assert.equal(plan.preferredPilotTrainingGate.runtimeEligible, false);
});

test('readiness assessment counts source pools per class and remains non-promoting', () => {
  assert.match(source, /sourcePoolsPerClass/);
  assert.match(source, /largestSourcePoolFraction/);
  assert.match(source, /experimentalProbeGate/);
  assert.match(source, /preferredPilotTrainingGate/);
  assert.match(source, /trainingPromotionReady: false/);
  assert.match(source, /runtimeEligible: false/);
  assert.match(source, /fullEmbeddingsPrinted: false/);
  assert.match(source, /imageBytesPrinted: false/);
  assert.doesNotMatch(source, /trainingReady: true/);
});
