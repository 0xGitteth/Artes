import fs from 'node:fs/promises';

const replaceOnce = (source, from, to, label) => {
  const first = source.indexOf(from);
  if (first === -1) throw new Error(`Missing anchor for ${label}`);
  if (source.indexOf(from, first + from.length) !== -1) throw new Error(`Anchor for ${label} is not unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
};

{
  const path = 'functions/didit.js';
  let source = await fs.readFile(path, 'utf8');
  source = replaceOnce(
    source,
    "import { CODEX_DEV_ACTOR, hasCodexDevClaim, isCodexDevUid } from './codexDevIdentity.js';\n",
    "import { CODEX_DEV_ACTOR, isCodexDevUid } from './codexDevIdentity.js';\n",
    'Didit identity import',
  );
  source = replaceOnce(
    source,
    `      const claimsToPreserve = shouldClearAdultVerification\n        ? existingClaims\n        : (isCodexDevUid(uid) && hasCodexDevClaim(existingClaims)\n          ? { devCodex: true, devActor: CODEX_DEV_ACTOR }\n          : {});\n`,
    `      const claimsToPreserve = shouldClearAdultVerification\n        ? existingClaims\n        : (isCodexDevUid(uid)\n          ? { devCodex: true, devActor: CODEX_DEV_ACTOR }\n          : {});\n`,
    'restore canonical Codex claims on Didit refresh',
  );
  await fs.writeFile(path, source, 'utf8');
}

{
  const path = 'tests/codexDevIsolation.test.mjs';
  let source = await fs.readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `  assert.match(didit, /isCodexDevUid\\(uid\\) && hasCodexDevClaim\\(existingClaims\\)/);\n  assert.match(didit, /devCodex: true, devActor: CODEX_DEV_ACTOR/);\n`,
    `  assert.match(didit, /isCodexDevUid\\(uid\\)/);\n  assert.doesNotMatch(didit, /hasCodexDevClaim\\(existingClaims\\)/);\n  assert.match(didit, /devCodex: true, devActor: CODEX_DEV_ACTOR/);\n`,
    'Didit claim preservation regression assertion',
  );
  await fs.writeFile(path, source, 'utf8');
}

await fs.rm(new URL(import.meta.url), { force: true });
console.log('✅ Canonical Codex claims are restored on Didit refresh; temporary repair removed.');
