import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/firebase.js', import.meta.url), 'utf8');
const match = source.match(/export const buildPublicProfilePayload = \(data = \{}, uid, existingPublic = \{}\) => \{[\s\S]*?\n\};\n\n\nconst cleanupLegacyPublicEmailIfNeeded/);
assert.ok(match, 'buildPublicProfilePayload helper exists');
const helper = match[0];

assert.match(helper, /if \(data\.displayName !== undefined\) \{\n\s+payload\.displayName = data\.displayName;\n\s+\}/, 'publicUsers displayName is sourced from app payload displayName');
assert.match(helper, /if \(payload\.displayName === undefined && payload\.username !== undefined\) \{\n\s+delete payload\.displayName;\n\s+\}/, 'username-only sync does not synthesize a displayName');
assert.match(helper, /payload\.profileId = uid;/, 'profileId is target uid');
assert.match(helper, /payload\.ownerUid = uid;/, 'ownerUid is target uid');
assert.doesNotMatch(helper, /email\.split|authDisplayName|currentUser\.displayName|user\.displayName/, 'public payload builder does not use auth displayName or email localpart');
assert.doesNotMatch(helper, /legalName|didit|Didit|providerData/, 'public payload builder does not use legal, Didit, or provider profile data');

const ensureMatch = source.match(/export const ensureUserProfile = async \(user\) => \{[\s\S]*?\n\};\n\nexport const migrateArtifactsUserData/);
assert.ok(ensureMatch, 'ensureUserProfile helper exists');
assert.doesNotMatch(ensureMatch[0], /email\.split/, 'ensureUserProfile does not seed names from email localpart');
assert.match(source, /const resolveInitialPublicDisplayNameSeed = \(user, providerId = resolveAuthProvider\(user\)\) => \{\n\s+if \(providerId === 'google\.com'\) return String\(user\?\.displayName \|\| ''\)\.trim\(\);\n\s+return '';\n\};/, 'Google profile name is initial seed only');

console.log('PASS firebase.publicIdentitySync.client.test');
