import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/fetchTargetedHardGapPreviewScreening.js', import.meta.url), 'utf8');
const runner = await readFile(new URL('../vision-service/run_targeted_hard_gap_preview_screening_v1.sh', import.meta.url), 'utf8');

test('targeted preview screening reads only the curated hard-gap candidate file', () => {
  assert.match(script, /hard-gap-targeted-v1/);
  assert.match(script, /flickr-targeted-candidates\.json/);
  assert.match(script, /research_targeted_flickr_candidates_only/);
  assert.doesNotMatch(script, /flickr-metadata-shortlist\.json/);
});

test('targeted previews remain bounded and public Flickr only', () => {
  assert.match(script, /PREVIEW_MAX_DIMENSION = 768/);
  assert.match(script, /MAX_PREVIEW_BYTES = 2 \* 1024 \* 1024/);
  assert.match(script, /EXACT_PHOTO_PATH/);
  assert.match(script, /staticflickr\\\.com/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['"]Cookie['"]\s*:/i);
});

test('targeted preview metadata preserves provenance but not labels', () => {
  for (const marker of ['sourcePoolId', 'curatedSourceIds', 'targetHints', 'sourceContext', 'ageContext', 'termsStatus']) {
    assert.match(script, new RegExp(marker));
  }
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /humanVisualScreeningRequired: true/);
  assert.match(script, /detectorLabel: null/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
});

test('targeted runner packages previews and both metadata layers into one zip', () => {
  assert.match(runner, /fetchTargetedHardGapPreviewScreening\.js/);
  assert.match(runner, /targeted-hard-gap-preview-screening-v1\.zip/);
  assert.match(runner, /preview-sources\.json/);
  assert.match(runner, /flickr-targeted-candidates\.json/);
});
