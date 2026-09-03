import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/prepareAuthorizedModerationTestSet.js', import.meta.url), 'utf8');

test('authorized moderation test-set intake requires explicit authorization', () => {
  assert.match(source, /--confirm-authorized/);
  assert.match(source, /Refusing intake without/);
});

test('authorized moderation test-set intake stays local and does not copy image bytes', () => {
  assert.match(source, /\.tmp\/moderation-test-images/);
  assert.match(source, /\.tmp\/moderation-test-set/);
  assert.match(source, /imagesCopiedByThisScript: false/);
  assert.match(source, /imageBytesPrinted: false/);
  assert.doesNotMatch(source, /firebase|storage\.googleapis|firestore|uploadBytes|bucket\(/i);
});

test('authorized moderation test-set intake embeds first and leaves labels pending', () => {
  assert.match(source, /client\.infer/);
  assert.match(source, /detectorLabel: null/);
  assert.match(source, /labels\.template\.json/);
  assert.match(source, /pending_human_label/);
});
