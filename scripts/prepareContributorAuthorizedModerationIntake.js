import crypto from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const IMAGE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-contributor-images');
const AUTH_PATH = path.join(IMAGE_DIR, 'authorization.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-contributor-intake');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'intake.json');
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SOURCE_POOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

const cleanString = (value) => String(value || '').trim();
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const fail = (code, fileName = null) => {
  throw new Error(fileName ? `${code}:${fileName}` : code);
};

const validateAuthorization = (entry, fileName) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('missing_authorization', fileName);
  if (cleanString(entry.fileName) !== fileName) fail('authorization_filename_mismatch', fileName);
  const sourcePoolId = cleanString(entry.sourcePoolId);
  if (!SOURCE_POOL_PATTERN.test(sourcePoolId)) fail('invalid_source_pool_id', fileName);
  if (entry.rightsHolderConfirmed !== true) fail('rights_holder_not_confirmed', fileName);
  if (entry.moderationMlUseAuthorized !== true) fail('moderation_ml_use_not_authorized', fileName);
  const recognizablePeople = cleanString(entry.recognizablePeople);
  if (!['none', 'present'].includes(recognizablePeople)) fail('invalid_recognizable_people', fileName);
  if (recognizablePeople === 'present') {
    if (entry.allRecognizablePeopleAdultsConfirmed !== true) fail('adult_status_not_confirmed', fileName);
    if (entry.modelPersonalityRightsConfirmed !== true) fail('model_personality_rights_not_confirmed', fileName);
  }
  const authorizationScope = cleanString(entry.authorizationScope);
  if (authorizationScope.length < 12) fail('authorization_scope_missing', fileName);
  return {
    fileName,
    sourcePoolId,
    rightsHolderConfirmed: true,
    moderationMlUseAuthorized: true,
    recognizablePeople,
    allRecognizablePeopleAdultsConfirmed: recognizablePeople === 'present' ? true : null,
    modelPersonalityRightsConfirmed: recognizablePeople === 'present' ? true : null,
    authorizationScope,
  };
};

const main = async () => {
  if (!process.argv.includes('--confirm-authorized')) fail('explicit_authorization_confirmation_required');

  const authorization = JSON.parse(await readFile(AUTH_PATH, 'utf8'));
  if (authorization?.schemaVersion !== 1 || !Array.isArray(authorization?.items)) fail('invalid_authorization_manifest');

  const authByFile = new Map();
  for (const entry of authorization.items) {
    const fileName = cleanString(entry?.fileName);
    if (!fileName || path.basename(fileName) !== fileName) fail('invalid_authorization_filename');
    if (authByFile.has(fileName)) fail('duplicate_authorization_entry', fileName);
    authByFile.set(fileName, entry);
  }

  const directoryEntries = await readdir(IMAGE_DIR, { withFileTypes: true });
  const imageNames = directoryEntries
    .filter((entry) => entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  if (imageNames.length === 0) fail('no_contributor_images_found');

  const items = [];
  for (const fileName of imageNames) {
    const authorizationEntry = validateAuthorization(authByFile.get(fileName), fileName);
    const filePath = path.join(IMAGE_DIR, fileName);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_IMAGE_BYTES) fail('invalid_image_size', fileName);
    const bytes = await readFile(filePath);
    if (bytes.length !== fileStat.size || bytes.length > MAX_IMAGE_BYTES) fail('invalid_image_bytes', fileName);
    items.push({
      fileName,
      sha256: sha256(bytes),
      byteLength: bytes.length,
      sourcePoolId: authorizationEntry.sourcePoolId,
      authorization: authorizationEntry,
      detectorLabel: null,
      labelStatus: 'pending_human_review',
      embeddingReady: false,
      semanticClusterId: null,
      semanticClusterApproved: false,
      benchmarkOnly: false,
      trainingReady: false,
    });
  }

  const unusedAuthorizationEntries = [...authByFile.keys()].filter((fileName) => !imageNames.includes(fileName));
  if (unusedAuthorizationEntries.length > 0) fail(`authorization_entries_without_images:${unusedAuthorizationEntries.join(',')}`);

  await mkdir(OUTPUT_DIR, { recursive: true });
  const output = {
    schemaVersion: 1,
    intakeType: 'contributor_authorized_moderation_images',
    itemCount: items.length,
    authorizationConfirmed: true,
    imagesCopied: false,
    networkUsed: false,
    imageBytesIncluded: false,
    detectorLabelsInferred: false,
    sourcePoolRequired: true,
    trainingReady: false,
    items,
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    itemCount: items.length,
    sourcePoolCount: new Set(items.map((item) => item.sourcePoolId)).size,
    output: path.relative(REPO_ROOT, OUTPUT_PATH),
    detectorLabelsReady: 0,
    embeddingsReady: 0,
    imagesCopied: false,
    networkUsed: false,
    imageBytesPrinted: false,
    trainingReady: false,
  }, null, 2)}\n`);
};

main().catch((error) => {
  console.error(`Contributor moderation intake failed: ${error?.message || error}`);
  process.exit(1);
});
