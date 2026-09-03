import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/testLocalModerationVisionPoc.js', import.meta.url), 'utf8');

test('local vision POC uses provider client and supported local image formats only', () => {
  assert.match(source, /createModerationCustomVisionClient/);
  assert.match(source, /ARTES_CUSTOM_VISION_URL/);
  assert.match(source, /image\/jpeg/);
  assert.match(source, /image\/png/);
  assert.match(source, /image\/webp/);
});

test('local vision POC prints metadata rather than image bytes or embedding contents', () => {
  assert.match(source, /embeddingDimension: result\.embedding\.length/);
  assert.match(source, /imageBytesPrinted: false/);
  assert.doesNotMatch(source, /JSON\.stringify\(result\)/);
  assert.doesNotMatch(source, /base64/);
});
