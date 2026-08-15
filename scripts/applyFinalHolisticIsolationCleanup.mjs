import fs from 'node:fs/promises';

const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Non-unique anchor: ${label}`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
};

const patchFile = async (path, mutate) => {
  const before = await fs.readFile(path, 'utf8');
  const after = mutate(before);
  if (after === before) throw new Error(`No changes produced for ${path}`);
  await fs.writeFile(path, after);
  console.log(`patched ${path}`);
};

await patchFile('functions/scripts/reconcileCodexDevIsolation.js', (source) => {
  source = replaceOnce(
    source,
    `  contributorContentRequests: 0,\n  claimVotes: 0,\n  claimVoteRequestsRecomputed: 0,`,
    `  contributorContentRequests: 0,\n  affiliationUsers: 0,\n  affiliationPublicUsers: 0,\n  affiliationsCleared: 0,\n  moodboardItems: 0,\n  moodboardsRepaired: 0,\n  claimVotes: 0,\n  claimVoteRequestsRecomputed: 0,`,
    'reconcile stats additions',
  );

  source = replaceOnce(
    source,
    `const ACTIVE_ORDINARY_CLAIM_STATUSES = new Set(['pending', 'needsModeration']);\n`,
    `const ACTIVE_ORDINARY_CLAIM_STATUSES = new Set(['pending', 'needsModeration']);\n\nconst buildAffiliationClearPatch = (data = {}, targetIds = new Set()) => {\n  const patch = {};\n  let cleared = 0;\n  for (const kind of ['Agency', 'Company']) {\n    const idField = \`linked\${kind}Id\`;\n    const linkedId = String(data?.[idField] || '').trim();\n    if (!linkedId || !targetIds.has(linkedId)) continue;\n    cleared += 1;\n    patch[idField] = null;\n    patch[\`linked\${kind}Name\`] = '';\n    patch[\`linked\${kind}Link\`] = null;\n    patch[\`linked\${kind}Status\`] = null;\n    patch[\`linked\${kind}StatusUpdatedAt\`] = null;\n    patch[\`linked\${kind}ApprovedAt\`] = null;\n    patch[\`linked\${kind}ApprovedBy\`] = null;\n  }\n  return { patch, cleared };\n};\n\nconst moodboardItemPathParts = (path = '') => {\n  const match = String(path).match(/^users\\/([^/]+)\\/moodboards\\/([^/]+)\\/items\\/([^/]+)$/);\n  return match ? { ownerUid: match[1], moodboardId: match[2], itemId: match[3] } : null;\n};\n`,
    'reconcile dependency helpers',
  );

  source = replaceOnce(
    source,
    `    await deleteRef(db.collection('publicUsers').doc(uid), 'publicUsers');\n\n    const actorPosts = uniqueDocs((await Promise.all([\n      queryDocs(db.collection('posts').where('authorId', '==', uid)),\n      queryDocs(db.collection('posts').where('authorUid', '==', uid)),\n    ])).flat());\n    const actorPostIds = new Set(actorPosts.map((post) => post.id));\n    for (const post of actorPosts) {\n      await deleteRef(post.ref, 'posts', { recursive: true });\n    }\n    for (const profile of await queryDocs(db.collection('profiles').where('ownerUid', '==', uid))) {\n      await deleteRef(profile.ref, 'managedProfiles', { recursive: true });\n    }`,
    `    await deleteRef(db.collection('publicUsers').doc(uid), 'publicUsers');\n\n    const actorManagedProfiles = await queryDocs(db.collection('profiles').where('ownerUid', '==', uid));\n    const actorAffiliationTargetIds = new Set([uid, ...actorManagedProfiles.map((profile) => profile.id)]);\n    for (const user of users.filter((candidate) => candidate.id !== uid)) {\n      const { patch, cleared } = buildAffiliationClearPatch(user.data() || {}, actorAffiliationTargetIds);\n      if (!cleared) continue;\n      stats.affiliationUsers += 1;\n      stats.affiliationsCleared += cleared;\n      if (apply) await user.ref.set({ ...patch, updatedAt: new Date() }, { merge: true });\n    }\n    for (const publicUser of (await queryDocs(db.collection('publicUsers'))).filter((candidate) => candidate.id !== uid)) {\n      const { patch, cleared } = buildAffiliationClearPatch(publicUser.data() || {}, actorAffiliationTargetIds);\n      if (!cleared) continue;\n      stats.affiliationPublicUsers += 1;\n      stats.affiliationsCleared += cleared;\n      if (apply) await publicUser.ref.set({ ...patch, updatedAt: new Date() }, { merge: true });\n    }\n\n    const actorPosts = uniqueDocs((await Promise.all([\n      queryDocs(db.collection('posts').where('authorId', '==', uid)),\n      queryDocs(db.collection('posts').where('authorUid', '==', uid)),\n    ])).flat());\n    const actorPostIds = new Set(actorPosts.map((post) => post.id));\n    const moodboardQueries = await Promise.all([\n      ...[...actorPostIds].map((postId) => queryDocs(db.collectionGroup('items').where('postId', '==', postId))),\n      ...[...actorAffiliationTargetIds].map((authorId) => queryDocs(db.collectionGroup('items').where('postSnapshot.authorId', '==', authorId))),\n    ]);\n    const ordinaryMoodboardItems = uniqueDocs(moodboardQueries.flat()).filter((item) => {\n      const parts = moodboardItemPathParts(item.ref?.path);\n      return parts && parts.ownerUid !== uid;\n    });\n    const moodboardsToRepair = new Map();\n    for (const item of ordinaryMoodboardItems) {\n      const parts = moodboardItemPathParts(item.ref.path);\n      const boardKey = \`\${parts.ownerUid}/\${parts.moodboardId}\`;\n      const group = moodboardsToRepair.get(boardKey) || { ...parts, items: [] };\n      group.items.push(item);\n      moodboardsToRepair.set(boardKey, group);\n    }\n    stats.moodboardItems += ordinaryMoodboardItems.length;\n    stats.moodboardsRepaired += moodboardsToRepair.size;\n    stats.deletes += ordinaryMoodboardItems.length;\n    if (apply) {\n      for (const group of moodboardsToRepair.values()) {\n        const boardRef = db.collection('users').doc(group.ownerUid).collection('moodboards').doc(group.moodboardId);\n        await db.runTransaction(async (transaction) => {\n          const [boardSnapshot, ...itemSnapshots] = await Promise.all([\n            transaction.get(boardRef),\n            ...group.items.map((item) => transaction.get(item.ref)),\n          ]);\n          const existingItems = group.items.filter((_, index) => itemSnapshots[index]?.exists);\n          if (!existingItems.length) return;\n          existingItems.forEach((item) => transaction.delete(item.ref));\n          if (!boardSnapshot.exists) return;\n          const boardData = boardSnapshot.data() || {};\n          const removedPostIds = new Set(existingItems.map((item) => String(item.data()?.postId || item.id || '').trim()).filter(Boolean));\n          const currentCoverPostIds = Array.isArray(boardData.coverPostIds) ? boardData.coverPostIds : [];\n          const currentCoverImageUrls = Array.isArray(boardData.coverImageUrls) ? boardData.coverImageUrls : [];\n          const nextCoverPostIds = [];\n          const nextCoverImageUrls = [];\n          currentCoverPostIds.forEach((postId, index) => {\n            if (removedPostIds.has(String(postId || '').trim())) return;\n            nextCoverPostIds.push(postId);\n            if (currentCoverImageUrls[index]) nextCoverImageUrls.push(currentCoverImageUrls[index]);\n          });\n          const numericPostCount = Number(boardData.postCount);\n          const boardPatch = {\n            updatedAt: new Date(),\n            coverPostIds: nextCoverPostIds,\n            coverImageUrls: nextCoverImageUrls,\n          };\n          if (Number.isFinite(numericPostCount)) {\n            boardPatch.postCount = Math.max(0, numericPostCount - existingItems.length);\n          }\n          transaction.set(boardRef, boardPatch, { merge: true });\n        });\n      }\n    }\n    for (const post of actorPosts) {\n      await deleteRef(post.ref, 'posts', { recursive: true });\n    }\n    for (const profile of actorManagedProfiles) {\n      await deleteRef(profile.ref, 'managedProfiles', { recursive: true });\n    }`,
    'reconcile affiliations moodboards and managed profiles',
  );
  return source;
});

await patchFile('functions/supportChat.js', (source) => {
  source = replaceOnce(
    source,
    `import cors from "cors";\n\nimport { initializeApp, getApps } from "firebase-admin/app";`,
    `import cors from "cors";\nimport { randomUUID } from "node:crypto";\n\nimport { initializeApp, getApps } from "firebase-admin/app";`,
    'support lifecycle token import',
  );
  source = replaceOnce(
    source,
    `import { isKnownCodexDevActorUid } from "./codexDevActorRegistry.js";`,
    `import {\n  acquireCodexDevLifecycleFence,\n  isKnownCodexDevActorUid,\n  releaseCodexDevLifecycleFence,\n} from "./codexDevActorRegistry.js";`,
    'support lifecycle helpers import',
  );
  source = replaceOnce(
    source,
    `      if (await isKnownCodexDevActorUid({ db, uid })) {\n        return res.status(403).json({ error: 'Codex Dev support traffic is isolated.' });\n      }\n\n      const threadId = \`support_\${uid}\`;`,
    `      if (await isKnownCodexDevActorUid({ db, uid })) {\n        return res.status(403).json({ error: 'Codex Dev support traffic is isolated.' });\n      }\n\n      const lifecycleToken = randomUUID();\n      await acquireCodexDevLifecycleFence({\n        db, uid, token: lifecycleToken, operation: 'ensureSupportThread',\n      });\n      try {\n      const threadId = \`support_\${uid}\`;`,
    'support lifecycle fence acquisition',
  );
  source = replaceOnce(
    source,
    `      return res.status(200).json({ ok: true, threadId });\n    } catch (e) {`,
    `      return res.status(200).json({ ok: true, threadId });\n      } finally {\n        try {\n          await releaseCodexDevLifecycleFence({ db, uid, token: lifecycleToken });\n        } catch (releaseError) {\n          logger.error("ensureSupportThread lifecycle fence release failed", releaseError);\n        }\n      }\n    } catch (e) {`,
    'support lifecycle fence release',
  );
  return source;
});

await patchFile('tests/codexDevLegacyCleanup.test.mjs', (source) => {
  source = replaceOnce(
    source,
    `  'users/real': { onboardingComplete: true, contributorId: 'real-claimed-test-contributor' },`,
    `  'users/real': { onboardingComplete: true, contributorId: 'real-claimed-test-contributor', linkedAgencyId: 'marked-test', linkedAgencyName: 'Codex Agency', linkedAgencyLink: 'https://codex.test/agency', linkedAgencyStatus: 'approved', linkedAgencyApprovedBy: 'marked-test', linkedCompanyId: 'test-agency', linkedCompanyName: 'Codex Company', linkedCompanyLink: 'https://codex.test/company', linkedCompanyStatus: 'pending' },`,
    'legacy private affiliation seed',
  );
  source = replaceOnce(
    source,
    `  'publicUsers/real': { displayName: 'Real', fansCount: 3, fanOfCount: 4 },`,
    `  'publicUsers/real': { displayName: 'Real', fansCount: 3, fanOfCount: 4, linkedAgencyId: 'marked-test', linkedAgencyName: 'Codex Agency', linkedAgencyLink: 'https://codex.test/agency', linkedAgencyStatus: 'approved', linkedCompanyId: 'test-agency', linkedCompanyName: 'Codex Company', linkedCompanyLink: 'https://codex.test/company', linkedCompanyStatus: 'pending' },`,
    'legacy public affiliation seed',
  );
  source = replaceOnce(
    source,
    `  'posts/real-post': { authorId: 'real' },`,
    `  'posts/real-post': { authorId: 'real' },\n  'users/real/moodboards/inspo': { ownerUid: 'real', postCount: 2, coverPostIds: ['test-post', 'real-post'], coverImageUrls: ['https://codex.test/post.jpg', 'https://real.test/post.jpg'] },\n  'users/real/moodboards/inspo/items/test-post': { postId: 'test-post', ownerUid: 'real', moodboardId: 'inspo', postSnapshot: { imageUrl: 'https://codex.test/post.jpg', title: 'Codex snapshot', authorId: 'marked-test' } },\n  'users/real/moodboards/inspo/items/real-post': { postId: 'real-post', ownerUid: 'real', moodboardId: 'inspo', postSnapshot: { imageUrl: 'https://real.test/post.jpg', title: 'Real snapshot', authorId: 'real' } },`,
    'legacy moodboard snapshot seed',
  );
  source = replaceOnce(
    source,
    `    collectionGroup: (name) => ({ where: (field, _op, value) => ({ get: async () => ({ docs: [...docs.entries()]\n      .filter(([path, data]) => path.split('/').at(-2) === name && data?.[field] === value)\n      .map(([path, data]) => ({ id: path.split('/').at(-1), ref: refFor(path), data: () => data })) }) }) }),`,
    `    collectionGroup: (name) => ({ where: (field, _op, value) => ({ get: async () => ({ docs: [...docs.entries()]\n      .filter(([path, data]) => {\n        if (path.split('/').at(-2) !== name) return false;\n        const actual = String(field).split('.').reduce((current, key) => current?.[key], data);\n        return actual === value;\n      })\n      .map(([path, data]) => ({ id: path.split('/').at(-1), ref: refFor(path), data: () => data })) }) }) }),`,
    'fake collectionGroup nested field support',
  );
  source = replaceOnce(
    source,
    `assert.equal(dryStats.posts, 2);`,
    `assert.equal(dryStats.posts, 2);\nassert.equal(dryStats.affiliationUsers, 1);\nassert.equal(dryStats.affiliationPublicUsers, 1);\nassert.equal(dryStats.affiliationsCleared, 4);\nassert.equal(dryStats.moodboardItems, 1);\nassert.equal(dryStats.moodboardsRepaired, 1);`,
    'dry dependency cleanup assertions',
  );
  source = replaceOnce(
    source,
    `assert.equal(applyStats.deletes, 40);`,
    `assert.equal(applyStats.deletes, 41);`,
    'delete count includes moodboard snapshot',
  );
  source = replaceOnce(
    source,
    `'posts/test-post/comments/comment', 'posts/real-post/comments/test-engagement'`,
    `'posts/test-post/comments/comment', 'users/real/moodboards/inspo/items/test-post', 'posts/real-post/comments/test-engagement'`,
    'moodboard item removed assertion',
  );
  source = replaceOnce(
    source,
    `assert.equal(applyDocs.get('publicUsers/real').fanOfCount, 3);\nassert.equal(applyDocs.get('publicUsers/other').fanOfCount, 5, 'existing repair marker prevents double decrement');`,
    `assert.equal(applyDocs.get('publicUsers/real').fanOfCount, 3);\nfor (const profilePath of ['users/real', 'publicUsers/real']) {\n  const profile = applyDocs.get(profilePath);\n  assert.equal(profile.linkedAgencyId, null, \`\${profilePath} direct Codex agency affiliation cleared\`);\n  assert.equal(profile.linkedAgencyName, '');\n  assert.equal(profile.linkedAgencyLink, null);\n  assert.equal(profile.linkedAgencyStatus, null);\n  assert.equal(profile.linkedCompanyId, null, \`\${profilePath} Codex-managed company affiliation cleared\`);\n  assert.equal(profile.linkedCompanyName, '');\n  assert.equal(profile.linkedCompanyLink, null);\n  assert.equal(profile.linkedCompanyStatus, null);\n}\nassert.deepEqual(applyDocs.get('users/real/moodboards/inspo').coverPostIds, ['real-post']);\nassert.deepEqual(applyDocs.get('users/real/moodboards/inspo').coverImageUrls, ['https://real.test/post.jpg']);\nassert.equal(applyDocs.get('users/real/moodboards/inspo').postCount, 1);\nassert.equal(applyDocs.get('publicUsers/other').fanOfCount, 5, 'existing repair marker prevents double decrement');`,
    'applied affiliation and moodboard repairs',
  );
  source = replaceOnce(
    source,
    `'posts/real-post/likes/real', 'profiles/real-agency'`,
    `'posts/real-post/likes/real', 'users/real/moodboards/inspo', 'users/real/moodboards/inspo/items/real-post', 'profiles/real-agency'`,
    'preserve ordinary moodboard content',
  );
  return source;
});

await patchFile('tests/finalHolisticIsolation.test.mjs', (source) => {
  source += `\n\ntest('support thread creation is fenced against actor registration', async () => {\n  const { db } = createMemoryDb();\n  await acquireCodexDevLifecycleFence({\n    db, uid: 'support-user', token: 'support-token', operation: 'ensureSupportThread',\n  });\n  await assert.rejects(ensureCodexDevActorRegistered({\n    db, auth: noModeratorAuth, uid: 'support-user',\n  }), (error) => error.code === 'codex-lifecycle-fence-active' && error.retryable === true);\n  await releaseCodexDevLifecycleFence({ db, uid: 'support-user', token: 'support-token' });\n});\n\ntest('ensureSupportThread owns a lifecycle fence for all production writes', async () => {\n  const source = await fs.readFile(new URL('../functions/supportChat.js', import.meta.url), 'utf8');\n  assert.match(source, /acquireCodexDevLifecycleFence\\(\\{[\\s\\S]*?operation: 'ensureSupportThread'/);\n  assert.match(source, /try \\{[\\s\\S]*?threadRef\\.set[\\s\\S]*?indexRef\\.set[\\s\\S]*?finally \\{[\\s\\S]*?releaseCodexDevLifecycleFence/);\n});\n`;
  return source;
});

console.log('Final holistic isolation cleanup applied.');
