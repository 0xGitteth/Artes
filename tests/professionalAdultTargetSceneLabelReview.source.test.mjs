import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const review = readFileSync(new URL('../scripts/serveProfessionalAdultTargetSceneLabelReview.js', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../vision-service/run_professional_adult_target_scene_label_review_v1.sh', import.meta.url), 'utf8');
const balanced = JSON.parse(readFileSync(new URL('../docs/moderation-balanced-target-scene-assistant-prefill-v1.json', import.meta.url), 'utf8'));
const depth = JSON.parse(readFileSync(new URL('../docs/moderation-adultlabs-scene-depth-assistant-prefill-v1.json', import.meta.url), 'utf8'));

const expand = (prefill) => prefill.indexRules.flatMap((rule) => (rule.indices || []).map((index) => ({ index, ...rule })));
const assertCoverage = (prefill, count) => {
  const items = expand(prefill);
  const indices = items.map((item) => item.index);
  assert.equal(prefill.itemCount, count);
  assert.equal(indices.length, count);
  assert.equal(new Set(indices).size, count);
  assert.deepEqual([...indices].sort((a,b)=>a-b), Array.from({length:count},(_,i)=>i+1));
  assert.equal(prefill.authoritative, false);
  assert.equal(prefill.humanConfirmationRequired, true);
  assert.equal(prefill.discoveryMetadataUsedAsLabelAuthority, false);
  return items;
};

test('both target-scene assistant prefills cover their batches exactly once', () => {
  const balancedItems = assertCoverage(balanced, 78);
  const depthItems = assertCoverage(depth, 63);
  assert.equal(balanced.summary.realPhotographSuggestionCount, 63);
  assert.equal(balanced.summary.marketingCompositeExclusionSuggestionCount, 15);
  assert.equal(balancedItems.filter((item) => item.detectorLabel?.sexualContext === 'explicit_act').length, 6);
  assert.equal(depth.summary.realPhotographSuggestionCount, 63);
  assert.equal(depth.summary.marketingCompositeExclusionSuggestionCount, 0);
  assert.equal(depthItems.filter((item) => item.detectorLabel?.sexualContext === 'explicit_act').length, 43);
  assert.equal(depthItems.filter((item) => item.detectorLabel?.sexualContext === 'suggestive').length, 12);
  assert.equal(depthItems.filter((item) => item.detectorLabel?.sexualContext === 'none').length, 8);
});

test('one local reviewer supports balanced and scene-depth batches', () => {
  assert.match(review, /HOST = '127\.0\.0\.1'/);
  assert.match(review, /balanced-target-scene-preview-screening\.json/);
  assert.match(review, /adultlabs-scene-depth-preview-screening\.json/);
  assert.match(review, /moderation-balanced-target-scene-assistant-prefill-v1\.json/);
  assert.match(review, /moderation-adultlabs-scene-depth-assistant-prefill-v1\.json/);
  assert.match(review, /research_balanced_professional_adult_target_scene_preview_screening_only/);
  assert.match(review, /research_adultlabs_scene_depth_preview_screening_only/);
  assert.match(review, /ARTES_TARGET_SCENE_REVIEW_BATCH/);
  assert.match(review, /Vooringevuld door assistent/);
  assert.match(review, /Voorstel klopt \/ bevestigen/);
  assert.match(review, /Discovery facets zijn bewust verborgen/);
  assert.doesNotMatch(review, />\s*Discovery facet\s*</i);
  assert.doesNotMatch(review, /\$\{[^}\n]*targetFacet[^}\n]*\}/);
  assert.doesNotMatch(review, /<[^>\n]*>[^<\n]*targetFacet[^<\n]*</i);
  assert.match(review, /discoveryFacet: record\.targetFacet \|\| null/);
});

test('review output keeps human labels authoritative and preserves scene-depth provenance without promotion', () => {
  assert.match(review, /labelSource: 'local_human_review'/);
  assert.match(review, /humanLabelsAuthoritative: true/);
  assert.match(review, /assistantSuggestionAcceptedAsIs/);
  assert.match(review, /discoveryMetadataIsLabelAuthority: false/);
  assert.match(review, /sceneDepthQuantile: record\.quantile \?\? null/);
  assert.match(review, /screenshotOrdinal: record\.screenshotOrdinal \?\? null/);
  assert.match(review, /semanticClusterApproved: false/);
  assert.match(review, /researchOnly: true/);
  assert.match(review, /trainingReady: false/);
  assert.match(review, /productionEligible: false/);
  assert.match(review, /runtimeEligible: false/);
  assert.doesNotMatch(review, /trainingReady: true|productionEligible: true|runtimeEligible: true/);
});

test('single runner selects either review batch and uses the generalized server', () => {
  assert.match(runner, /balanced\|scene-depth/);
  assert.match(runner, /professionalAdultTargetSceneLabelReview\.source\.test\.mjs/);
  assert.match(runner, /serveProfessionalAdultTargetSceneLabelReview\.js/);
  assert.match(runner, /ARTES_TARGET_SCENE_REVIEW_BATCH/);
});
