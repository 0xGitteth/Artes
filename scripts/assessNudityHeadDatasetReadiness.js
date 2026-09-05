import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const PLAN_PATH = path.join(REPO_ROOT, 'docs', 'moderation-nudity-head-dataset-gates-v1.json');
const DEFAULT_SEED_PATH = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', 'combined-external-v1', 'seed-v1.json');
const SEED_PATH = path.resolve(process.env.ARTES_NUDITY_HEAD_SEED_PATH || DEFAULT_SEED_PATH);

const plan = JSON.parse(await readFile(PLAN_PATH, 'utf8'));
const seed = JSON.parse(await readFile(SEED_PATH, 'utf8'));
const classes = plan?.scope?.classes || [];
const items = Array.isArray(seed?.items) ? seed.items : [];

if (classes.length !== 7) throw new Error('invalid_nudity_head_plan');
if (items.length === 0) throw new Error('nudity_head_seed_empty');

const countByClass = Object.fromEntries(classes.map((value) => [value, 0]));
const poolsByClass = Object.fromEntries(classes.map((value) => [value, new Set()]));
const sourcePoolCounts = new Map();
let humanConfirmed = 0;

for (const item of items) {
  const nudity = String(item?.detectorLabel?.nudity || '').trim();
  const sourcePoolId = String(item?.sourcePoolId || '').trim();
  if (!classes.includes(nudity)) throw new Error(`unsupported_nudity_value:${nudity || 'missing'}`);
  if (!sourcePoolId) throw new Error(`missing_source_pool:${item?.sourceFileName || item?.fileName || 'unknown'}`);
  if (item?.labelStatus === 'human_confirmed' || item?.labelSource === 'local_human_review') humanConfirmed += 1;
  countByClass[nudity] += 1;
  poolsByClass[nudity].add(sourcePoolId);
  sourcePoolCounts.set(sourcePoolId, (sourcePoolCounts.get(sourcePoolId) || 0) + 1);
}

const sourcePoolsPerClass = Object.fromEntries(classes.map((value) => [value, poolsByClass[value].size]));
const totalSourcePools = sourcePoolCounts.size;
const largestSourcePoolCount = Math.max(...sourcePoolCounts.values());
const largestSourcePoolFraction = items.length ? largestSourcePoolCount / items.length : 1;

const evaluateGate = (gate) => {
  const reasons = [];
  if (items.length < gate.minimumTotalHumanLabeledImages) reasons.push('total_images_below_gate');
  for (const value of classes) {
    if (countByClass[value] < gate.minimumImagesPerClass) reasons.push(`class_images_below_gate:${value}`);
    if (sourcePoolsPerClass[value] < gate.minimumSourcePoolsPerClass) reasons.push(`class_source_pools_below_gate:${value}`);
  }
  if (totalSourcePools < gate.minimumSourcePoolsTotal) reasons.push('total_source_pools_below_gate');
  if (largestSourcePoolFraction > gate.maxSingleSourcePoolFraction) reasons.push('single_source_pool_fraction_too_high');
  return { ready: reasons.length === 0, reasons };
};

const experimental = evaluateGate(plan.experimentalProbeGate);
const preferred = evaluateGate(plan.preferredPilotTrainingGate);
const missingClasses = classes.filter((value) => countByClass[value] === 0);

const classCoverage = Object.fromEntries(classes.map((value) => {
  const images = countByClass[value];
  const sourcePools = sourcePoolsPerClass[value];
  const probeImageFloor = plan.experimentalProbeGate.minimumImagesPerClass;
  const probePoolFloor = plan.experimentalProbeGate.minimumSourcePoolsPerClass;
  const pilotImageFloor = plan.preferredPilotTrainingGate.minimumImagesPerClass;
  const pilotPoolFloor = plan.preferredPilotTrainingGate.minimumSourcePoolsPerClass;
  const pilotTarget = plan.preferredPilotTrainingGate.targetImagesPerClass || pilotImageFloor;
  const probeFloorMet = images >= probeImageFloor && sourcePools >= probePoolFloor;
  const pilotFloorMet = images >= pilotImageFloor && sourcePools >= pilotPoolFloor;
  const pilotTargetMet = images >= pilotTarget && sourcePools >= pilotPoolFloor;
  let status = 'zero_coverage';
  if (images > 0) status = 'observed_only';
  if (probeFloorMet) status = 'probe_floor_met';
  if (pilotFloorMet) status = 'pilot_floor_met';
  if (pilotTargetMet) status = 'pilot_target_met';
  return [value, {
    status,
    images,
    sourcePools,
    probeFloorMet,
    pilotFloorMet,
    pilotTargetMet,
    remainingToProbeImageFloor: Math.max(probeImageFloor - images, 0),
    remainingToProbeSourcePoolFloor: Math.max(probePoolFloor - sourcePools, 0),
    remainingToPilotImageFloor: Math.max(pilotImageFloor - images, 0),
    remainingToPilotSourcePoolFloor: Math.max(pilotPoolFloor - sourcePools, 0),
  }];
}));
const underfilledClasses = classes.filter((value) => !classCoverage[value].probeFloorMet);

const summary = {
  ok: true,
  planVersion: plan.planVersion,
  seedVersion: seed.seedVersion || null,
  itemCount: items.length,
  humanConfirmed,
  sourcePoolCount: totalSourcePools,
  largestSourcePoolFraction: Number(largestSourcePoolFraction.toFixed(4)),
  countByClass,
  sourcePoolsPerClass,
  missingClasses,
  underfilledClasses,
  classCoverage,
  experimentalProbeGate: experimental,
  preferredPilotTrainingGate: preferred,
  trainingPromotionReady: false,
  runtimeEligible: false,
  nextMilestone: experimental.ready ? 'preferred_pilot_training_gate' : 'experimental_probe_gate',
  fullEmbeddingsPrinted: false,
  imageBytesPrinted: false,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
