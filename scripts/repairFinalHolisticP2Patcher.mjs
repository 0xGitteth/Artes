import fs from 'node:fs/promises';

const path = 'scripts/applyFinalHolisticReviewP2Fixes.mjs';
let source = await fs.readFile(path, 'utf8');
const startMarker = "await patchFile('tests/codexDevLegacyCleanup.test.mjs', (source) => {";
const endMarker = "console.log('Final holistic P2 review fixes applied.');";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);
if (start < 0 || end < 0 || end <= start) throw new Error('Could not locate legacy cleanup patch block');

const correctedTail = `await patchFile('tests/codexDevLegacyCleanup.test.mjs', (source) => {
  source = replaceOnce(
    source,
    \`    runTransaction: async (callback) => callback({\\n      get: async (ref) => ref.get(),\\n      delete: (ref) => docs.delete(ref.path),\\n      update: (ref, payload) => docs.set(ref.path, { ...(docs.get(ref.path) || {}), ...payload }),\\n      set: (ref, payload, options) => docs.set(ref.path, { ...(options?.merge ? (docs.get(ref.path) || {}) : {}), ...payload }),\\n    }),\`,
    \`    runTransaction: async (callback) => {\\n      const pending = [];\\n      const result = await callback({\\n        get: async (ref) => ref.get(),\\n        delete: (ref) => pending.push(() => docs.delete(ref.path)),\\n        update: (ref, payload) => pending.push(() => docs.set(ref.path, { ...(docs.get(ref.path) || {}), ...payload })),\\n        set: (ref, payload, options) => pending.push(() => docs.set(ref.path, { ...(options?.merge ? (docs.get(ref.path) || {}) : {}), ...payload })),\\n      });\\n      if (pending.length > 500) throw new Error(\\\`fake Firestore transaction write limit exceeded: \\\${pending.length}\\\`);\\n      pending.forEach((apply) => apply());\\n      return result;\\n    },\`,
    'legacy transaction write limit',
  );

  source = replaceOnce(
    source,
    \`  'users/real/moodboards/inspo': { ownerUid: 'real', postCount: 2, coverPostIds: ['test-post', 'real-post'], coverImageUrls: ['https://codex.test/post.jpg', 'https://real.test/post.jpg'] },\\n  'users/real/moodboards/inspo/items/test-post': { postId: 'test-post', ownerUid: 'real', moodboardId: 'inspo', postSnapshot: { imageUrl: 'https://codex.test/post.jpg', title: 'Codex snapshot', authorId: 'marked-test' } },\\n  'users/real/moodboards/inspo/items/real-post': { postId: 'real-post', ownerUid: 'real', moodboardId: 'inspo', postSnapshot: { imageUrl: 'https://real.test/post.jpg', title: 'Real snapshot', authorId: 'real' } },\`,
    \`  'users/real/moodboards/inspo': { ownerUid: 'real', postCount: 4, coverPostIds: ['real-empty', 'test-post', 'real-post'], coverImageUrls: ['', 'https://codex.test/post.jpg', 'https://real.test/post.jpg'] },\\n  'users/real/moodboards/inspo/items/real-empty': { postId: 'real-empty', ownerUid: 'real', moodboardId: 'inspo', postSnapshot: { imageUrl: '', title: 'No cover', authorId: 'real' } },\\n  'users/real/moodboards/inspo/items/test-post': { postId: 'test-post', ownerUid: 'real', moodboardId: 'inspo', postSnapshot: { imageUrl: 'https://codex.test/post.jpg', title: 'Codex snapshot', authorId: 'marked-test' } },\\n  'users/real/moodboards/inspo/items/stale-codex': { postId: 'already-deleted-codex', ownerUid: 'real', moodboardId: 'inspo', postSnapshot: { imageUrl: 'https://codex.test/stale.jpg', title: 'Stale Codex snapshot', authorId: 'marked-test' } },\\n  'users/real/moodboards/inspo/items/real-post': { postId: 'real-post', ownerUid: 'real', moodboardId: 'inspo', postSnapshot: { imageUrl: 'https://real.test/post.jpg', title: 'Real snapshot', authorId: 'real' } },\`,
    'legacy moodboard race and cover fixtures',
  );

  source = replaceOnce(source, 'assert.equal(dryStats.moodboardItems, 1);', 'assert.equal(dryStats.moodboardItems, 2);', 'dry moodboard count');
  source = replaceOnce(source, 'assert.equal(applyStats.deletes, 41);', 'assert.equal(applyStats.deletes, 42);', 'apply delete count');
  source = replaceOnce(
    source,
    \`'users/real/moodboards/inspo/items/test-post', 'posts/real-post/comments/test-engagement'\`,
    \`'users/real/moodboards/inspo/items/test-post', 'users/real/moodboards/inspo/items/stale-codex', 'posts/real-post/comments/test-engagement'\`,
    'stale moodboard removed list',
  );
  source = replaceOnce(
    source,
    \`assert.deepEqual(applyDocs.get('users/real/moodboards/inspo').coverPostIds, ['real-post']);\\nassert.deepEqual(applyDocs.get('users/real/moodboards/inspo').coverImageUrls, ['https://real.test/post.jpg']);\\nassert.equal(applyDocs.get('users/real/moodboards/inspo').postCount, 1);\`,
    \`assert.deepEqual(applyDocs.get('users/real/moodboards/inspo').coverPostIds, ['real-empty', 'real-post']);\\nassert.deepEqual(applyDocs.get('users/real/moodboards/inspo').coverImageUrls, ['', 'https://real.test/post.jpg'], 'cover image positions remain aligned');\\nassert.equal(applyDocs.get('users/real/moodboards/inspo').postCount, 2);\`,
    'position-safe moodboard assertions',
  );
  source = replaceOnce(
    source,
    \`'users/real/moodboards/inspo', 'users/real/moodboards/inspo/items/real-post', 'profiles/real-agency'\`,
    \`'users/real/moodboards/inspo', 'users/real/moodboards/inspo/items/real-empty', 'users/real/moodboards/inspo/items/real-post', 'profiles/real-agency'\`,
    'ordinary no-cover moodboard item preserved',
  );

  source = replaceOnce(
    source,
    \`const missingUser = new Map([['publicUsers/canonical-missing-user', { displayName: 'legacy' }]]);\`,
    \`const largeBoardDocs = new Map([\\n  ['users/marked-test', { isDevTestUser: true, devActor: 'codex', onboardingComplete: true }],\\n  ['users/large-owner', { onboardingComplete: true }],\\n  ['users/large-owner/moodboards/huge', { ownerUid: 'large-owner', postCount: 501, coverPostIds: [], coverImageUrls: [] }],\\n]);\\nfor (let index = 0; index < 501; index += 1) {\\n  largeBoardDocs.set(\\\`users/large-owner/moodboards/huge/items/codex-\\\${index}\\\`, {\\n    postId: \\\`deleted-codex-\\\${index}\\\`,\\n    ownerUid: 'large-owner',\\n    postSnapshot: { imageUrl: \\\`https://example.test/\\\${index}.jpg\\\`, authorId: 'marked-test' },\\n  });\\n}\\nconst largeBoardStats = await reconcileCodexDevIsolation({\\n  db: fakeDb(largeBoardDocs), apply: true, auth: noModeratorAuth, uid: 'marked-test', skipStorage: true, fieldValue: fakeFieldValue,\\n});\\nassert.equal(largeBoardStats.moodboardItems, 501);\\nassert.equal(largeBoardStats.moodboardsRepaired, 1);\\nassert.equal(largeBoardDocs.get('users/large-owner/moodboards/huge').postCount, 0);\\nassert.equal([...largeBoardDocs.keys()].some((itemPath) => itemPath.startsWith('users/large-owner/moodboards/huge/items/')), false, 'large moodboard cleanup stays below transaction write limit');\\n\\nconst missingUser = new Map([['publicUsers/canonical-missing-user', { displayName: 'legacy' }]]);\`,
    'large moodboard transaction regression',
  );
  return source;
});

`;

source = source.slice(0, start) + correctedTail + source.slice(end);
await fs.writeFile(path, source);
console.log('Repaired P2 fixer for current legacy regression fixtures.');
