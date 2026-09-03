import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createModerationCustomVisionClient } from '../functions/moderationCustomVisionClient.js';

const IMAGE_MIME_BY_EXTENSION = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

const imagePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const endpoint = String(process.env.ARTES_CUSTOM_VISION_URL || 'http://127.0.0.1:8787').trim();
const configuredTimeoutMs = Number.parseInt(process.env.ARTES_CUSTOM_VISION_TIMEOUT_MS || '15000', 10);
const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
  ? configuredTimeoutMs
  : 15000;

if (!imagePath) {
  console.error('Gebruik: node scripts/testLocalModerationVisionPoc.js <pad-naar-geautoriseerde-testafbeelding>');
  process.exit(2);
}

const mimeType = IMAGE_MIME_BY_EXTENSION.get(path.extname(imagePath).toLowerCase());
if (!mimeType) {
  console.error('Alleen .jpg, .jpeg, .png en .webp worden ondersteund.');
  process.exit(2);
}

try {
  const buffer = await readFile(imagePath);
  const client = createModerationCustomVisionClient({ endpoint, timeoutMs });
  const result = await client.infer({ buffer, mimeType });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    provider: result.provider,
    model: result.model,
    embeddingDimension: result.embedding.length,
    detectorConfigured: Boolean(result.detectorResult),
    nearestExamples: result.nearestExamples.length,
    imageBytesPrinted: false,
  }, null, 2)}\n`);
} catch (error) {
  console.error(`Local moderation vision POC failed: ${error?.message || error}`);
  process.exit(1);
}
