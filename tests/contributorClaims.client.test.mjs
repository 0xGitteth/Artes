import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const firebaseSource = readFileSync(new URL('../src/firebase.js', import.meta.url), 'utf8');
const helperMatch = firebaseSource.match(/export const createContributorWithAliases = async[\s\S]*?\n};/);
assert.ok(helperMatch, 'createContributorWithAliases helper exists');
assert.match(helperMatch[0], /httpsCallable\(getFirebaseFunctions\(\), 'createTemporaryContributor'\)/, 'createContributorWithAliases uses callable');
assert.doesNotMatch(helperMatch[0], /runTransaction|transaction\.set|getContributorAliasRef|contributorAliases/, 'createContributorWithAliases no longer writes aliases directly');
assert.match(firebaseSource, /if \(type === 'email'\)[\s\S]*?'getContributorByAliasCallable'/, 'email alias lookup uses callable instead of direct readable alias doc');

const functionsSource = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
assert.match(functionsSource, /export const createTemporaryContributor = onCall/, 'createTemporaryContributor callable exists');
assert.match(functionsSource, /db\.runTransaction/, 'createTemporaryContributor writes contributor and aliases atomically');
assert.match(functionsSource, /db\.collection\('contributorAliases'\)/, 'createTemporaryContributor owns contributor alias writes on the server');


const callableMatch = functionsSource.match(/export const createTemporaryContributor = onCall[\s\S]*?export const createClaimInvite = onCall/);
assert.ok(callableMatch, 'createTemporaryContributor callable body is inspectable');
assert.doesNotMatch(callableMatch[0], /email:\s*normalizedEmail\s*\|\|\s*null/, 'public contributor document does not store raw normalized email');
assert.match(callableMatch[0], /hasEmail:\s*Boolean\(normalizedEmail\)/, 'public contributor document stores hasEmail flag');
assert.match(callableMatch[0], /getContributorContactRef\(contributorRef\.id\)/, 'raw email is written only to private contributor contact doc');
assert.match(callableMatch[0], /throw new HttpsError\('already-exists'/, 'duplicate alias rejection is preserved');
assert.match(functionsSource, /export const getContributorByAliasCallable = onCall/, 'server alias lookup callable exists for private email aliases');
assert.match(functionsSource, /toPublicContributor\(contributorSnap\.id/, 'alias lookup callable returns safe contributor data');
assert.match(callableMatch[0], /aliasRefs\.filter\(\(alias\) => alias\.type !== 'email'\)\.map/, 'temporary contributor response does not return raw email alias ids');
assert.match(functionsSource, /id: type === 'email' \? null : aliasSnap\.id/, 'email alias lookup response does not return raw email alias id');

console.log('contributorClaims client tests passed');
