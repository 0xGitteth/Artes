import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/verifyStagingBuildIsolation.js', import.meta.url), 'utf8');

test('staging build verifier requires staging and forbids production project id', () => {
  assert.match(source, /const STAGING_PROJECT_ID = 'artes-staging'/);
  assert.match(source, /const PRODUCTION_PROJECT_ID = 'artes-media-app'/);
  assert.match(source, /staging_project_id_missing_from_build/);
  assert.match(source, /production_project_id_found_in_staging_build/);
});

test('staging build verifier only reads dist files', () => {
  assert.match(source, /readFileSync/);
  assert.doesNotMatch(source, /writeFileSync|appendFileSync|rmSync|unlinkSync/);
});
