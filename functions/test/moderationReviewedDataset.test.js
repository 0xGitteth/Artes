import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadReviewedDataset, REVIEWED_LABEL_DEFINITION, sha256 } from '../moderationReviewedDataset.js';

const fixture = async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'artes-reviewed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'train'));
  const image = Buffer.from('deterministic integrity-test bytes, not a photo or a model prediction');
  await writeFile(path.join(root, 'train', 'A.jpg'), image);
  const item = {
    candidateId: 'A', sourcePoolId: 'creator-a', proposedSplit: 'train', localPath: 'train/A.jpg',
    sha256: sha256(image), labelStatus: 'human_confirmed', humanLabelConfirmed: true,
    includedInReviewedResearchDataset: true, needsManualReview: false,
    humanReviewConfirmedAt: '2026-10-03T00:00:00Z', humanReviewExportSha256: 'export-sha',
    labelDefinitionVersion: REVIEWED_LABEL_DEFINITION,
    nudity: 'genitalia', sexualContext: 'none', detectorLabel: { nudity: 'genitalia', sexualContext: 'none' },
  };
  const dataset = { schemaVersion: 4, datasetVersion: 'test-fixture', labelDefinitionVersion: REVIEWED_LABEL_DEFINITION, humanLabelsAuthoritative: true, items: [item] };
  const file = path.join(root, 'dataset.json');
  const persist = () => writeFile(file, JSON.stringify(dataset));
  await persist();
  return { root, dataset, item, file, persist };
};

test('reads a confirmed label without changing it or treating training gates as evaluation clearance', async (t) => {
  const { file, item } = await fixture(t);
  const loaded = await loadReviewedDataset(file);
  assert.equal(loaded.selected[0].humanReviewConfirmedAt, item.humanReviewConfirmedAt);
  assert.deepEqual(loaded.selected[0].detectorLabel, item.detectorLabel);
  assert.equal(loaded.preflight.evaluationApproved, 0);
  assert.equal(loaded.preflight.humanLabelsChanged, false);
});

test('explicit human exclusions are kept out of the measured set', async (t) => {
  const { dataset, file, persist } = await fixture(t);
  dataset.items.push({ candidateId: 'B', labelStatus: 'human_excluded', includedInReviewedResearchDataset: false });
  await persist();
  const loaded = await loadReviewedDataset(file);
  assert.equal(loaded.preflight.excludedImages, 1);
  assert.equal(loaded.selected.length, 1);
});

test('rejects overwritten image bytes', async (t) => {
  const { root, file } = await fixture(t);
  await writeFile(path.join(root, 'train/A.jpg'), 'changed bytes');
  await assert.rejects(loadReviewedDataset(file), /image_hash_mismatch/);
});

test('rejects stale confirmations and conflicting labels', async (t) => {
  const { file, item, persist } = await fixture(t);
  item.humanLabelConfirmed = false;
  await persist();
  await assert.rejects(loadReviewedDataset(file), /unconfirmed_human_label/);
  item.humanLabelConfirmed = true;
  item.nudity = 'none';
  await persist();
  await assert.rejects(loadReviewedDataset(file), /conflicting_human_labels/);
});

test('rejects source pool overlap across training and test', async (t) => {
  const { dataset, item, root, file, persist } = await fixture(t);
  const secondBytes = Buffer.from('second distinct image integrity fixture');
  await writeFile(path.join(root, 'train/B.jpg'), secondBytes);
  dataset.items.push({ ...item, candidateId: 'B', proposedSplit: 'test', localPath: 'train/B.jpg', sha256: sha256(secondBytes) });
  await persist();
  await assert.rejects(loadReviewedDataset(file), /source_pool_split_leakage/);
});

test('requires evaluation clearance to match both the manifest and the exact image', async (t) => {
  const { root, file, item } = await fixture(t);
  const loaded = await loadReviewedDataset(file);
  const clearancePath = path.join(root, 'clearance.json');
  const clearance = { datasetSha256: loaded.datasetSha256, items: [{ candidateId: 'A', sha256: item.sha256, approvedForClassifierEvaluation: true, evidence: 'unit-test evidence only' }] };
  await writeFile(clearancePath, JSON.stringify(clearance));
  assert.equal((await loadReviewedDataset(file, { clearancePath })).preflight.evaluationApproved, 1);
  clearance.items[0].sha256 = 'another-image';
  await writeFile(clearancePath, JSON.stringify(clearance));
  assert.equal((await loadReviewedDataset(file, { clearancePath })).preflight.evaluationApproved, 0);
  clearance.datasetSha256 = 'stale-manifest';
  await writeFile(clearancePath, JSON.stringify(clearance));
  await assert.rejects(loadReviewedDataset(file, { clearancePath }), /evaluation_clearance_dataset_mismatch/);
});

test('runner rejects production and unapproved research images before loading the external SDK', async (t) => {
  const { file } = await fixture(t);
  const script = new URL('../scripts/runReviewedModerationBenchmark.js', import.meta.url);
  const run = (project) => spawnSync(process.execPath, [script.pathname, '--dataset', file, '--run'], {
    encoding: 'utf8', env: { ...process.env, GOOGLE_CLOUD_PROJECT: project, ENABLE_GEMINI_CLASSIFIER: 'true' },
  });
  const production = run('artes-media-app');
  assert.equal(production.status, 1);
  assert.match(production.stderr, /must never run against production/);
  const staging = run('artes-staging');
  assert.equal(staging.status, 1);
  assert.match(staging.stderr, /Evaluation use has not been cleared/);
  assert.doesNotMatch(staging.stderr, /@google-cloud/);
});

test('default CLI mode is local only and does not consume the held-out test set', async (t) => {
  const { file } = await fixture(t);
  const script = new URL('../scripts/runReviewedModerationBenchmark.js', import.meta.url);
  const preflight = spawnSync(process.execPath, [script.pathname, '--dataset', file], { encoding: 'utf8' });
  assert.equal(preflight.status, 0);
  assert.equal(JSON.parse(preflight.stdout).preflight.split, 'train');
  const heldOut = spawnSync(process.execPath, [script.pathname, '--dataset', file, '--split', 'test', '--run'], { encoding: 'utf8' });
  assert.equal(heldOut.status, 1);
  assert.match(heldOut.stderr, /requires --split test --final-test/);
});
