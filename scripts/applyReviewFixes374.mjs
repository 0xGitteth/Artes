#!/usr/bin/env node
import fs from 'node:fs/promises';

const read = (path) => fs.readFile(path, 'utf8');
const write = (path, content) => fs.writeFile(path, content, 'utf8');

const replaceOnce = (source, search, replacement, label) => {
  const first = source.indexOf(search);
  if (first === -1) throw new Error(`Missing anchor for ${label}`);
  if (source.indexOf(search, first + search.length) !== -1) throw new Error(`Anchor for ${label} is not unique`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
};

// Finding 1: preserve aliases for every contributor ID required by an approved Codex merge recovery,
// including aliases moved onto a real-created primary contributor.
{
  const path = 'functions/scripts/reconcileCodexDevIsolation.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    "    const contributorIds = new Set(deletableContributors.map((doc) => doc.id));\n    const aliasQueries = await Promise.all([\n      queryDocs(db.collection('contributorAliases').where('createdByUid', '==', uid)),\n      ...[...contributorIds].map((id) => queryDocs(db.collection('contributorAliases').where('contributorId', '==', id))),\n      ...[...preservedContributorIds].map((id) => queryDocs(db.collection('contributorAliases').where('contributorId', '==', id))),\n    ]);",
    "    const contributorIds = new Set(deletableContributors.map((doc) => doc.id));\n    const aliasPreservationContributorIds = new Set([\n      ...preservedContributorIds,\n      ...approvedMergeRecoveryContributorIds,\n    ]);\n    const aliasQueries = await Promise.all([\n      queryDocs(db.collection('contributorAliases').where('createdByUid', '==', uid)),\n      ...[...contributorIds].map((id) => queryDocs(db.collection('contributorAliases').where('contributorId', '==', id))),\n      ...[...aliasPreservationContributorIds].map((id) => queryDocs(db.collection('contributorAliases').where('contributorId', '==', id))),\n    ]);",
    'merge recovery alias preservation set',
  );
  source = replaceOnce(
    source,
    "    const preservedAliases = aliases.filter((alias) => preservedContributorIds.has(alias.data()?.contributorId));\n    stats.preservedContributorAliases += preservedAliases.length;\n    for (const alias of aliases.filter((candidate) => !preservedContributorIds.has(candidate.data()?.contributorId))) {",
    "    const preservedAliases = aliases.filter((alias) => aliasPreservationContributorIds.has(alias.data()?.contributorId));\n    stats.preservedContributorAliases += preservedAliases.length;\n    for (const alias of aliases.filter((candidate) => !aliasPreservationContributorIds.has(candidate.data()?.contributorId))) {",
    'merge recovery alias delete guard',
  );
  await write(path, source);
}

// Finding 2: remove all client-side Codex upload read privilege. New moderation messages already
// carry metadata.ownerUid, so ChatPanel does not need this direct-read fallback for current test flows.
{
  const path = 'firestore.rules';
  let source = await read(path);
  source = replaceOnce(
    source,
    "      allow read: if (!isKnownCodexProductionDenied()\n          && (isModerator() || (request.auth != null && request.auth.uid == resource.data.userId)))\n        || (isCodexDev()\n          && request.auth.uid == resource.data.userId\n          && ('testActor' in resource.data)\n          && resource.data.testActor == 'codex');",
    "      allow read: if !isKnownCodexProductionDenied() && (isModerator() || (request.auth != null && request.auth.uid == resource.data.userId));",
    'remove Codex upload read exception',
  );
  await write(path, source);
}

// Focused cleanup regression: model a moved Codex alias that now points at the real primary.
{
  const path = 'tests/codexDevLegacyCleanup.test.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    "  'contributorAliases/merge-evidence-alias': { contributorId: 'merge-primary' },",
    "  'contributorAliases/merge-evidence-alias': { contributorId: 'merge-primary', createdByUid: 'marked-test', type: 'instagram' },",
    'moved merge alias fixture',
  );
  source = replaceOnce(
    source,
    'assert.equal(dryStats.preservedContributorAliases, 6);',
    'assert.equal(dryStats.preservedContributorAliases, 7);',
    'moved merge alias preserved count',
  );
  await write(path, source);
}

// Rules regressions: current Codex and stale-claim retired Codex cannot directly read uploads,
// even explicit testActor uploads; server-side functions remain the authority for test flows.
{
  const path = 'tests/firestore.publicUsers.rules.test.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    "    const retiredCodexDb = authedContext(testEnv, 'retired-codex', { email_verified: true, idvVerified: true, isAdult: true }).firestore();\n    const retiredCodexModeratorDb = authedContext(testEnv, 'retired-codex', { email_verified: true, idvVerified: true, isAdult: true, email: 'mod_1@example.com' }).firestore();",
    "    const retiredCodexDb = authedContext(testEnv, 'retired-codex', { email_verified: true, idvVerified: true, isAdult: true }).firestore();\n    const retiredCodexClaimedDb = authedContext(testEnv, 'retired-codex', { devCodex: true, devActor: 'codex', email_verified: false }).firestore();\n    const retiredCodexModeratorDb = authedContext(testEnv, 'retired-codex', { email_verified: true, idvVerified: true, isAdult: true, email: 'mod_1@example.com' }).firestore();",
    'retired stale claims context',
  );
  source = replaceOnce(
    source,
    "    await assertFails(getDoc(doc(codexDevDb, 'uploads', 'owner_upload_rules')));\n    await assertFails(getDoc(doc(codexDevDb, 'uploads', 'codex_legacy_production_upload_rules')));\n    await assertSucceeds(getDoc(doc(codexDevDb, 'uploads', 'codex_test_upload_rules')));",
    "    await assertFails(getDoc(doc(codexDevDb, 'uploads', 'owner_upload_rules')));\n    await assertFails(getDoc(doc(codexDevDb, 'uploads', 'codex_legacy_production_upload_rules')));\n    await assertFails(getDoc(doc(codexDevDb, 'uploads', 'codex_test_upload_rules')));",
    'current Codex direct upload deny',
  );
  source = replaceOnce(
    source,
    "    await assertFails(getDoc(doc(codexModeratorDb, 'uploads', 'owner_upload_rules')));\n    await assertFails(getDoc(doc(codexModeratorDb, 'reviewCases', 'owner_review_case')));\n    await assertSucceeds(getDoc(doc(codexModeratorDb, 'uploads', 'codex_test_upload_rules')));\n\n    await assertFails(getDoc(doc(retiredCodexDb, 'uploads', 'retired_codex_test_upload_rules')));",
    "    await assertFails(getDoc(doc(codexModeratorDb, 'uploads', 'owner_upload_rules')));\n    await assertFails(getDoc(doc(codexModeratorDb, 'reviewCases', 'owner_review_case')));\n    await assertFails(getDoc(doc(codexModeratorDb, 'uploads', 'codex_test_upload_rules')));\n\n    await assertFails(getDoc(doc(retiredCodexDb, 'uploads', 'retired_codex_test_upload_rules')));\n    await assertFails(getDoc(doc(retiredCodexClaimedDb, 'uploads', 'retired_codex_test_upload_rules')));",
    'retired stale claims direct upload deny',
  );
  await write(path, source);
}

await fs.unlink(new URL(import.meta.url));
console.log('✅ PR #374 review fixes applied and temporary patcher removed.');
