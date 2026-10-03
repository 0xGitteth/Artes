import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Acquisition only. Suggested labels and public visibility never approve training.
const repo = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const outputAt = args.indexOf('--output');
const output = path.resolve(outputAt >= 0 ? args[outputAt + 1] : path.join(repo, '.tmp/moderation-research-discovery/image-expansion-2026-10-03'));
const verifyOnly = args.includes('--verify-only');
const manifest = JSON.parse(await readFile(path.join(repo, 'docs/moderation-image-expansion-2026-10-03.json'), 'utf8'));
if (manifest.trainingReady !== false || manifest.productionEligible !== false || !Array.isArray(manifest.records)) throw new Error('unsafe_acquisition_manifest');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const maxBytes = 12 * 1024 * 1024;
const results = [];
let next = 0;

async function acquire(record) {
  if (!/^images\/[a-z0-9_-]+\.(?:jpg|png|webp|avif|gif)$/i.test(record.localPath)) throw new Error('invalid_local_image_path');
  if (record.trainingReady !== false || record.productionEligible !== false || record.labelStatus !== 'assistant_visual_suggestion') throw new Error('image_not_research_candidate');
  const destination = path.join(output, record.localPath);
  let cached;
  try { cached = await readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (cached) {
    if (sha256(cached) !== record.sha256) throw new Error('existing_image_hash_mismatch_original_preserved');
    return { sha256: record.sha256, localPath: record.localPath, status: 'verified_existing' };
  }
  if (verifyOnly) throw new Error('image_missing');
  const requested = new URL(record.assetUrl);
  if (requested.protocol !== 'https:' || requested.username || requested.password) throw new Error('invalid_public_asset_url');
  const response = await fetch(requested, {
    headers: { 'User-Agent': 'ArtesModerationResearch/1.0' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`image_http_${response.status}`);
  if (new URL(response.url).hostname !== requested.hostname) throw new Error('unexpected_image_redirect');
  const mime = response.headers.get('content-type')?.split(';')[0];
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(mime)) throw new Error('response_not_image');
  if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('image_too_large');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('image_too_large');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (sha256(bytes) !== record.sha256) throw new Error('source_bytes_changed_requires_new_screening');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx' });
  return { sha256: record.sha256, localPath: record.localPath, status: 'fetched_verified' };
}

await mkdir(output, { recursive: true });
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < manifest.records.length) {
    const index = next++;
    const record = manifest.records[index];
    try { results[index] = await acquire(record); }
    catch (error) { results[index] = { sha256: record.sha256, localPath: record.localPath, status: 'failed', error: error.message }; }
  }
}));
const failedCount = results.filter(result => result.status === 'failed').length;
await writeFile(path.join(output, 'acquisition-check.json'), `${JSON.stringify({
  datasetId: manifest.datasetId, verifiedCount: results.length - failedCount, failedCount,
  mode: verifyOnly ? 'verify_only' : 'public_research_fetch',
  trainingReady: false, productionEligible: false, results,
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ verifiedCount: results.length - failedCount, failedCount, output, trainingReady: false })}\n`);
if (failedCount) process.exitCode = 1;
