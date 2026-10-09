// Local NSFWJS MobileNet V2 comparison; no remote image API, no app integration.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MODEL_ID = 'nsfwjs/MobileNetV2 (GantMan model family)';
const REV = 'nsfwjs@4.1.0/MobileNetV2';
const LABELS = ['normal', 'porn', 'hentai', 'drawing', 'sexy'];
const mapping = { Neutral: 'normal', Porn: 'porn', Hentai: 'hentai', Drawing: 'drawing', Sexy: 'sexy' };

function assertScore(scores) {
  if (Object.keys(scores).sort().join('|') !== [...LABELS].sort().join('|')) {
    throw new Error('unexpected_nsfwjs_classes');
  }
  if (LABELS.some(k => typeof scores[k] !== 'number' || !Number.isFinite(scores[k])
       || scores[k] < 0 || scores[k] > 1)
       || Math.abs(LABELS.reduce((sum, k) => sum + scores[k], 0) - 1) > .005) {
    throw new Error('invalid_nsfwjs_probabilities');
  }
  return scores;
}

const args = process.argv.slice(2);
if (args.length !== 2) {
  process.stderr.write('Usage: node score_gantman_nsfw.mjs <private-manifest> <private-score-cache>\n');
  process.exit(2);
}
const [manifestPath, cachePath] = args.map(item => path.resolve(item));
const manifest = fs.readFileSync(manifestPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const existing = new Set();
if (fs.existsSync(cachePath)) {
  for (const line of fs.readFileSync(cachePath, 'utf8').split('\n').filter(Boolean)) {
    const item = JSON.parse(line);
    if (item.modelRevision !== REV || typeof item.sha256 !== 'string' || existing.has(item.sha256)) {
      throw new Error('invalid_existing_gantman_cache');
    }
    assertScore(item.scores);
    existing.add(item.sha256);
  }
}
const ids = new Set();
for (const row of manifest) {
  if (!/^[a-f0-9]{64}$/.test(row.sha256) || ids.has(row.sha256) || !path.isAbsolute(row.imagePath)) {
    throw new Error('invalid_private_manifest');
  }
  ids.add(row.sha256);
}
if ([...existing].some(id => !ids.has(id))) throw new Error('cache_contains_unknown_image');

const pending = manifest.filter(item => !existing.has(item.sha256));
if (!pending.length) {
  process.stdout.write('GantMan family: all predictions already cached.\n');
  process.exit(0);
}
const tf = require('@tensorflow/tfjs');
const nsfwjs = require('nsfwjs');
const sharp = require('sharp');
await tf.setBackend('cpu');
await tf.ready();
const model = await nsfwjs.load('MobileNetV2');
process.stdout.write('NSFWJS MobileNet V2 initialized locally (CPU, no paid API).\n');

let failures = 0;
let index = 0;
for (const item of pending) {
  index += 1;
  let tensor;
  try {
    const start = process.hrtime.bigint();
    const startCpu = process.cpuUsage();
    const { data, info } = await sharp(item.imagePath, { limitInputPixels: 40000000 })
      .rotate().resize(224, 224, { fit: 'fill' }).removeAlpha()
      .toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error('unexpected_channels');
    tensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
    const predictions = await model.classify(tensor, 5);
    const scores = {};
    for (const prediction of predictions) {
      const key = mapping[prediction.className];
      if (!key || Object.hasOwn(scores, key)) throw new Error('unknown_or_duplicate_prediction');
      scores[key] = Number(prediction.probability);
    }
    assertScore(scores);
    const cpu = process.cpuUsage(startCpu);
    const result = {
      sha256: item.sha256, modelId: MODEL_ID, modelRevision: REV,
      scores,
      wallSeconds: Number(process.hrtime.bigint() - start) / 1e9,
      cpuSeconds: (cpu.user + cpu.system) / 1e6,
    };
    fs.appendFileSync(cachePath, JSON.stringify(result) + '\n', { encoding: 'utf8' });
  } catch {
    failures += 1;
    // Do not expose sensitive image paths or model prediction data in logs.
  } finally {
    tensor?.dispose();
  }
  if (index % 25 === 0 || index === pending.length) {
    process.stdout.write('GantMan-family attempted: ' + index + '/' + pending.length + '; errors ' + failures + '\n');
  }
}
model.dispose?.();
if (failures) {
  process.stderr.write('GantMan-family errors: ' + failures + '; rerun safely to retry.\n');
  process.exitCode = 1;
}
