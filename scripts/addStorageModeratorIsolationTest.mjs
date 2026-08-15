import fs from 'node:fs/promises';

const path = 'tests/storage.uploads.rules.test.mjs';
let source = await fs.readFile(path, 'utf8');
const replaceOnce = (before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Non-unique anchor: ${label}`);
  source = `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
};

replaceOnce(
  `  const unauthedStorage = testEnv.unauthenticatedContext().storage();\n  const retiredStorage = testEnv.authenticatedContext(retiredUid, { email_verified: true }).storage();`,
  `  const unauthedStorage = testEnv.unauthenticatedContext().storage();\n  const retiredStorage = testEnv.authenticatedContext(retiredUid, { email_verified: true }).storage();\n  const retiredModeratorStorage = testEnv.authenticatedContext(retiredUid, {\n    email_verified: true, email: moderatorEmail,\n  }).storage();\n  const claimedModeratorStorage = testEnv.authenticatedContext('claimed_codex_uid', {\n    email_verified: true, email: moderatorEmail, devCodex: true, devActor: 'codex',\n  }).storage();`,
  'Codex moderator Storage contexts',
);
replaceOnce(
  `  await assertSucceeds(getBytes(ref(ownerStorage, uploadPath)));\n  await assertSucceeds(getBytes(ref(moderatorStorage, uploadPath)));\n  await assertFails(getBytes(ref(otherStorage, uploadPath)));`,
  `  await assertSucceeds(getBytes(ref(ownerStorage, uploadPath)));\n  await assertSucceeds(getBytes(ref(moderatorStorage, uploadPath)));\n  await assertFails(getBytes(ref(otherStorage, uploadPath)));\n  await assertFails(getBytes(ref(retiredModeratorStorage, uploadPath)));\n  await assertFails(getBytes(ref(claimedModeratorStorage, uploadPath)));`,
  'Codex moderator upload read denial',
);
replaceOnce(
  `  await assertSucceeds(getBytes(ref(moderatorStorage, claimProofPath)));\n  await assertFails(getBytes(ref(otherStorage, claimProofPath)));`,
  `  await assertSucceeds(getBytes(ref(moderatorStorage, claimProofPath)));\n  await assertFails(getBytes(ref(otherStorage, claimProofPath)));\n  await assertFails(getBytes(ref(retiredModeratorStorage, claimProofPath)));\n  await assertFails(getBytes(ref(claimedModeratorStorage, claimProofPath)));`,
  'Codex moderator claim proof read denial',
);

await fs.writeFile(path, source);
console.log('Storage moderator isolation regressions added.');
