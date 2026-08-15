import fs from 'node:fs/promises';

const path = 'tests/codexDevIsolation.test.mjs';
const before = await fs.readFile(path, 'utf8');
const oldAssertion = "assert.match(implementation, /ensureCodexDevActorRegistered\\(\\{ db, uid, now \\}\\)/);";
const newAssertion = "assert.match(implementation, /ensureCodexDevActorRegistered\\(\\{ db, uid, now, moderatorEmail \\}\\)/);";
if (!before.includes(oldAssertion)) throw new Error('Missing stale ensureCodexDevActorRegistered assertion');
if (before.indexOf(oldAssertion) !== before.lastIndexOf(oldAssertion)) throw new Error('Non-unique stale assertion');
await fs.writeFile(path, before.replace(oldAssertion, newAssertion));
console.log('Updated stale Codex profile registration assertion.');
