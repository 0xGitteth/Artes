import { readFile } from 'node:fs/promises';
import { runGeminiClassifier } from '../geminiModerationClassifier.js';

const project = process.env.GOOGLE_CLOUD_PROJECT;
if (project !== 'artes-staging') {
  throw new Error(`Refusing to run against ${project || 'unset project'}; expected artes-staging.`);
}
if (process.env.ENABLE_GEMINI_CLASSIFIER !== 'true') {
  throw new Error('ENABLE_GEMINI_CLASSIFIER must be true.');
}

const cases = [
  { id: 'BOUDOIR_COVERED_02', type: 'boudoir' },
  { id: 'BOUDOIR_COVERED_03', type: 'boudoir' },
  { id: 'EROTIC_CLOTHED_ADULT_01', type: 'erotic' },
  { id: 'EROTIC_CLOTHED_ADULT_02', type: 'erotic' },
  { id: 'EROTIC_CLOTHED_ADULT_03', type: 'erotic' },
  { id: 'EROTIC_CLOTHED_ADULT_04', type: 'erotic' },
  { id: 'SWIMWEAR_GENERAL_02', type: 'general' },
];

let nonPass = 0;
for (const item of cases) {
  const file = `/tmp/artes-user-goldens/${item.id}.jpg`;
  const result = await runGeminiClassifier({ buffer: await readFile(file), mimeType: 'image/jpeg' });
  const notes = [];
  let status = 'PASS';

  if (result?.diagnostics?.safetyBlocked === true) {
    status = 'BLOCKED_REVIEW';
    notes.push(`safetyBlock=${result.diagnostics.safetyBlockReason || 'unknown'}`);
  } else if (!result?.parsed) {
    status = 'FAIL';
    notes.push(`no parsed result (${result?.diagnostics?.fallbackReason || 'unknown'})`);
  } else {
    const parsed = result.parsed;
    const reasons = parsed.forbiddenReasons || [];
    const adultErotic = (parsed.triggers || []).find((trigger) => (
      trigger?.trigger === 'adultEroticSuggestive' && Number(trigger?.confidence) >= 0.7
    ));
    const kink = (parsed.triggers || []).find((trigger) => (
      trigger?.trigger === 'kinkBdsm' && Number(trigger?.confidence) >= 0.7
    ));

    if (parsed.adultDecision !== 'none') {
      status = 'FAIL';
      notes.push(`adultDecision=${parsed.adultDecision}`);
    }
    if (reasons.length > 0) {
      status = 'FAIL';
      notes.push(`forbiddenReasons=${JSON.stringify(reasons)}`);
    }
    if (Number(parsed.sexualExplicitConfidence) >= 0.5) {
      status = 'FAIL';
      notes.push(`sexualExplicitConfidence=${parsed.sexualExplicitConfidence}`);
    }

    if (item.type === 'erotic') {
      if (!adultErotic) {
        status = 'FAIL';
        notes.push('missing adultEroticSuggestive>=0.7');
      }
    } else {
      if (adultErotic) {
        status = 'FAIL';
        notes.push(`unexpected adultEroticSuggestive=${adultErotic.confidence}`);
      }
      if (kink) {
        status = 'FAIL';
        notes.push(`unexpected kinkBdsm=${kink.confidence}`);
      }
    }
  }

  if (status !== 'PASS') nonPass += 1;
  console.log(`${status.padEnd(14)} ${item.id}${notes.length ? ` | ${notes.join('; ')}` : ''}`);
}

console.log(`\nResult: ${cases.length - nonPass}/${cases.length} PASS; ${nonPass} require attention.`);
if (nonPass) process.exitCode = 1;
