import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/provisionModerationStagingAppConfig.js', import.meta.url), 'utf8');

test('staging app provisioning is pinned to Artes staging', () => {
  assert.match(source, /const STAGING_PROJECT_ID = 'artes-staging'/);
  assert.doesNotMatch(source, /artes-media-app/);
});

test('staging app provisioning is dry-run unless explicitly applied', () => {
  assert.match(source, /const APPLY_FLAG = '--apply'/);
  assert.match(source, /mode: 'dry_run'/);
  assert.match(source, /writes: false/);
});

test('staging app provisioning only creates one web app and initializes auth', () => {
  assert.match(source, /projects\/\$\{STAGING_PROJECT_ID\}\/webApps/);
  assert.match(source, /identityPlatform:initializeAuth/);
  assert.match(source, /Meer dan één staging Web App gevonden/);
  assert.match(source, /providersEnabledByThisScript: \[\]/);
  assert.match(source, /usersCreatedByThisScript: 0/);
  assert.match(source, /deploysPerformedByThisScript: 0/);
});

test('staging app provisioning never prints provider secrets', () => {
  assert.match(source, /secretsPrinted: false/);
  assert.doesNotMatch(source, /clientSecret/);
});
