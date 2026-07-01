import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/firebase.js', import.meta.url), 'utf8');
const match = source.match(/export const buildPublicProfilePayload = \(data = \{}, uid, existingPublic = \{}\) => \{[\s\S]*?\n\};\n\n\nconst LEGACY_PUBLIC_IDENTITY_FIELDS/);
assert.ok(match, 'buildPublicProfilePayload helper exists');
const helper = match[0];

assert.match(helper, /const normalizedDisplayName = String\(data\.displayName \|\| ''\)\.trim\(\);\n\s+if \(data\.displayName !== undefined && normalizedDisplayName\) \{\n\s+payload\.displayName = normalizedDisplayName;\n\s+\}/, 'publicUsers displayName is sourced from non-empty app payload displayName only');
assert.match(helper, /if \(payload\.displayName === undefined && payload\.username !== undefined\) \{\n\s+delete payload\.displayName;\n\s+\}/, 'username-only sync does not synthesize a displayName');
assert.match(helper, /if \(payload\.displayName !== undefined\) \{\n\s+payload\.displayNameLower = String\(payload\.displayName\)\.toLowerCase\(\);\n\s+\}/, 'displayNameLower is only produced when displayName is present');
assert.match(helper, /payload\.profileId = uid;/, 'profileId is target uid');
assert.match(helper, /payload\.ownerUid = uid;/, 'ownerUid is target uid');
assert.doesNotMatch(helper, /email\.split|authDisplayName|currentUser\.displayName|user\.displayName/, 'public payload builder does not use auth displayName or email localpart');
assert.doesNotMatch(helper, /legalName|didit|Didit|providerData/, 'public payload builder does not use legal, Didit, or provider profile data');

const ensureMatch = source.match(/export const ensureUserProfile = async \(user\) => \{[\s\S]*?\n\};\n\nexport const migrateArtifactsUserData/);
assert.ok(ensureMatch, 'ensureUserProfile helper exists');
assert.doesNotMatch(ensureMatch[0], /email\.split/, 'ensureUserProfile does not seed names from email localpart');
assert.match(ensureMatch[0], /let existingPublic = \{};\n\s+try \{\n\s+const existingPublicSnap = await getDoc\(doc\(getFirebaseDb\(\), 'publicUsers', user\.uid\)\);\n\s+existingPublic = existingPublicSnap\.exists\(\) \? existingPublicSnap\.data\(\) : \{};/, 'ensureUserProfile existing-profile sync loads existing publicUsers data for cleanup');
assert.match(ensureMatch[0], /await writePublicUserProfile\(\n\s+user\.uid,[\s\S]*?\n\s+existingPublic,\n\s+\);/, 'ensureUserProfile passes existing publicUsers data into public sync');
assert.match(source, /const LEGACY_PUBLIC_IDENTITY_FIELDS = \[\n  'email',\n  'authProvider',\n  'legalName',\n  'didit',\n  'providerData',\n  'authDisplayName',\n  'firebaseDisplayName',\n  'googleDisplayName',\n\];/, 'legacy private/provider identity fields are cleaned from publicUsers writes');
assert.match(source, /const legacyCleanupPatch = getLegacyPublicIdentityCleanupPatch\(existingPublic\);\n\s+if \(!Object\.keys\(payload\)\.length && !Object\.keys\(legacyCleanupPatch\)\.length\) return;/, 'cleanup-only publicUsers writes are not skipped');
assert.match(source, /Object\.assign\(payload, legacyCleanupPatch\);/, 'writePublicUserProfile deletes legacy public identity fields before writing');
assert.match(source, /const resolveInitialPublicDisplayNameSeed = \(user, providerId = resolveAuthProvider\(user\)\) => \{\n\s+if \(providerId === 'google\.com'\) return String\(user\?\.displayName \|\| ''\)\.trim\(\);\n\s+return '';\n\};/, 'Google profile name is initial seed only');

console.log('PASS firebase.publicIdentitySync.client.test');
