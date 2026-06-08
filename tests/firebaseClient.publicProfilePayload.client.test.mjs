import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/firebaseClient.js', import.meta.url), 'utf8');
const match = source.match(/const toPublicProfilePayload = \(payload = \{}, uid\) => \{[\s\S]*?\n\};\n\n\/\/ Debug logging helper/);
assert.ok(match, 'toPublicProfilePayload helper exists');

const helper = match[0];

assert.match(
  helper,
  /profileId:\s*uid,/, 
  'publicUsers/{uid}.profileId is always derived from the target uid',
);
assert.match(
  helper,
  /ownerUid:\s*uid,/, 
  'publicUsers/{uid}.ownerUid is always derived from the target uid',
);
assert.doesNotMatch(
  helper,
  /profileId\s*=\s*payload\?\.profileId|profileId:\s*payload\?\.profileId/,
  'profileId must not be derived from caller payload fields',
);
assert.doesNotMatch(
  helper,
  /ownerUid\s*=\s*payload\?\.ownerUid|ownerUid:\s*payload\?\.ownerUid/,
  'ownerUid must not be derived from caller payload fields',
);

console.log('PASS firebaseClient.publicProfilePayload.client.test');
