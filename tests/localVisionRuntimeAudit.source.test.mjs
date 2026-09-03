import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../vision-service/audit_runtime.py', import.meta.url), 'utf8');

test('local vision runtime audit is read-only and installs nothing', () => {
  assert.match(source, /local_vision_runtime_read_only/);
  assert.match(source, /"writes": False/);
  assert.match(source, /"modelDownloadedByThisAudit": False/);
  assert.match(source, /"packagesInstalledByThisAudit": False/);
  assert.doesNotMatch(source, /subprocess/);
  assert.doesNotMatch(source, /pip install/);
});

test('local vision runtime audit checks required POC modules and disk', () => {
  for (const name of ['fastapi', 'uvicorn', 'PIL', 'torch', 'torchvision', 'transformers']) {
    assert.match(source, new RegExp(`"${name}"`));
  }
  assert.match(source, /shutil\.disk_usage/);
  assert.match(source, /freeGiB/);
});
