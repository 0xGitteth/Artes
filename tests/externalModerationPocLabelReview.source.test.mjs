import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/serveExternalModerationPocLabelReview.js', import.meta.url), 'utf8');

test('label review server is loopback-only and reads only bounded local POC directories', () => {
  assert.match(source, /const HOST = '127\.0\.0\.1'/);
  assert.match(source, /DEFAULT_DATASET_SUBDIR = 'external-poc'/);
  assert.match(source, /ARTES_LABEL_REVIEW_SUBDIR/);
  assert.match(source, /DATASET_SUBDIR_PATTERN = \/\^\[a-z0-9\]\[a-z0-9\._-\]\*\$\//);
  assert.match(source, /candidate\.includes\('\.\.'\)/);
  assert.match(source, /\.tmp.*moderation-test-images.*DATASET_SUBDIR/s);
  assert.match(source, /\.tmp.*moderation-test-set.*DATASET_SUBDIR/s);
  assert.doesNotMatch(source, /https:\/\//);
});

test('review UI covers the full detector label contract', () => {
  for (const value of ['none', 'underwear_swimwear', 'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia', 'male_topless']) {
    assert.match(source, new RegExp(value));
  }
  for (const value of ['suggestive', 'bdsm_kink', 'explicit_act', 'mild', 'graphic']) {
    assert.match(source, new RegExp(value));
  }
  assert.match(source, /possibleMinorConcern/);
  assert.match(source, /confidence/);
  assert.match(source, /uncertaintyFlags/);
  assert.match(source, /sensitiveSignals/);
});

test('metadata suggestions remain proposals until explicit human confirmation', () => {
  assert.match(source, /Voorselectie is alleen een voorstel/);
  assert.match(source, /Bevestig label/);
  assert.match(source, /labelStatus: 'human_confirmed'/);
  assert.match(source, /labelSource: 'local_human_review'/);
  assert.match(source, /validateArtesDetectorLabel/);
});

test('review suggestions cover underwear, genitalia and suggestive expansion facets', () => {
  assert.match(source, /normalized\.includes\('underwear'\)/);
  assert.match(source, /normalized\.includes\('panties'\)/);
  assert.match(source, /normalized\.includes\('genitalia'\)/);
  assert.match(source, /normalized\.includes\('lingerie_bed'\)/);
  assert.match(source, /suggestion\.sexualContext = 'suggestive'/);
});

test('reviewed labels remain non-training-ready and empty confidence fails closed', () => {
  assert.match(source, /trainingReady: false/);
  assert.match(source, /confidenceRaw===''\?null:Number\(confidenceRaw\)/);
  assert.doesNotMatch(source, /trainingReady: true/);
});
