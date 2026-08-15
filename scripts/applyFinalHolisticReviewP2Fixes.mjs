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

await patchFile('functions/codexDevActorRegistry.js', (source) => replaceOnce(
  source,
  `    if (Number(fence.leaseExpiresAtMs || 0) > nowMs && fence.token !== token) {\n      const error = new Error('Another account lifecycle operation is already active.');\n      error.status = 409;\n      throw error;\n    }`,
  `    if (Number(fence.leaseExpiresAtMs || 0) > nowMs && fence.token !== token) {\n      const error = new Error('Another account lifecycle operation is already active.');\n      error.code = 'codex-lifecycle-fence-active';\n      error.operation = String(fence.operation || '');\n      error.status = 409;\n      error.retryable = true;\n      throw error;\n    }`,
  'lifecycle contention metadata',
));

await patchFile('functions/supportChat.js', (source) => {
  source = replaceOnce(
    source,
    `const corsHandler = cors({ origin: true });\n\nasync function detectSupportThreadHasUserMessage`,
    `const corsHandler = cors({ origin: true });\n\nconst SUPPORT_FENCE_RETRY_DELAYS_MS = [25, 50, 100, 200, 400, 800, 1600];\nconst sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));\n\nasync function acquireSupportThreadLifecycleFence({ uid, token }) {\n  for (let attempt = 0; ; attempt += 1) {\n    try {\n      await acquireCodexDevLifecycleFence({\n        db, uid, token, operation: 'ensureSupportThread',\n      });\n      return;\n    } catch (error) {\n      const sameOperationContention = error?.code === 'codex-lifecycle-fence-active'\n        && error?.operation === 'ensureSupportThread';\n      if (!sameOperationContention || attempt >= SUPPORT_FENCE_RETRY_DELAYS_MS.length) throw error;\n      await sleep(SUPPORT_FENCE_RETRY_DELAYS_MS[attempt]);\n    }\n  }\n}\n\nasync function detectSupportThreadHasUserMessage`,
    'support fence retry helper',
  );
  source = replaceOnce(
    source,
    `      const lifecycleToken = randomUUID();\n      await acquireCodexDevLifecycleFence({\n        db, uid, token: lifecycleToken, operation: 'ensureSupportThread',\n      });`,
    `      const lifecycleToken = randomUUID();\n      await acquireSupportThreadLifecycleFence({ uid, token: lifecycleToken });`,
    'support uses idempotent fence acquisition',
  );
  source = replaceOnce(
    source,
    `    } catch (e) {\n      logger.error("ensureSupportThread failed", e);\n      return res.status(401).json({ error: e?.message || "Unauthorized" });\n    }`,
    `    } catch (e) {\n      logger.error("ensureSupportThread failed", e);\n      const status = Number.isInteger(e?.status) ? e.status : 401;\n      return res.status(status).json({ error: e?.message || "Unauthorized" });\n    }`,
    'support preserves meaningful status',
  );
  return source;
});

await patchFile('functions/scripts/reconcileCodexDevIsolation.js', (source) => {
  source = replaceOnce(
    source,
    `const moodboardItemPathParts = (path = '') => {\n  const match = String(path).match(/^users\\/([^/]+)\\/moodboards\\/([^/]+)\\/items\\/([^/]+)$/);\n  return match ? { ownerUid: match[1], moodboardId: match[2], itemId: match[3] } : null;\n};`,
    `const moodboardItemPathParts = (path = '') => {\n  const match = String(path).match(/^users\\/([^/]+)\\/moodboards\\/([^/]+)\\/items\\/([^/]+)$/);\n  return match ? { ownerUid: match[1], moodboardId: match[2], itemId: match[3] } : null;\n};\n\nconst MOODBOARD_REPAIR_TRANSACTION_ITEM_LIMIT = 400;\n\nconst isCodexMoodboardItem = ({ data = {}, itemId = '', actorPostIds, actorAffiliationTargetIds }) => {\n  const postId = String(data?.postId || itemId || '').trim();\n  const snapshotAuthorId = String(data?.postSnapshot?.authorId || '').trim();\n  return actorPostIds.has(postId) || actorAffiliationTargetIds.has(snapshotAuthorId);\n};\n\nconst clearAffiliationsIfStillCodex = async ({ db, ref, actorAffiliationTargetIds }) => db.runTransaction(async (transaction) => {\n  const snapshot = await transaction.get(ref);\n  if (!snapshot.exists) return 0;\n  const { patch, cleared } = buildAffiliationClearPatch(snapshot.data() || {}, actorAffiliationTargetIds);\n  if (!cleared) return 0;\n  transaction.set(ref, { ...patch, updatedAt: new Date() }, { merge: true });\n  return cleared;\n});`,
    'reconciliation safety helpers',
  );

  source = replaceOnce(
    source,
    `    for (const user of users.filter((candidate) => candidate.id !== uid)) {\n      const { patch, cleared } = buildAffiliationClearPatch(user.data() || {}, actorAffiliationTargetIds);\n      if (!cleared) continue;\n      stats.affiliationUsers += 1;\n      stats.affiliationsCleared += cleared;\n      if (apply) await user.ref.set({ ...patch, updatedAt: new Date() }, { merge: true });\n    }\n    for (const publicUser of (await queryDocs(db.collection('publicUsers'))).filter((candidate) => candidate.id !== uid)) {\n      const { patch, cleared } = buildAffiliationClearPatch(publicUser.data() || {}, actorAffiliationTargetIds);\n      if (!cleared) continue;\n      stats.affiliationPublicUsers += 1;\n      stats.affiliationsCleared += cleared;\n      if (apply) await publicUser.ref.set({ ...patch, updatedAt: new Date() }, { merge: true });\n    }`,
    `    for (const user of users.filter((candidate) => candidate.id !== uid)) {\n      const preview = buildAffiliationClearPatch(user.data() || {}, actorAffiliationTargetIds);\n      if (!preview.cleared) continue;\n      const cleared = apply\n        ? await clearAffiliationsIfStillCodex({ db, ref: user.ref, actorAffiliationTargetIds })\n        : preview.cleared;\n      if (!cleared) continue;\n      stats.affiliationUsers += 1;\n      stats.affiliationsCleared += cleared;\n    }\n    for (const publicUser of (await queryDocs(db.collection('publicUsers'))).filter((candidate) => candidate.id !== uid)) {\n      const preview = buildAffiliationClearPatch(publicUser.data() || {}, actorAffiliationTargetIds);\n      if (!preview.cleared) continue;\n      const cleared = apply\n        ? await clearAffiliationsIfStillCodex({ db, ref: publicUser.ref, actorAffiliationTargetIds })\n        : preview.cleared;\n      if (!cleared) continue;\n      stats.affiliationPublicUsers += 1;\n      stats.affiliationsCleared += cleared;\n    }`,
    'transactional affiliation recheck',
  );

  const oldMoodboardBlock = `    stats.moodboardItems += ordinaryMoodboardItems.length;\n    stats.moodboardsRepaired += moodboardsToRepair.size;\n    stats.deletes += ordinaryMoodboardItems.length;\n    if (apply) {\n      for (const group of moodboardsToRepair.values()) {\n        const boardRef = db.collection('users').doc(group.ownerUid).collection('moodboards').doc(group.moodboardId);\n        await db.runTransaction(async (transaction) => {\n          const [boardSnapshot, ...itemSnapshots] = await Promise.all([\n            transaction.get(boardRef),\n            ...group.items.map((item) => transaction.get(item.ref)),\n          ]);\n          const existingItems = group.items.filter((_, index) => itemSnapshots[index]?.exists);\n          if (!existingItems.length) return;\n          existingItems.forEach((item) => transaction.delete(item.ref));\n          if (!boardSnapshot.exists) return;\n          const boardData = boardSnapshot.data() || {};\n          const removedPostIds = new Set(existingItems.map((item) => String(item.data()?.postId || item.id || '').trim()).filter(Boolean));\n          const currentCoverPostIds = Array.isArray(boardData.coverPostIds) ? boardData.coverPostIds : [];\n          const currentCoverImageUrls = Array.isArray(boardData.coverImageUrls) ? boardData.coverImageUrls : [];\n          const nextCoverPostIds = [];\n          const nextCoverImageUrls = [];\n          currentCoverPostIds.forEach((postId, index) => {\n            if (removedPostIds.has(String(postId || '').trim())) return;\n            nextCoverPostIds.push(postId);\n            if (currentCoverImageUrls[index]) nextCoverImageUrls.push(currentCoverImageUrls[index]);\n          });\n          const numericPostCount = Number(boardData.postCount);\n          const boardPatch = {\n            updatedAt: new Date(),\n            coverPostIds: nextCoverPostIds,\n            coverImageUrls: nextCoverImageUrls,\n          };\n          if (Number.isFinite(numericPostCount)) {\n            boardPatch.postCount = Math.max(0, numericPostCount - existingItems.length);\n          }\n          transaction.set(boardRef, boardPatch, { merge: true });\n        });\n      }\n    }`;
  const newMoodboardBlock = `    if (!apply) {\n      stats.moodboardItems += ordinaryMoodboardItems.length;\n      stats.moodboardsRepaired += moodboardsToRepair.size;\n      stats.deletes += ordinaryMoodboardItems.length;\n    } else {\n      for (const group of moodboardsToRepair.values()) {\n        const boardRef = db.collection('users').doc(group.ownerUid).collection('moodboards').doc(group.moodboardId);\n        let groupDeleted = 0;\n        for (let offset = 0; offset < group.items.length; offset += MOODBOARD_REPAIR_TRANSACTION_ITEM_LIMIT) {\n          const chunk = group.items.slice(offset, offset + MOODBOARD_REPAIR_TRANSACTION_ITEM_LIMIT);\n          const deletedInChunk = await db.runTransaction(async (transaction) => {\n            const [boardSnapshot, ...itemSnapshots] = await Promise.all([\n              transaction.get(boardRef),\n              ...chunk.map((item) => transaction.get(item.ref)),\n            ]);\n            const matchingItems = chunk.filter((item, index) => {\n              const snapshot = itemSnapshots[index];\n              return snapshot?.exists && isCodexMoodboardItem({\n                data: snapshot.data() || {},\n                itemId: item.id,\n                actorPostIds,\n                actorAffiliationTargetIds,\n              });\n            });\n            if (!matchingItems.length) return 0;\n            matchingItems.forEach((item) => transaction.delete(item.ref));\n            if (boardSnapshot.exists) {\n              const boardData = boardSnapshot.data() || {};\n              const removedPostIds = new Set(matchingItems.map((item) => {\n                const snapshot = itemSnapshots[chunk.indexOf(item)];\n                return String(snapshot?.data()?.postId || item.id || '').trim();\n              }).filter(Boolean));\n              const currentCoverPostIds = Array.isArray(boardData.coverPostIds) ? boardData.coverPostIds : [];\n              const currentCoverImageUrls = Array.isArray(boardData.coverImageUrls) ? boardData.coverImageUrls : [];\n              const nextCoverPostIds = [];\n              const nextCoverImageUrls = [];\n              currentCoverPostIds.forEach((postId, index) => {\n                if (removedPostIds.has(String(postId || '').trim())) return;\n                nextCoverPostIds.push(postId);\n                nextCoverImageUrls.push(typeof currentCoverImageUrls[index] === 'string' ? currentCoverImageUrls[index] : '');\n              });\n              const numericPostCount = Number(boardData.postCount);\n              const boardPatch = {\n                updatedAt: new Date(),\n                coverPostIds: nextCoverPostIds,\n                coverImageUrls: nextCoverImageUrls,\n              };\n              if (Number.isFinite(numericPostCount)) {\n                boardPatch.postCount = Math.max(0, numericPostCount - matchingItems.length);\n              }\n              transaction.set(boardRef, boardPatch, { merge: true });\n            }\n            return matchingItems.length;\n          });\n          groupDeleted += deletedInChunk;\n        }\n        if (groupDeleted > 0) {\n          stats.moodboardItems += groupDeleted;\n          stats.moodboardsRepaired += 1;\n          stats.deletes += groupDeleted;\n        }\n      }\n    }`;
  source = replaceOnce(source, oldMoodboardBlock, newMoodboardBlock, 'bounded race-safe moodboard repair');
  return source;
});

await patchFile('tests/finalHolisticIsolation.test.mjs', (source) => {
  source += `\n\ntest('lifecycle fence contention exposes operation metadata for safe same-operation retry', async () => {\n  const { db } = createMemoryDb();\n  const nowMs = Date.now();\n  await acquireCodexDevLifecycleFence({\n    db, uid: 'concurrent-support', token: 'first', operation: 'ensureSupportThread', nowMs,\n  });\n  await assert.rejects(acquireCodexDevLifecycleFence({\n    db, uid: 'concurrent-support', token: 'second', operation: 'ensureSupportThread', nowMs: nowMs + 1,\n  }), (error) => error.code === 'codex-lifecycle-fence-active'\n    && error.operation === 'ensureSupportThread'\n    && error.status === 409\n    && error.retryable === true);\n});\n\ntest('support ensure retries only same-operation contention and preserves non-auth error status', async () => {\n  const source = await fs.readFile(new URL('../functions/supportChat.js', import.meta.url), 'utf8');\n  assert.match(source, /sameOperationContention = error\\?\\.code === 'codex-lifecycle-fence-active'[\\s\\S]*?error\\?\\.operation === 'ensureSupportThread'/);\n  assert.match(source, /SUPPORT_FENCE_RETRY_DELAYS_MS\\[attempt\\]/);\n  assert.match(source, /Number\\.isInteger\\(e\\?\\.status\\) \\? e\\.status : 401/);\n});\n\ntest('reconcile uses bounded transactions, fresh destructive rechecks, and position-safe moodboard covers', async () => {\n  const source = await fs.readFile(new URL('../functions/scripts/reconcileCodexDevIsolation.js', import.meta.url), 'utf8');\n  assert.match(source, /MOODBOARD_REPAIR_TRANSACTION_ITEM_LIMIT = 400/);\n  assert.match(source, /clearAffiliationsIfStillCodex[\\s\\S]*?transaction\\.get\\(ref\\)[\\s\\S]*?buildAffiliationClearPatch\\(snapshot\\.data\\(\\)/);\n  assert.match(source, /matchingItems = chunk\\.filter[\\s\\S]*?snapshot\\?\\.exists && isCodexMoodboardItem/);\n  assert.match(source, /nextCoverImageUrls\\.push\\(typeof currentCoverImageUrls\\[index\\] === 'string' \\? currentCoverImageUrls\\[index\\] : ''\\)/);\n});\n`;
  return source;
});

await patchFile('tests/codexDevLegacyCleanup.test.mjs', (source) => {
  source = replaceOnce(
    source,
    `const fakeDb = (docs) => {\n  const refFor = (path) => ({`,
    `const fakeDb = (docs) => {\n  const getField = (data, field) => String(field || '').split('.').reduce((value, part) => value?.[part], data);\n  const refFor = (path) => ({`,
    'legacy fake db nested field helper',
  );
  source = replaceOnce(
    source,
    `      const actual = doc.data()?.[field];\n      return op === 'array-contains' ? Array.isArray(actual) && actual.includes(value) : actual === value;`,
    `      const actual = getField(doc.data(), field);\n      return op === 'array-contains' ? Array.isArray(actual) && actual.includes(value) : actual === value;`,
    'legacy collection nested query',
  );
  source = replaceOnce(
    source,
    `.filter(([path, data]) => path.split('/').at(-2) === name && data?.[field] === value)`,
    `.filter(([path, data]) => path.split('/').at(-2) === name && getField(data, field) === value)`,
    'legacy collectionGroup nested query',
  );
  source = replaceOnce(
    source,
    `    runTransaction: async (callback) => callback({\n      get: async (ref) => ref.get(),\n      delete: (ref) => docs.delete(ref.path),\n      update: (ref, payload) => docs.set(ref.path, { ...(docs.get(ref.path) || {}), ...payload }),\n      set: (ref, payload, options) => docs.set(ref.path, { ...(options?.merge ? (docs.get(ref.path) || {}) : {}), ...payload }),\n    }),`,
    `    runTransaction: async (callback) => {\n      const pending = [];\n      const result = await callback({\n        get: async (ref) => ref.get(),\n        delete: (ref) => pending.push(() => docs.delete(ref.path)),\n        update: (ref, payload) => pending.push(() => docs.set(ref.path, { ...(docs.get(ref.path) || {}), ...payload })),\n        set: (ref, payload, options) => pending.push(() => docs.set(ref.path, { ...(options?.merge ? (docs.get(ref.path) || {}) : {}), ...payload })),\n      });\n      if (pending.length > 500) throw new Error(\`fake Firestore transaction write limit exceeded: \${pending.length}\`);\n      pending.forEach((apply) => apply());\n      return result;\n    },`,
    'legacy transaction write limit',
  );
  source = replaceOnce(
    source,
    `  'publicUsers/other': { displayName: 'Other', fanOfCount: 5 },`,
    `  'publicUsers/other': { displayName: 'Other', fanOfCount: 5 },\n  'users/affiliated-real': { onboardingComplete: true, linkedAgencyId: 'test-agency', linkedAgencyName: 'Legacy Codex agency', linkedAgencyStatus: 'approved' },\n  'publicUsers/affiliated-real': { displayName: 'Affiliated Real', linkedAgencyId: 'test-agency', linkedAgencyName: 'Legacy Codex agency', linkedAgencyStatus: 'approved' },\n  'users/board-owner': { onboardingComplete: true },\n  'users/board-owner/moodboards/legacy-board': { ownerUid: 'board-owner', postCount: 3, coverPostIds: ['ordinary-empty', 'test-post', 'ordinary-image'], coverImageUrls: ['', 'codex.jpg', 'ordinary.jpg'] },\n  'users/board-owner/moodboards/legacy-board/items/test-post': { postId: 'test-post', ownerUid: 'board-owner', postSnapshot: { imageUrl: 'codex.jpg', authorId: 'marked-test' } },\n  'users/board-owner/moodboards/legacy-board/items/stale-codex': { postId: 'already-deleted-codex', ownerUid: 'board-owner', postSnapshot: { imageUrl: 'stale.jpg', authorId: 'marked-test' } },\n  'users/board-owner/moodboards/legacy-board/items/ordinary-image': { postId: 'ordinary-image', ownerUid: 'board-owner', postSnapshot: { imageUrl: 'ordinary.jpg', authorId: 'real' } },`,
    'legacy affiliation and moodboard seed',
  );
  source = replaceOnce(
    source,
    `assert.equal(applyStats.deletes, 40);`,
    `assert.equal(applyStats.deletes, 42);\nassert.equal(applyStats.affiliationUsers, 1);\nassert.equal(applyStats.affiliationPublicUsers, 1);\nassert.equal(applyStats.affiliationsCleared, 2);\nassert.equal(applyStats.moodboardItems, 2);\nassert.equal(applyStats.moodboardsRepaired, 1);`,
    'legacy cleanup counts',
  );
  source = replaceOnce(
    source,
    `assert.equal(applyDocs.get('publicUsers/other').fanOfCount, 5, 'existing repair marker prevents double decrement');`,
    `assert.equal(applyDocs.get('publicUsers/other').fanOfCount, 5, 'existing repair marker prevents double decrement');\nassert.equal(applyDocs.get('users/affiliated-real').linkedAgencyId, null, 'private Codex affiliation cleared');\nassert.equal(applyDocs.get('publicUsers/affiliated-real').linkedAgencyId, null, 'public Codex affiliation cleared');\nassert.equal(applyDocs.has('users/board-owner/moodboards/legacy-board/items/test-post'), false, 'known Codex moodboard item removed');\nassert.equal(applyDocs.has('users/board-owner/moodboards/legacy-board/items/stale-codex'), false, 'snapshot-only stale Codex moodboard item removed');\nassert.equal(applyDocs.has('users/board-owner/moodboards/legacy-board/items/ordinary-image'), true, 'ordinary moodboard item preserved');\nassert.equal(applyDocs.get('users/board-owner/moodboards/legacy-board').postCount, 1);\nassert.deepEqual(applyDocs.get('users/board-owner/moodboards/legacy-board').coverPostIds, ['ordinary-empty', 'ordinary-image']);\nassert.deepEqual(applyDocs.get('users/board-owner/moodboards/legacy-board').coverImageUrls, ['', 'ordinary.jpg'], 'cover image positions remain aligned');`,
    'legacy cleanup assertions',
  );
  source += `\n\nconst largeBoardDocs = seed();\nlargeBoardDocs.set('users/large-owner', { onboardingComplete: true });\nlargeBoardDocs.set('users/large-owner/moodboards/huge', { ownerUid: 'large-owner', postCount: 501, coverPostIds: [], coverImageUrls: [] });\nfor (let index = 0; index < 501; index += 1) {\n  largeBoardDocs.set(\`users/large-owner/moodboards/huge/items/codex-\${index}\`, {\n    postId: \`deleted-codex-\${index}\`,\n    ownerUid: 'large-owner',\n    postSnapshot: { imageUrl: \`https://example.test/\${index}.jpg\`, authorId: 'marked-test' },\n  });\n}\nconst largeBoardStats = await reconcileCodexDevIsolation({\n  db: fakeDb(largeBoardDocs), apply: true, auth: noModeratorAuth, uid: 'marked-test', skipStorage: true, fieldValue: fakeFieldValue,\n});\nassert.equal(largeBoardStats.moodboardItems, 503, 'large board cleanup includes 501 synthetic items plus two seeded legacy items');\nassert.equal(largeBoardDocs.get('users/large-owner/moodboards/huge').postCount, 0);\nassert.equal([...largeBoardDocs.keys()].some((path) => path.startsWith('users/large-owner/moodboards/huge/items/')), false, 'large moodboard cleanup stays below transaction write limit');\n`;
  return source;
});

console.log('Final holistic P2 review fixes applied.');
