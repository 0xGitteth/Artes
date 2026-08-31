from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


helper = r'''import {
  collectModerationFingerprintEntries,
  collectModerationScopeKeys,
  normalizeModerationGeneration,
} from './moderationGeneration.js';

export const LEGACY_FRESH_EVALUATION_MIN_GENERATION = 1;

export const resolveLegacyFreshEvaluationOverrideScopeKeys = ({
  override = null,
  upload = null,
  reviewCase = null,
  linkedUploads = [],
} = {}) => collectModerationScopeKeys(collectModerationFingerprintEntries(
  override,
  upload,
  reviewCase,
  linkedUploads,
));

export const planLegacyFreshEvaluationGenerationMigration = ({
  scopeKeys = [],
  currentGenerations = {},
} = {}) => {
  const uniqueScopeKeys = Array.from(new Set(Array.isArray(scopeKeys) ? scopeKeys : [])).sort();
  const writes = [];
  const verified = [];
  uniqueScopeKeys.forEach((scopeKey) => {
    const generation = normalizeModerationGeneration(currentGenerations?.[scopeKey]);
    if (generation >= LEGACY_FRESH_EVALUATION_MIN_GENERATION) {
      verified.push({ scopeKey, generation });
    } else {
      writes.push({
        scopeKey,
        currentGeneration: generation,
        targetGeneration: LEGACY_FRESH_EVALUATION_MIN_GENERATION,
      });
    }
  });
  return { scopeKeys: uniqueScopeKeys, writes, verified };
};

export const getLegacyFreshEvaluationMigrationGate = ({
  scopeKeys = [],
  currentGenerations = {},
} = {}) => {
  const plan = planLegacyFreshEvaluationGenerationMigration({ scopeKeys, currentGenerations });
  return {
    satisfied: plan.writes.length === 0,
    missingScopeKeys: plan.writes.map((item) => item.scopeKey),
    verifiedScopeKeys: plan.verified.map((item) => item.scopeKey),
  };
};
'''
Path('functions/legacyFreshEvaluationMigration.js').write_text(helper, encoding='utf-8')

script = r'''#!/usr/bin/env node
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  getLegacyFreshEvaluationMigrationGate,
  LEGACY_FRESH_EVALUATION_MIN_GENERATION,
  resolveLegacyFreshEvaluationOverrideScopeKeys,
} from '../legacyFreshEvaluationMigration.js';
import {
  getModerationFreshScopeRef,
  readModerationScopeGeneration,
} from '../moderationGenerationStore.js';

const parseServiceAccount = () => {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is geen geldige JSON.');
  }
};

const initAdmin = () => {
  const serviceAccount = parseServiceAccount();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || process.env.FIREBASE_PROJECT_ID;
  initializeApp(serviceAccount
    ? { credential: cert(serviceAccount), projectId: projectId || serviceAccount.project_id }
    : { credential: applicationDefault(), projectId });
};

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const verifyOnly = args.has('--verify');
if (apply && verifyOnly) {
  throw new Error('Gebruik --apply of --verify, niet beide tegelijk.');
}

const normalizeId = (value) => String(value || '').trim();
const unique = (values) => Array.from(new Set(values.map(normalizeId).filter(Boolean)));

const resolveReviewCaseUploadIds = (reviewCase = {}) => unique([
  reviewCase?.uploadId,
  reviewCase?.linkedUploadId,
  ...(Array.isArray(reviewCase?.linkedUploadIds) ? reviewCase.linkedUploadIds : []),
]);

const loadDocData = async (ref) => {
  if (!ref) return null;
  const snap = await ref.get();
  return snap.exists ? (snap.data() || {}) : null;
};

const collectOverrideEvidence = async ({ db, override }) => {
  let upload = null;
  let reviewCase = null;
  const linkedUploads = [];
  const uploadId = normalizeId(override?.uploadId || override?.linkedUploadId);
  const reviewCaseId = normalizeId(override?.reviewCaseId);

  if (uploadId && !uploadId.includes('/')) {
    upload = await loadDocData(db.collection('uploads').doc(uploadId));
  }
  if (reviewCaseId && !reviewCaseId.includes('/')) {
    reviewCase = await loadDocData(db.collection('reviewCases').doc(reviewCaseId));
  }

  for (const linkedUploadId of resolveReviewCaseUploadIds(reviewCase || {}).slice(0, 25)) {
    if (linkedUploadId.includes('/') || linkedUploadId === uploadId) continue;
    const linkedUpload = await loadDocData(db.collection('uploads').doc(linkedUploadId));
    if (linkedUpload) linkedUploads.push(linkedUpload);
  }

  return {
    scopeKeys: resolveLegacyFreshEvaluationOverrideScopeKeys({
      override,
      upload,
      reviewCase,
      linkedUploads,
    }),
    uploadResolved: Boolean(upload),
    reviewCaseResolved: Boolean(reviewCase),
  };
};

const run = async () => {
  initAdmin();
  const db = getFirestore();
  const snapshot = await db.collection('userModeration').get();
  const scopeKeys = new Set();
  const unresolved = [];
  let overrideCount = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() || {};
    const overrides = Array.isArray(data.freshEvaluationOverrides)
      ? data.freshEvaluationOverrides
      : [];
    for (let index = 0; index < overrides.length; index += 1) {
      overrideCount += 1;
      const evidence = await collectOverrideEvidence({ db, override: overrides[index] });
      evidence.scopeKeys.forEach((scopeKey) => scopeKeys.add(scopeKey));
      if (evidence.scopeKeys.length === 0) {
        unresolved.push({
          userId: docSnap.id,
          overrideIndex: index,
          uploadId: normalizeId(overrides[index]?.uploadId) || null,
          reviewCaseId: normalizeId(overrides[index]?.reviewCaseId) || null,
        });
      }
    }
  }

  const currentGenerations = {};
  for (const scopeKey of [...scopeKeys].sort()) {
    const state = await readModerationScopeGeneration({ db, scopeKey });
    currentGenerations[scopeKey] = state.generation;
  }

  const beforeGate = getLegacyFreshEvaluationMigrationGate({
    scopeKeys: [...scopeKeys],
    currentGenerations,
  });

  if (apply) {
    for (const scopeKey of beforeGate.missingScopeKeys) {
      const ref = getModerationFreshScopeRef({ db, scopeKey });
      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);
        const current = snap.exists ? Number(snap.data()?.generation) || 0 : 0;
        if (current >= LEGACY_FRESH_EVALUATION_MIN_GENERATION) return;
        transaction.set(ref, {
          generation: LEGACY_FRESH_EVALUATION_MIN_GENERATION,
          migrationSource: 'legacy_fresh_evaluation_override',
          migrationAppliedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    }
  }

  const verifiedGenerations = {};
  for (const scopeKey of [...scopeKeys].sort()) {
    const state = await readModerationScopeGeneration({ db, scopeKey });
    verifiedGenerations[scopeKey] = state.generation;
  }
  const gate = getLegacyFreshEvaluationMigrationGate({
    scopeKeys: [...scopeKeys],
    currentGenerations: verifiedGenerations,
  });

  const report = {
    mode: apply ? 'apply' : verifyOnly ? 'verify' : 'dry-run',
    userModerationDocsScanned: snapshot.size,
    legacyOverrideCount: overrideCount,
    resolvedScopeCount: scopeKeys.size,
    unresolvedOverrideCount: unresolved.length,
    missingBeforeApply: beforeGate.missingScopeKeys,
    missingAfterRun: gate.missingScopeKeys,
    gateSatisfied: gate.satisfied,
    unresolvedOverrides: unresolved,
    note: 'Legacy overrides are intentionally not cleared by this utility.',
  };
  console.log(JSON.stringify(report, null, 2));

  if (verifyOnly && !gate.satisfied) {
    process.exitCode = 2;
  }
};

run().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
'''
Path('functions/scripts/migrateLegacyFreshEvaluationOverrides.js').write_text(script, encoding='utf-8')

helper_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLegacyFreshEvaluationMigrationGate,
  planLegacyFreshEvaluationGenerationMigration,
  resolveLegacyFreshEvaluationOverrideScopeKeys,
} from '../legacyFreshEvaluationMigration.js';

test('legacy override scope recovery accepts direct and nested fingerprint evidence', () => {
  assert.deepEqual(resolveLegacyFreshEvaluationOverrideScopeKeys({
    override: { fingerprints: { dhash: 'abcd000000000001' } },
  }), ['abcd']);
  assert.deepEqual(resolveLegacyFreshEvaluationOverrideScopeKeys({
    override: { uploadId: 'missing' },
    upload: { fingerprints: { dhashPrefix: 'beef' } },
  }), ['beef']);
});

test('legacy override scope recovery can survive deleted selected uploads through review evidence', () => {
  assert.deepEqual(resolveLegacyFreshEvaluationOverrideScopeKeys({
    override: { uploadId: 'deleted' },
    reviewCase: {
      fingerprints: [
        { dhash: 'cafe000000000001' },
        { dhashPrefix: 'f00d' },
      ],
    },
    linkedUploads: [{ fingerprints: { dhash: 'face000000000001' } }],
  }), ['cafe', 'f00d', 'face']);
});

test('migration only raises represented scopes below generation one', () => {
  assert.deepEqual(planLegacyFreshEvaluationGenerationMigration({
    scopeKeys: ['abcd', 'beef', 'abcd'],
    currentGenerations: { abcd: 0, beef: 3 },
  }), {
    scopeKeys: ['abcd', 'beef'],
    writes: [{ scopeKey: 'abcd', currentGeneration: 0, targetGeneration: 1 }],
    verified: [{ scopeKey: 'beef', generation: 3 }],
  });
});

test('deployment gate fails exactly while a represented scope is still generation zero', () => {
  assert.deepEqual(getLegacyFreshEvaluationMigrationGate({
    scopeKeys: ['abcd', 'beef'],
    currentGenerations: { abcd: 1, beef: 0 },
  }), {
    satisfied: false,
    missingScopeKeys: ['beef'],
    verifiedScopeKeys: ['abcd'],
  });
  assert.equal(getLegacyFreshEvaluationMigrationGate({
    scopeKeys: ['abcd', 'beef'],
    currentGenerations: { abcd: 1, beef: 4 },
  }).satisfied, true);
});
'''
Path('functions/test/legacyFreshEvaluationMigration.test.js').write_text(helper_test, encoding='utf-8')

source_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../functions/scripts/migrateLegacyFreshEvaluationOverrides.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const packageSource = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8');

test('legacy fresh-evaluation migration is an explicit non-destructive deployment gate', () => {
  assert.match(script, /freshEvaluationOverrides/);
  assert.match(script, /LEGACY_FRESH_EVALUATION_MIN_GENERATION/);
  assert.match(script, /readModerationScopeGeneration/);
  assert.match(script, /getModerationFreshScopeRef/);
  assert.match(script, /--apply/);
  assert.match(script, /--verify/);
  assert.match(script, /intentionally not cleared/);
  assert.doesNotMatch(script, /freshEvaluationOverrides:\s*\[\]/);
  assert.doesNotMatch(script, /FieldValue\.delete\(\).*freshEvaluationOverrides/);
});

test('runtime remains independent of legacy per-user override authority', () => {
  assert.doesNotMatch(runtime, /freshEvaluationOverrides/);
  assert.match(packageSource, /moderation:migrate-legacy-overrides/);
  assert.match(packageSource, /moderation:verify-legacy-overrides/);
});
'''
Path('tests/moderationLegacyGenerationMigrationSource.test.mjs').write_text(source_test, encoding='utf-8')

package_path = Path('package.json')
package = package_path.read_text(encoding='utf-8')
package = replace_once(
    package,
    '    "cleanup-upload-history": "node functions/scripts/cleanupUploadFingerprintHistory.js",\n',
    '    "cleanup-upload-history": "node functions/scripts/cleanupUploadFingerprintHistory.js",\n'
    '    "moderation:migrate-legacy-overrides": "node functions/scripts/migrateLegacyFreshEvaluationOverrides.js --apply",\n'
    '    "moderation:verify-legacy-overrides": "node functions/scripts/migrateLegacyFreshEvaluationOverrides.js --verify",\n',
    'root migration scripts',
)
package_path.write_text(package, encoding='utf-8')

doc_path = Path('docs/moderation-state-machine.md')
doc = doc_path.read_text(encoding='utf-8')
marker = "New runtime code must not depend on the newer branch-only boundary/floor arrays having ever reached production.\n"
addition = marker + r'''

Migration utility in this PR:

- `npm run moderation:migrate-legacy-overrides` scans all outstanding legacy overrides, recovers represented fingerprint scopes from the override/upload/review evidence, and raises only missing scope generations to one. It deliberately does **not** clear legacy overrides.
- `npm run moderation:verify-legacy-overrides` is the read-only deployment gate. It fails while any represented valid scope is still below generation one and reports unresolved legacy records separately for inspection.

Run the migration explicitly against the intended environment, then run the verification command before enabling the new runtime in production. The PR validation suite tests the migration logic but never executes this data migration against production.
'''
if doc.count(marker) != 1:
    raise AssertionError('deployment compatibility marker not unique')
doc = doc.replace(marker, addition, 1)
doc_path.write_text(doc, encoding='utf-8')

print('legacy fresh-evaluation generation migration utility added')
