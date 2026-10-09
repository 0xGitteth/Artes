// Controlled, reproducible Gemini-vs-Luke pilot on EXISTING Artes development images.
// --preview makes zero Google API calls; --run requires explicit external-image approval.
// Does not affect the Artes upload or production moderation path.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, '.tmp/moderation-v2/Artes_training_v2/Artes_dataset_v2_volledig');
const WORK = path.join(ROOT, '.tmp/moderation-nsfw-pilot');
const OUT = path.join(WORK, 'gemini-luke-private-scores.jsonl');
const LUKE = path.join(WORK, 'nsfw-luke-private-scores.jsonl');
const VALID_STATUSES = new Set(['ok', 'safety_blocked', 'invalid_response', 'api_error']);
const ALLOWED_MIMES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const POSITIVE = 'explicit_act';
const NUDE = new Set(['implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia']);
const parseOption = (arg, fallback) => {
  const index = process.argv.indexOf(arg);
  if (index < 0) return fallback;
  const n = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(n)) throw new Error('invalid_option_value');
  return n;
};

const preview = !process.argv.includes('--run');
const limit = parseOption('--limit', 82);
const maxNew = parseOption('--max-new', 12);
if (limit < 12 || limit > 120 || maxNew < 1 || maxNew > 120) throw new Error('comparison_limits_exceeded');

function readJsonl(file) {
  return fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    : [];
}

function selectSamples(rows, count) {
  const sorted = [...rows].sort((a, b) => a.sha256.localeCompare(b.sha256));
  const positives = sorted.filter(row => row.sexualContext === POSITIVE);
  const negatives = sorted.filter(row => row.sexualContext !== POSITIVE);
  const nudes = negatives.filter(row => NUDE.has(row.nudity));
  const others = negatives.filter(row => !NUDE.has(row.nudity));
  const posCount = Math.min(positives.length, count < 2 * positives.length ? Math.ceil(count / 2) : positives.length);
  const chosen = positives.slice(0, posCount);
  const remaining = count - chosen.length;
  chosen.push(...nudes.slice(0, Math.ceil(remaining / 2)));
  chosen.push(...others.slice(0, Math.floor(remaining / 2)));
  const seen = new Set(chosen.map(row => row.sha256));
  chosen.push(...sorted.filter(row => !seen.has(row.sha256)).slice(0, count - chosen.length));
  return chosen.sort((a, b) => a.sha256.localeCompare(b.sha256));
}

function readManifest() {
  const rows = [];
  const known = new Set();
  for (const split of ['train', 'validation']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(DATA, split + '.json'), 'utf8'));
    if (!Array.isArray(manifest)) throw new Error('invalid_development_manifest');
    for (const row of manifest) {
      if (!/^[0-9a-f]{64}$/.test(row.sha256 || '') || known.has(row.sha256)) throw new Error('duplicate_or_invalid_development_sha');
      if (typeof row.imagePath !== 'string' || !row.imagePath.startsWith(split + '/images/')) throw new Error('invalid_image_path');
      if (!['none', 'suggestive', 'bdsm_kink', POSITIVE].includes(row.sexualContext)) throw new Error('invalid_human_label');
      const imagePath = path.resolve(DATA, row.imagePath);
      if (path.dirname(imagePath) !== path.resolve(DATA, split, 'images') || !fs.existsSync(imagePath)) throw new Error('invalid_source_image');
      if (!ALLOWED_MIMES[path.extname(imagePath).toLowerCase()]) throw new Error('unsupported_image_format');
      known.add(row.sha256);
      rows.push({ sha256: row.sha256, sexualContext: row.sexualContext, nudity: row.nudity, imagePath });
    }
  }
  return rows;
}

function checkCache(rows, targetModel, promptVersion) {
  const known = new Set(rows.map(r => r.sha256));
  const found = new Map();
  for (const item of readJsonl(OUT)) {
    if (!known.has(item.sha256) || found.has(item.sha256) || !VALID_STATUSES.has(item.status)) throw new Error('invalid_existing_gemini_cache');
    if (item.modelVersion !== targetModel || item.promptVersion !== promptVersion) throw new Error('gemini_model_or_prompt_changed_in_cache');
    if (item.status === 'ok' && !['none', 'borderline', 'explicit'].includes(item.adultDecision)) throw new Error('invalid_cached_gemini_decision');
    found.set(item.sha256, item);
  }
  return found;
}

const rows = readManifest();
if (rows.length !== 375) throw new Error('unexpected_development_set_size');
const lukeRows = readJsonl(LUKE);
if (lukeRows.length !== 375 || new Set(lukeRows.map(r => r.sha256)).size !== 375) {
  throw new Error('luke_375_predictions_missing');
}
const { DEFAULT_GEMINI_MODERATION_MODEL, GEMINI_MODERATION_PROMPT_VERSION } = await import('../geminiModerationContract.js');
const targetModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODERATION_MODEL;
const cached = checkCache(rows, targetModel, GEMINI_MODERATION_PROMPT_VERSION);
const selected = selectSamples(rows, limit);
const outstanding = selected.filter(row => !cached.has(row.sha256));
const counts = {
  explicit: selected.filter(r => r.sexualContext === POSITIVE).length,
  otherNude: selected.filter(r => r.sexualContext !== POSITIVE && NUDE.has(r.nudity)).length,
  otherNonNude: selected.filter(r => r.sexualContext !== POSITIVE && !NUDE.has(r.nudity)).length,
};
process.stdout.write(JSON.stringify({
  mode: preview ? 'preview_no_api_calls' : 'explicitly_requested_external_google_api',
  model: targetModel, promptVersion: GEMINI_MODERATION_PROMPT_VERSION,
  selected: selected.length, cached: selected.length - outstanding.length, remaining: outstanding.length,
  humanSampleGroups: counts,
  warning: 'Existing development images, stratified intentionally; not independent. Gemini usage may be billed.',
}, null, 2) + '\n');

if (preview) {
  const alternatives = fs.readdirSync(WORK).filter(f => /gemini/i.test(f) && f !== path.basename(OUT));
  process.stdout.write('Existing Gemini-named research artifacts (filenames only): ' + JSON.stringify(alternatives.slice(0, 20)) + '\n');
  process.stdout.write('Preview completed. No image processed or uploaded; no API calls.\n');
  process.exit(0);
}
if (!process.argv.includes('--external-google-approved') ||
    process.env.ARTES_GEMINI_COMPARISON_AUTHORIZED !== 'YES') {
  throw new Error('external_google_processing_not_explicitly_approved');
}
if (process.env.GOOGLE_CLOUD_PROJECT !== 'artes-staging') {
  throw new Error('non_production_artes_staging_google_project_required');
}
if (process.env.ENABLE_GEMINI_CLASSIFIER !== 'true') {
  throw new Error('gemini_classifier_must_be_explicitly_enabled');
}
if (!outstanding.length) {
  process.stdout.write('All selected Gemini predictions already cached. No calls needed.\n');
  process.exit(0);
}
const { runGeminiClassifier } = await import('../geminiModerationClassifier.js');
let attempted = 0;
let errorCount = 0;
for (const row of outstanding.slice(0, maxNew)) {
  attempted += 1;
  let record;
  try {
    const buffer = fs.readFileSync(row.imagePath);
    const mimeType = ALLOWED_MIMES[path.extname(row.imagePath).toLowerCase()];
    const inference = await runGeminiClassifier({ buffer, mimeType });
    const good = inference?.diagnostics?.contractValidated === true && inference?.diagnostics?.success === true;
    const status = good ? 'ok' : inference?.diagnostics?.safetyBlocked ? 'safety_blocked' : 'invalid_response';
    record = {
      sha256: row.sha256,
      modelVersion: targetModel,
      promptVersion: GEMINI_MODERATION_PROMPT_VERSION,
      status,
      adultDecision: good ? inference.parsed.adultDecision : null,
      sexualExplicitUncertain: good ? inference.parsed.forbiddenReasons.includes('sexual_explicit_uncertain') : false,
    };
    if (status !== 'ok') errorCount += 1;
  } catch {
    errorCount += 1;
    record = {
      sha256: row.sha256, modelVersion: targetModel, promptVersion: GEMINI_MODERATION_PROMPT_VERSION,
      status: 'api_error', adultDecision: null, sexualExplicitUncertain: false,
    };
  }
  // File is in gitignored .tmp, contains no image bytes, prompts or raw Gemini text.
  fs.appendFileSync(OUT, JSON.stringify(record) + '\n');
  process.stdout.write('Gemini pilot processed ' + attempted + '/' + Math.min(maxNew, outstanding.length) + '; unresolved ' + errorCount + '\n');
  if (errorCount >= 3) {
    process.stdout.write('Stopping after three unavailable/error responses to avoid unnecessary external calls.\n');
    break;
  }
}
process.stdout.write('Scores remain in private .tmp. Run the local aggregate comparison before sending results.\n');
