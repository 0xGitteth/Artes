import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildAuthorizedLabelTemplate,
  buildAuthorizedTestSetItem,
  normalizeAuthorizedTestImageName,
} from '../functions/moderationAuthorizedTestSet.js';
import { createModerationCustomVisionClient } from '../functions/moderationCustomVisionClient.js';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const sourceDir = path.resolve(process.env.ARTES_AUTHORIZED_TEST_IMAGE_DIR || path.join(repoRoot, '.tmp/moderation-test-images'));
const outputDir = path.resolve(process.env.ARTES_AUTHORIZED_TEST_OUTPUT_DIR || path.join(repoRoot, '.tmp/moderation-test-set'));
const endpoint = String(process.env.ARTES_CUSTOM_VISION_URL || 'http://127.0.0.1:8787').trim();
const confirmed = process.argv.includes('--confirm-authorized');
const MIME_BY_EXT = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

if (!confirmed) {
  console.error('Refusing intake without --confirm-authorized. Use only for images you are allowed to process in this local POC.');
  process.exit(2);
}

const entries = (await readdir(sourceDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && normalizeAuthorizedTestImageName(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

if (entries.length === 0) {
  console.error(`No supported test images found in ${sourceDir}`);
  process.exit(2);
}

const client = createModerationCustomVisionClient({
  endpoint,
  timeoutMs: Number(process.env.ARTES_CUSTOM_VISION_TIMEOUT_MS || 60000),
});

const items = [];
const labelTemplates = [];
for (const fileName of entries) {
  const filePath = path.join(sourceDir, fileName);
  const buffer = await readFile(filePath);
  const mimeType = MIME_BY_EXT.get(path.extname(fileName).toLowerCase());
  const inference = await client.infer({ buffer, mimeType });
  const item = buildAuthorizedTestSetItem({
    fileName,
    buffer,
    embedding: inference.embedding,
    detectorLabel: null,
    authorizedForLocalPoc: true,
  });
  items.push(item);
  labelTemplates.push(buildAuthorizedLabelTemplate({ fileName, sha256: item.sha256 }));
}

await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'intake.json'), JSON.stringify({
  schemaVersion: 1,
  sourceType: 'authorized_local_poc_images',
  imageDirectoryRetainedInPlace: true,
  imagesCopiedByThisScript: false,
  itemCount: items.length,
  items,
}, null, 2));
await writeFile(path.join(outputDir, 'labels.template.json'), JSON.stringify({
  schemaVersion: 1,
  labelStatus: 'pending_human_label',
  itemCount: labelTemplates.length,
  items: labelTemplates,
}, null, 2));

process.stdout.write(`${JSON.stringify({
  ok: true,
  sourceDir,
  outputDir,
  itemCount: items.length,
  embeddingDimension: 768,
  labelsReady: 0,
  imagesCopied: false,
  imageBytesPrinted: false,
  outputs: ['intake.json', 'labels.template.json'],
}, null, 2)}\n`);
