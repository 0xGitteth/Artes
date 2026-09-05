import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const prefill = JSON.parse(readFileSync(new URL('../docs/moderation-web-research-assistant-prefill-v1.json', import.meta.url), 'utf8'));

test('assistant visual prefill covers the full prepared web research batch', () => {
  assert.equal(prefill.status, 'complete_visual_review');
  assert.equal(prefill.itemCount, 36);
  assert.equal(prefill.items.length, 36);
  assert.equal(prefill.adultClearCount + prefill.ageSafetySkipCount, 36);
  assert.equal(new Set(prefill.items.map((item) => item.sourceUrl)).size, 36);
});

test('assistant prefills remain non-authoritative and age-uncertain items carry no detector label', () => {
  assert.equal(prefill.authoritative, false);
  assert.equal(prefill.humanConfirmationRequired, true);
  assert.equal(prefill.discoveryMetadataUsedAsLabelAuthority, false);
  for (const item of prefill.items) {
    assert.ok(['adult_clear', 'skip_minor_or_age_uncertain'].includes(item.ageSafetyDecision));
    if (item.ageSafetyDecision === 'skip_minor_or_age_uncertain') {
      assert.equal(item.detectorLabel, null);
    } else {
      assert.equal(item.detectorLabel.possibleMinorConcern, false);
      assert.equal(typeof item.detectorLabel.confidence, 'number');
      assert.ok(item.detectorLabel.confidence >= 0 && item.detectorLabel.confidence <= 1);
    }
  }
});
