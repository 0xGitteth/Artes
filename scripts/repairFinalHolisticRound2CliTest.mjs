import fs from 'node:fs/promises';

const path = 'tests/codexDevIsolation.test.mjs';
const source = await fs.readFile(path, 'utf8');
const before = `test('reconciliation CLI accepts explicit identity/storage configuration', () => {\n  assert.deepEqual(parseArgs(['--apply', '--uid', 'canonical', '--bucket=test.appspot.com']), {\n    apply: true, skipStorage: false, project: null, uid: 'canonical', bucket: 'test.appspot.com',\n  });\n  assert.equal(parseArgs(['--skip-storage']).skipStorage, true);\n});`;
const after = `test('reconciliation CLI accepts explicit identity/storage configuration', () => {\n  assert.deepEqual(parseArgs(['--apply', '--uid', 'canonical', '--bucket=test.appspot.com']), {\n    apply: true, skipStorage: false, project: null, uid: 'canonical', bucket: 'test.appspot.com',\n    legacyManagedProfileIds: [], legacyPostIds: [],\n  });\n  assert.deepEqual(parseArgs([\n    '--apply', '--uid=canonical', '--skip-storage',\n    '--legacy-managed-profile-ids=old-agency,old-company', '--legacy-post-ids', 'old-post-1,old-post-2',\n  ]), {\n    apply: true, skipStorage: true, project: null, uid: 'canonical', bucket: null,\n    legacyManagedProfileIds: ['old-agency', 'old-company'], legacyPostIds: ['old-post-1', 'old-post-2'],\n  });\n});`;
if (!source.includes(before)) throw new Error('CLI test anchor not found');
await fs.writeFile(path, source.replace(before, after));
console.log('patched CLI provenance test');
