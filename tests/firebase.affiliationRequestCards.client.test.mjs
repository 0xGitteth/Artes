import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await fs.readFile('src/firebase.js', 'utf8');
const match = source.match(/const createOrUpdateAffiliationRequestCard = async \([\s\S]*?\n};\n\nexport const updateUserAffiliationStatus/);
assert.ok(match, 'createOrUpdateAffiliationRequestCard helper exists');

const helper = match[0];
assert.ok(
  helper.includes('const threadSnap = await getDoc(threadRef);'),
  'createOrUpdateAffiliationRequestCard reads the thread before checking the message',
);
assert.ok(
  helper.includes('let messageExists = false;'),
  'createOrUpdateAffiliationRequestCard defaults missing-thread requests to a new message',
);
assert.ok(
  /if \(threadSnap\.exists\(\)\) \{\s*const messageSnap = await getDoc\(messageRef\);\s*messageExists = messageSnap\.exists\(\);/.test(helper),
  'createOrUpdateAffiliationRequestCard only reads the message after the parent thread exists',
);
assert.ok(
  !/Promise\.all\(\s*\[\s*getDoc\(threadRef\),\s*getDoc\(messageRef\)/.test(helper),
  'createOrUpdateAffiliationRequestCard does not read thread and message in parallel',
);
assert.ok(
  helper.includes('if (messageExists) {'),
  'createOrUpdateAffiliationRequestCard uses the guarded messageExists flag for duplicate handling',
);

console.log('firebase affiliation request card client tests passed');
