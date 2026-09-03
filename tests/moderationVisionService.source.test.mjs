import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../vision-service/app.py', import.meta.url), 'utf8');

test('vision service is pinned to non-generative DINOv2 base embedding contract', () => {
  assert.match(source, /facebook\/dinov2-base/);
  assert.match(source, /MODEL_NAME = 'dinov2_vitb14'/);
  assert.match(source, /EMBEDDING_DIMENSION = 768/);
  assert.match(source, /'generative': False/);
  assert.match(source, /outputs\.last_hidden_state\[:, 0, :\]/);
  assert.match(source, /F\.normalize\(vector, p=2, dim=1\)/);
});

test('vision service does not invent detector or final policy output', () => {
  assert.match(source, /detectorResult=None/);
  assert.doesNotMatch(source, /finalOutcome/);
  assert.doesNotMatch(source, /policyDecision/);
  assert.doesNotMatch(source, /accessLevel/);
});

test('vision service accepts only bounded supported image input and does not persist uploads', () => {
  assert.match(source, /MAX_IMAGE_BYTES/);
  assert.match(source, /image\/jpeg/);
  assert.match(source, /image\/png/);
  assert.match(source, /image\/webp/);
  assert.doesNotMatch(source, /open\([^\n]*['\"]w/);
  assert.doesNotMatch(source, /write_bytes|write_text|NamedTemporaryFile|mkstemp/);
});

test('vision service fails with structured JSON-safe model errors', () => {
  assert.match(source, /logger\.exception\('Vision model inference failed\.'\)/);
  assert.match(source, /HTTPException\(status_code=503, detail='vision_model_unavailable'\)/);
});
