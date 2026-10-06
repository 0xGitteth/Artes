import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_GEMINI_MODERATION_MODEL, GEMINI_MODERATION_PROMPT_VERSION,
} from '../geminiModerationContract.js';
import { assertModerationLearningStagingProject } from '../moderationLearningProjectGuard.js';
import { loadReviewedDataset } from '../moderationReviewedDataset.js';
import { evaluateReviewedClassifierResult, summarizeClassifierEvaluation } from '../moderationClassifierEvaluation.js';

const args = process.argv.slice(2);
const value = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`missing_value:${flag}`);
  return args[index + 1];
};
const save = async (file, report) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporary, file);
};
const groupSummaries = (cases, key) => Object.fromEntries(
  [...new Set(cases.map((item) => item.humanLabel[key]))].sort()
    .map((group) => [group, summarizeClassifierEvaluation(cases.filter((item) => item.humanLabel[key] === group))]),
);

const main = async () => {
  const datasetPath = value('--dataset');
  if (!datasetPath) throw new Error('Pass --dataset /path/to/dataset.json. Default mode checks locally without AI calls.');
  const split = value('--split', 'train');
  const run = args.includes('--run');
  if (run && split === 'test' && !args.includes('--final-test')) {
    throw new Error('Use train for development. A held-out run requires --split test --final-test after freezing the model and selection.');
  }
  const loaded = await loadReviewedDataset(datasetPath, { split, clearancePath: value('--clearance') });
  if (!run) {
    const report = { mode: 'reviewed-dataset-preflight', datasetSha256: loaded.datasetSha256, preflight: loaded.preflight };
    const out = value('--out');
    if (out) await save(path.resolve(out), report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  assertModerationLearningStagingProject(process.env.GOOGLE_CLOUD_PROJECT);
  if (process.env.ENABLE_GEMINI_CLASSIFIER !== 'true') throw new Error('Set ENABLE_GEMINI_CLASSIFIER=true.');
  if (!loaded.selected.length || loaded.preflight.evaluationPending) {
    throw new Error(`Evaluation use has not been cleared for ${loaded.preflight.evaluationPending} selected images. Labels remain confirmed; no AI call was made.`);
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODERATION_MODEL;
  const output = path.resolve(value('--out', `.tmp/moderation-benchmarks/reviewed-${split}.json`));
  const report = {
    mode: 'reviewed-classifier-benchmark', datasetSha256: loaded.datasetSha256,
    datasetVersion: loaded.datasetVersion, labelDefinitionVersion: loaded.labelDefinitionVersion,
    split, model, promptVersion: GEMINI_MODERATION_PROMPT_VERSION,
    scope: 'Gemini classifier and pure policy projection; seven human nudity strata, not seven predicted subclasses; no endpoint/publication test or training.',
    startedAt: new Date().toISOString(), completedAt: null,
    preflight: loaded.preflight, cases: [],
  };
  try {
    const previous = JSON.parse(await readFile(output, 'utf8'));
    if (!args.includes('--resume')) throw new Error('Report exists. Use --resume for the same run or a new --out path.');
    if (previous.mode !== report.mode || previous.datasetSha256 !== report.datasetSha256
      || previous.split !== split || previous.model !== model || previous.promptVersion !== report.promptVersion
      || !Array.isArray(previous.cases)) throw new Error('Cannot resume a different dataset, model, prompt or split.');
    const selectedById = new Map(loaded.selected.map((item) => [item.candidateId, item]));
    const seen = new Set();
    for (const item of previous.cases) {
      const source = selectedById.get(item.candidateId);
      if (!source || source.sha256 !== item.sha256 || seen.has(item.candidateId)
        || source.nudity !== item.humanLabel?.nudity || source.sexualContext !== item.humanLabel?.sexualContext) {
        throw new Error('Invalid checkpoint image or human label.');
      }
      seen.add(item.candidateId);
    }
    report.startedAt = previous.startedAt;
    report.cases = previous.cases;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const { runGeminiClassifier } = await import('../geminiModerationClassifier.js');
  const done = new Set(report.cases.map((item) => item.candidateId));
  for (const item of loaded.selected) {
    if (done.has(item.candidateId)) continue;
    let result;
    const buffer = await readFile(item.absolutePath);
    try {
      result = await runGeminiClassifier({ buffer, mimeType: item.mediaType || 'image/jpeg' });
    } catch (error) {
      result = { error: { name: error.name, code: error.code || null, message: error.message }, parsed: null, diagnostics: null };
    }
    report.cases.push({
      candidateId: item.candidateId, sha256: item.sha256, sourcePoolId: item.sourcePoolId,
      humanLabel: item.detectorLabel,
      ...evaluateReviewedClassifierResult({ label: item.detectorLabel, result }),
      parsed: result.parsed || null, diagnostics: result.diagnostics || null, error: result.error || null,
    });
    report.summary = summarizeClassifierEvaluation(report.cases);
    await save(output, report);
    console.error(`${report.cases.length}/${loaded.selected.length}: ${item.candidateId} ${report.cases.at(-1).availability}`);
  }
  report.completedAt = new Date().toISOString();
  report.summary = summarizeClassifierEvaluation(report.cases);
  report.byHumanNudity = groupSummaries(report.cases, 'nudity');
  report.byHumanSexualContext = groupSummaries(report.cases, 'sexualContext');
  await save(output, report);
  console.log(JSON.stringify({ report: output, split, summary: report.summary, byHumanNudity: report.byHumanNudity }, null, 2));
};

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
