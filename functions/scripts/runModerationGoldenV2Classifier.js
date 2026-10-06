import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGoldenClassifierExpectationFailure } from '../moderationGoldenClassifierExpectations.js';
import { evaluateClassifierAvailability, summarizeClassifierEvaluation } from '../moderationClassifierEvaluation.js';
import { assertModerationLearningStagingProject } from '../moderationLearningProjectGuard.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const dryRun = process.argv.includes('--dry-run');
const summaryOnly = process.argv.includes('--summary');
const outputIndex = process.argv.indexOf('--out');
const outputArgument = outputIndex === -1 ? '.tmp/moderation-benchmarks/golden-classifier.json' : process.argv[outputIndex + 1];
if (!outputArgument || outputArgument.startsWith('--')) throw new Error('Pass a file path after --out.');

const cases = [
  {
    id: 'ADULT_BDSM_01',
    file: 'testing/moderation_goldens_v1/images/adult/ADULT_BDSM_01.jpg',
    policyExpectation: 'adult allow: covered BDSM/kink without nudity or an explicit sexual act',
  },
  {
    id: 'BOUDOIR_01',
    file: 'testing/moderation_goldens_v1/images/boudoir/BOUDOIR_01.jpg',
    policyExpectation: 'general allow when intimate parts remain covered and no other adult context is present; provider safety block may fail closed to review',
  },
  {
    id: 'BORDERLINE_01',
    file: 'testing/moderation_goldens_v1/images/borderline/BORDERLINE_01.jpg',
    policyExpectation: 'adult allow when nudity is present without a visible explicit sexual act',
  },
  {
    id: 'EXPLICIT_01',
    file: 'testing/moderation_goldens_v1/images/explicit/EXPLICIT_01.jpg',
    policyExpectation: 'forbidden when a clear explicit sexual act is present; provider safety block is also fail closed',
  },
];

const assertGoldenFiles = async () => {
  const metadata = [];
  for (const item of cases) {
    const absolutePath = path.resolve(repoRoot, item.file);
    await access(absolutePath);
    const info = await stat(absolutePath);
    metadata.push({
      id: item.id,
      file: item.file,
      bytes: info.size,
      policyExpectation: item.policyExpectation,
    });
  }
  return metadata;
};

const main = async () => {
  const metadata = await assertGoldenFiles();

  if (dryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      note: 'Files and current policy expectations verified. No external AI call was made.',
      cases: metadata,
    }, null, 2));
    return;
  }

  if (process.env.ENABLE_GEMINI_CLASSIFIER !== 'true') {
    throw new Error('Set ENABLE_GEMINI_CLASSIFIER=true to run the real-image classifier golden test.');
  }
  assertModerationLearningStagingProject(process.env.GOOGLE_CLOUD_PROJECT);
  const { runGeminiClassifier } = await import('../geminiModerationClassifier.js');

  const results = [];
  let hadFailure = false;

  for (const item of cases) {
    const absolutePath = path.resolve(repoRoot, item.file);
    const buffer = await readFile(absolutePath);
    try {
      const result = await runGeminiClassifier({ buffer, mimeType: 'image/jpeg' });
      const expectationFailure = getGoldenClassifierExpectationFailure({ id: item.id, result });
      const availability = evaluateClassifierAvailability(result);
      if (expectationFailure) hadFailure = true;
      results.push({
        id: item.id,
        file: item.file,
        policyExpectation: item.policyExpectation,
        expectationPassed: !expectationFailure,
        expectationFailure,
        availability,
        correct: availability === 'classified' ? !expectationFailure : null,
        requiresManualReview: availability !== 'classified'
          || result?.parsed?.forbiddenReasons?.some((reason) => reason !== 'sexualExplicit') === true,
        parsed: result?.parsed || null,
        diagnostics: result?.diagnostics || null,
      });
    } catch (error) {
      hadFailure = true;
      results.push({
        id: item.id,
        file: item.file,
        policyExpectation: item.policyExpectation,
        expectationPassed: false,
        availability: 'provider_error',
        correct: null,
        requiresManualReview: true,
        error: {
          name: error?.name || 'Error',
          message: error?.message || String(error),
          code: error?.code || null,
        },
      });
    }
  }

  const report = {
    mode: 'classifier-golden',
    completedAt: new Date().toISOString(),
    warning: 'This calls Gemini only. It does not exercise the full moderateImage endpoint, SafeSearch, Firestore lifecycle, or publication flow.',
    cases: results,
    summary: {
      ...summarizeClassifierEvaluation(results),
      expectationPasses: results.filter((item) => item.expectationPassed === true).length,
      expectationFailures: results.filter((item) => item.expectationPassed === false).length,
      note: 'A safety-block fallback can pass the fail-closed expectation but never counts as a correct classification. Four fixtures do not establish batch accuracy.',
    },
  };
  const outputPath = path.resolve(repoRoot, outputArgument);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporary, outputPath);
  console.log(JSON.stringify(summaryOnly ? { report: outputPath, summary: report.summary } : report, null, 2));

  if (hadFailure) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
