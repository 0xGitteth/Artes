import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeModerationExamplesResponse, hasModerationExampleDisplayValue } from '../src/utils/moderationExamplesUi.js';

test('normalizes empty moderation examples responses', () => {
  assert.deepEqual(normalizeModerationExamplesResponse(null), []);
  assert.deepEqual(normalizeModerationExamplesResponse({}), []);
  assert.deepEqual(normalizeModerationExamplesResponse({ examples: 'nope' }), []);
});

test('selects only safe display fields and ignores raw/private fields', () => {
  const [example] = normalizeModerationExamplesResponse({
    examples: [{
      exampleId: 'example1',
      createdAt: '2026-01-01T00:00:00.000Z',
      finalOutcome: 'forbidden',
      learningStatus: 'resolved',
      fingerprintMatchType: 'sha256',
      uploaderUid: 'private',
      rawOutput: 'secret',
      prompt: 'secret',
      upload: { imageBlob: 'secret' },
      moderatorDecision: { action: 'rejectForbidden', reasonCode: 'explicit', notes: 'internal' },
      aiSnapshot: {
        outcome: 'forbidden',
        classification: 'adult',
        shouldReview: true,
        appliedTriggers: ['adultEroticSuggestive'],
        suggestedTriggers: ['adultEroticSuggestive'],
        forbiddenReasons: ['explicit'],
        requiredThemes: ['Art Nude'],
        rawOutput: 'nested secret',
        prompt: 'nested secret',
      },
      analytics: { mismatchType: 'none', debug: 'secret' },
    }],
  });

  assert.deepEqual(example, {
    exampleId: 'example1',
    createdAt: '2026-01-01T00:00:00.000Z',
    finalOutcome: 'forbidden',
    learningStatus: 'resolved',
    fingerprintMatchType: 'sha256',
    moderatorDecision: { action: 'rejectForbidden', reasonCode: 'explicit' },
    aiSnapshot: {
      outcome: 'forbidden',
      classification: 'adult',
      shouldReview: true,
      appliedTriggers: ['adultEroticSuggestive'],
      suggestedTriggers: ['adultEroticSuggestive'],
      forbiddenReasons: ['explicit'],
      requiredThemes: ['Art Nude'],
    },
    analytics: { mismatchType: 'none' },
  });
  assert.equal(example.rawOutput, undefined);
  assert.equal(example.prompt, undefined);
  assert.equal(example.uploaderUid, undefined);
  assert.equal(example.upload, undefined);
  assert.equal(example.moderatorDecision.notes, undefined);
  assert.equal(example.aiSnapshot.rawOutput, undefined);
  assert.equal(example.analytics.debug, undefined);
  assert.equal(hasModerationExampleDisplayValue(example), true);
});

test('limits moderation examples to five', () => {
  const examples = normalizeModerationExamplesResponse({ examples: Array.from({ length: 7 }, (_, index) => ({ exampleId: `e${index}` })) });
  assert.equal(examples.length, 5);
});

test('moderator UI fetches HTTPS endpoint and does not read moderationExamples directly', () => {
  const source = fs.readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
  assert.match(source, /getModerationExamplesForCase/);
  assert.doesNotMatch(source, /collection\(db, ['"]moderationExamples['"]\)/);
  assert.doesNotMatch(source, /doc\(db, ['"]moderationExamples['"]\)/);
});
