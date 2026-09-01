import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rules = fs.readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');

test('moderation preview storage is explicitly client immutable', () => {
  assert.match(rules, /match \/moderation-previews\/\{allPaths=\*\*\} \{\s*allow read, write: if false;\s*\}/);
});
