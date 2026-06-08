import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/firebase.js', import.meta.url), 'utf8');
const match = source.match(/const buildPublicProfilePayload = \(data = \{}, uid, existingPublic = \{}\) => \{[\s\S]*?\n\};\n\nconst writePublicUserProfile/);
assert.ok(match, 'buildPublicProfilePayload helper exists');

const helper = match[0];

assert.match(
  helper,
  /payload\.profileId\s*=\s*uid;/,
  'publicUsers/{uid}.profileId is always derived from the target uid',
);
assert.match(
  helper,
  /payload\.ownerUid\s*=\s*uid;/,
  'publicUsers/{uid}.ownerUid is always derived from the target uid',
);
assert.doesNotMatch(
  helper,
  /payload\.profileId\s*=\s*(?:data|existingPublic|resolvedUid)/,
  'profileId must not be derived from input data, existing public data, or data.uid fallbacks',
);
assert.doesNotMatch(
  helper,
  /payload\.ownerUid\s*=\s*(?:data|existingPublic|resolvedUid)/,
  'ownerUid must not be derived from input data, existing public data, or data.uid fallbacks',
);

console.log('PASS firebase.publicProfilePayload.client.test');
