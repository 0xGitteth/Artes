import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fetcher = await readFile(new URL('../scripts/fetchCreativeExplicitPreviewScreening.js', import.meta.url), 'utf8');
const runner = await readFile(new URL('../vision-service/run_creative_explicit_preview_screening_v1.sh', import.meta.url), 'utf8');

test('preview screening requires a completed large metadata shortlist', () => {
  assert.match(fetcher, /research_metadata_shortlist_only/);
  assert.match(fetcher, /readyForPreviewScreening !== true/);
  assert.match(fetcher, /shortlist\.candidates\.length < 120/);
});

test('preview downloads stay bounded and on public Flickr assets', () => {
  assert.match(fetcher, /PREVIEW_MAX_DIMENSION = 768/);
  assert.match(fetcher, /MAX_PREVIEW_BYTES = 2 \* 1024 \* 1024/);
  assert.match(fetcher, /staticflickr\\\.com/);
  assert.match(fetcher, /EXACT_PHOTO_PATH/);
  assert.doesNotMatch(fetcher, /Authorization|Bearer|Cookie/);
});

test('preview flow remains non-authoritative research only', () => {
  assert.match(fetcher, /previewOnly: true/);
  assert.match(fetcher, /humanVisualScreeningRequired: true/);
  assert.match(fetcher, /humanAgeSafetyReviewRequired: true/);
  assert.match(fetcher, /detectorLabel: null/);
  assert.match(fetcher, /trainingReady: false/);
  assert.match(fetcher, /productionEligible: false/);
});

test('runner packages previews and provenance into one zip', () => {
  assert.match(runner, /fetchCreativeExplicitPreviewScreening\.js/);
  assert.match(runner, /creative-explicit-preview-screening-v1\.zip/);
  assert.match(runner, /preview-sources\.json/);
  assert.match(runner, /flickr-metadata-shortlist\.json/);
  assert.match(runner, /zipfile\.ZIP_DEFLATED/);
});
