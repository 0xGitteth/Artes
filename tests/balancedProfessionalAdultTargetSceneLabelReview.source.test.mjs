import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const review = readFileSync(new URL('../scripts/serveBalancedProfessionalAdultTargetSceneLabelReview.js', import.meta.url), 'utf8');
const prefill = JSON.parse(readFileSync(new URL('../docs/moderation-balanced-target-scene-assistant-prefill-v1.json', import.meta.url), 'utf8'));

const indices = prefill.indexRules.flatMap((rule) => rule.indices || []);

test('balanced target scene assistant prefill covers all 78 items exactly once', () => {
  assert.equal(prefill.itemCount, 78);
  assert.equal(indices.length, 78);
  assert.equal(new Set(indices).size, 78);
  assert.deepEqual([...indices].sort((a,b)=>a-b), Array.from({length:78},(_,i)=>i+1));
  assert.equal(prefill.authoritative, false);
  assert.equal(prefill.humanConfirmationRequired, true);
  assert.equal(prefill.discoveryMetadataUsedAsLabelAuthority, false);
});

test('assistant screening identifies current batch yield and marketing composites', () => {
  assert.equal(prefill.summary.realPhotographSuggestionCount, 63);
  assert.equal(prefill.summary.marketingCompositeExclusionSuggestionCount, 15);
  assert.equal(prefill.summary.explicitActSuggestionCount, 6);
  assert.match(JSON.stringify(prefill), /exclude_marketing_composite/);
  assert.match(JSON.stringify(prefill), /explicit_act/);
});

test('review stays local, prefilled and hides discovery facets from the interface', () => {
  assert.match(review, /HOST = '127\\.0\\.0\\.1'/);
  assert.match(review, /moderation-balanced-target-scene-assistant-prefill-v1\\.json/);
  assert.match(review, /Vooringevuld door assistent/);
  assert.match(review, /Voorstel klopt \\/ bevestigen/);
  assert.match(review, /Discovery facets zijn bewust verborgen/);
  assert.doesNotMatch(review, />\\s*Discovery facet\\s*</i);
  assert.doesNotMatch(review, /\\$\\{[^}\\n]*targetFacet[^}\\n]*\\}/);
  assert.doesNotMatch(review, /<[^>\\n]*>[^<\\n]*targetFacet[^<\\n]*</i);
  assert.match(review, /discoveryFacet: record\\.targetFacet \\|\\| null/);
});

test('review keeps human labels authoritative and cannot promote data', () => {
  assert.match(review, /labelSource: 'local_human_review'/);
  assert.match(review, /humanLabelsAuthoritative: true/);
  assert.match(review, /assistantSuggestionAcceptedAsIs/);
  assert.match(review, /discoveryMetadataIsLabelAuthority: false/);
  assert.match(review, /semanticClusterApproved: false/);
  assert.match(review, /researchOnly: true/);
  assert.match(review, /trainingReady: false/);
  assert.match(review, /productionEligible: false/);
  assert.match(review, /runtimeEligible: false/);
  assert.doesNotMatch(review, /trainingReady: true|productionEligible: true|runtimeEligible: true/);
});
