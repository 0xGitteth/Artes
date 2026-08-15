import fs from 'node:fs/promises';

const path = 'tests/codexDevIsolation.test.mjs';
let source = await fs.readFile(path, 'utf8');

const replaceOnce = (from, to, label) => {
  const first = source.indexOf(from);
  if (first === -1) throw new Error(`Missing anchor for ${label}`);
  if (source.indexOf(from, first + from.length) !== -1) throw new Error(`Anchor for ${label} is not unique`);
  source = source.slice(0, first) + to + source.slice(first + from.length);
};

replaceOnce(
  `  await assert.rejects(\n    ensureCodexDevActorRegistered({ db, uid: 'partial-merge', now: 1200 }),\n    (error) => error.code === 'codex-merge-fence-active',\n  );\n`,
  `  await assert.rejects(\n    ensureCodexDevActorRegistered({ db, uid: 'partial-merge', now: 1200 }),\n    (error) => error.code === 'codex-merge-fence-recovery-required' && error.retryable === false,\n  );\n`,
  'partial merge recovery assertion',
);

replaceOnce(
  `  assert.match(didit, /import \\{ CODEX_DEV_ACTOR, hasCodexDevClaim, isCodexDevUid \\} from '\\.\\/codexDevIdentity\\.js';/);\n`,
  `  assert.match(didit, /import \\{ CODEX_DEV_ACTOR, isCodexDevUid \\} from '\\.\\/codexDevIdentity\\.js';/);\n`,
  'Didit identity import assertion',
);

await fs.writeFile(path, source, 'utf8');
await fs.rm(new URL(import.meta.url), { force: true });
console.log('✅ Updated the two stale holistic isolation assertions; temporary repair removed.');
