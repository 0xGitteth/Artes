import { access, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGeminiClassifier } from '../geminiModerationClassifier.js';
import {
  getManifestGoldenExpectationFailure,
  validateGoldenExpansionManifest,
} from '../moderationGoldenManifestExpectations.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const manifestPath = path.resolve(repoRoot, 'testing/moderation_goldens_v1/golden-expansion-plan.json');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const requireComplete = args.has('--require-complete');
const releaseGateOnly = !args.has('--include-confidence-expansion');
const repeatArg = process.argv.find((value) => value.startsWith('--repeat='));
const repeatCount = Math.max(1, Math.min(5, Number(repeatArg?.split('=')[1] || process.env.GOLDEN_REPEAT || 1) || 1));

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const loadManifest = async () => {
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  const failures = validateGoldenExpansionManifest(parsed);
  if (failures.length) {
    throw new Error(`Golden expansion manifest invalid:\n- ${failures.join('\n- ')}`);
  }
  return parsed;
};

const parseGcsUri = (uri) => {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(String(uri || ''));
  if (!match) throw new Error(`Invalid GCS fixture URI: ${uri}`);
  return { bucketName: match[1], objectName: match[2] };
};

let firebaseAppPromise = null;
const getFirebaseAdminApp = async () => {
  if (!firebaseAppPromise) {
    firebaseAppPromise = (async () => {
      const { getApps, initializeApp } = await import('firebase-admin/app');
      const existing = getApps()[0];
      return existing || initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
    })();
  }
  return firebaseAppPromise;
};

const readGcsFixture = async (gcsUri) => {
  const { bucketName, objectName } = parseGcsUri(gcsUri);
  const { getStorage } = await import('firebase-admin/storage');
  const app = await getFirebaseAdminApp();
  const [buffer] = await getStorage(app).bucket(bucketName).file(objectName).download();
  return buffer;
};

const inferMimeType = (item) => {
  if (item?.mimeType) return item.mimeType;
  const source = item?.file || item?.gcsUri || '';
  if (/\.png$/i.test(source)) return 'image/png';
  if (/\.webp$/i.test(source)) return 'image/webp';
  return 'image/jpeg';
};

const inspectCaseFixture = async (item, { fetchRemote = false } = {}) => {
  if (item.file) {
    const absolutePath = path.resolve(repoRoot, item.file);
    await access(absolutePath);
    const info = await stat(absolutePath);
    const buffer = await readFile(absolutePath);
    return {
      source: 'repo',
      locator: item.file,
      bytes: info.size,
      sha256: sha256(buffer),
      mimeType: inferMimeType(item),
      buffer,
    };
  }

  if (item.gcsUri) {
    if (!fetchRemote) {
      return {
        source: 'gcs',
        locator: item.gcsUri,
        bytes: null,
        sha256: null,
        mimeType: inferMimeType(item),
        buffer: null,
      };
    }
    const buffer = await readGcsFixture(item.gcsUri);
    return {
      source: 'gcs',
      locator: item.gcsUri,
      bytes: buffer.length,
      sha256: sha256(buffer),
      mimeType: inferMimeType(item),
      buffer,
    };
  }

  throw new Error(`${item.id}: no fixture source configured`);
};

const assertSafeProject = (manifest) => {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const expectedProject = manifest?.rules?.testProject || 'artes-staging';
  if (!project) throw new Error('Set GOOGLE_CLOUD_PROJECT to the non-production staging project.');
  if (project === 'artes-media-app') {
    throw new Error('Refusing to run real-image golden classifier against production project artes-media-app.');
  }
  if (project !== expectedProject) {
    throw new Error(`Refusing to run against ${project}. This golden plan is pinned to ${expectedProject}.`);
  }
};

const summarize = ({ selected, missing, ready }) => ({
  selectedCases: selected.length,
  readyCases: ready.length,
  missingCases: missing.length,
  missingIds: missing.map((item) => item.id),
  releaseGateOnly,
  repeatCount,
});

const main = async () => {
  const manifest = await loadManifest();
  const selected = manifest.cases.filter((item) => (
    !releaseGateOnly || item.tier === 'release_gate'
  ));
  const missing = selected.filter((item) => item.status === 'needs_image');
  const ready = selected.filter((item) => item.status === 'existing' || item.status === 'ready');

  const metadata = [];
  for (const item of ready) {
    const fixture = await inspectCaseFixture(item, { fetchRemote: false });
    metadata.push({
      id: item.id,
      tier: item.tier,
      category: item.category,
      source: fixture.source,
      locator: fixture.locator,
      bytes: fixture.bytes,
      sha256: fixture.sha256,
      mimeType: fixture.mimeType,
      expected: item.expected,
    });
  }

  const summary = summarize({ selected, missing, ready });

  if (dryRun) {
    console.log(JSON.stringify({
      mode: 'expanded-golden-dry-run',
      note: 'Manifest and local fixtures verified. Private GCS fixture objects are not downloaded during dry-run. No external AI call was made.',
      summary,
      readyCases: metadata,
      missingCases: missing.map(({ id, tier, category, imageBrief }) => ({ id, tier, category, imageBrief })),
    }, null, 2));
    if (requireComplete && missing.length) process.exitCode = 1;
    return;
  }

  if (process.env.ENABLE_GEMINI_CLASSIFIER !== 'true') {
    throw new Error('Set ENABLE_GEMINI_CLASSIFIER=true to run the expanded real-image golden classifier.');
  }
  assertSafeProject(manifest);

  if (requireComplete && missing.length) {
    throw new Error(`Expanded golden release gate is incomplete; missing images: ${missing.map((item) => item.id).join(', ')}`);
  }

  const results = [];
  let hadFailure = false;

  for (const item of ready) {
    const fixture = await inspectCaseFixture(item, { fetchRemote: true });
    const attempts = [];

    for (let attempt = 1; attempt <= repeatCount; attempt += 1) {
      try {
        const result = await runGeminiClassifier({ buffer: fixture.buffer, mimeType: fixture.mimeType });
        const expectationFailure = getManifestGoldenExpectationFailure({ item, result });
        if (expectationFailure) hadFailure = true;
        attempts.push({
          attempt,
          passed: !expectationFailure,
          expectationFailure,
          parsed: result?.parsed || null,
          diagnostics: result?.diagnostics || null,
        });
      } catch (error) {
        hadFailure = true;
        attempts.push({
          attempt,
          passed: false,
          error: {
            name: error?.name || 'Error',
            message: error?.message || String(error),
            code: error?.code || null,
          },
        });
      }
    }

    results.push({
      id: item.id,
      tier: item.tier,
      category: item.category,
      source: fixture.source,
      locator: fixture.locator,
      bytes: fixture.bytes,
      sha256: fixture.sha256,
      mimeType: fixture.mimeType,
      expected: item.expected,
      passed: attempts.every((attempt) => attempt.passed),
      attempts,
    });
  }

  const passedCount = results.filter((item) => item.passed).length;
  console.log(JSON.stringify({
    mode: 'expanded-classifier-golden',
    warning: 'This tests Gemini classifier behavior only. It does not exercise SafeSearch, Firestore lifecycle, review persistence, Storage cleanup, or publication E2E.',
    project: process.env.GOOGLE_CLOUD_PROJECT,
    model: process.env.GEMINI_MODEL || manifest?.rules?.model || null,
    summary: {
      ...summary,
      testedCases: results.length,
      passedCases: passedCount,
      failedCases: results.length - passedCount,
    },
    cases: results,
  }, null, 2));

  if (hadFailure) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
