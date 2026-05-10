import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const firebaseSource = readFileSync(new URL('../src/firebase.js', import.meta.url), 'utf8');
const helperMatch = firebaseSource.match(/export const createContributorWithAliases = async[\s\S]*?\n};/);
assert.ok(helperMatch, 'createContributorWithAliases helper exists');
assert.match(helperMatch[0], /httpsCallable\(getFirebaseFunctions\(\), 'createTemporaryContributor'\)/, 'createContributorWithAliases uses callable');
assert.doesNotMatch(helperMatch[0], /runTransaction|transaction\.set|getContributorAliasRef|contributorAliases/, 'createContributorWithAliases no longer writes aliases directly');

const functionsSource = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
assert.match(functionsSource, /export const createTemporaryContributor = onCall/, 'createTemporaryContributor callable exists');
assert.match(functionsSource, /db\.runTransaction/, 'createTemporaryContributor writes contributor and aliases atomically');
assert.match(functionsSource, /db\.collection\('contributorAliases'\)/, 'createTemporaryContributor owns contributor alias writes on the server');

console.log('contributorClaims client tests passed');
