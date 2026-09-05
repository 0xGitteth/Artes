import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeArtesDetectorLabel } from '../functions/moderationLearningDataset.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DATASET_SUBDIR = 'web-research-v1';
const LABELS_PATH = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', DATASET_SUBDIR, 'labels.reviewed.json');
const PREFILL_PATH = path.join(REPO_ROOT, 'docs', 'moderation-web-research-assistant-prefill-v1.json');
const OVERRIDES_PATH = path.join(REPO_ROOT, 'docs', 'moderation-web-research-assistant-prefill-overrides-v1.json');

const [labels, prefill, overrides] = await Promise.all([
  readFile(LABELS_PATH, 'utf8').then(JSON.parse),
  readFile(PREFILL_PATH, 'utf8').then(JSON.parse),
  readFile(OVERRIDES_PATH, 'utf8').then(JSON.parse),
]);

if (labels?.reviewStatus !== 'complete') throw new Error(`web_research_review_not_complete:${labels?.reviewStatus || 'missing'}`);
if (!Array.isArray(labels?.items) || !Array.isArray(prefill?.items) || !Array.isArray(overrides?.items)) {
  throw new Error('invalid_web_research_correction_analysis_inputs');
}

const originalByUrl = new Map(prefill.items.map((item) => [item.sourceUrl, item]));
const overrideByUrl = new Map(overrides.items.map((item) => [item.sourceUrl, item]));

const normalizeEligibility = (item) => item?.researchEligibilityDecision || 'include_real_photograph';
const normalizeAge = (item) => normalizeEligibility(item) === 'exclude_non_photographic_or_synthetic'
  ? null
  : item?.ageSafetyDecision ?? null;
const normalizeLabel = (item) => {
  if (normalizeEligibility(item) === 'exclude_non_photographic_or_synthetic') return null;
  const label = item?.detectorLabel;
  return label ? normalizeArtesDetectorLabel(label) : null;
};
const stableSignals = (value) => [...(value || [])].sort();
const stableFlags = (value) => [...(value || [])].sort();

const policyShape = (label) => label ? {
  nudity: label.nudity,
  sexualContext: label.sexualContext,
  graphicInjury: label.graphicInjury,
  sensitiveSignals: stableSignals(label.sensitiveSignals),
  possibleMinorConcern: label.possibleMinorConcern,
} : null;

const metadataShape = (label) => label ? {
  confidence: label.confidence,
  uncertaintyFlags: stableFlags(label.uncertaintyFlags),
} : null;

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const effectiveSuggestion = (original) => {
  const override = overrideByUrl.get(original.sourceUrl);
  return override ? { ...original, ...override } : { ...original };
};

const compare = (suggestion, reviewed) => {
  const suggestionEligibility = normalizeEligibility(suggestion);
  const reviewedEligibility = normalizeEligibility(reviewed);
  const suggestionAge = normalizeAge(suggestion);
  const reviewedAge = normalizeAge(reviewed);
  const suggestionLabel = normalizeLabel(suggestion);
  const reviewedLabel = normalizeLabel(reviewed);

  const eligibilityChanged = suggestionEligibility !== reviewedEligibility;
  const ageSafetyChanged = suggestionAge !== reviewedAge;
  const detectorPolicyChanged = !equal(policyShape(suggestionLabel), policyShape(reviewedLabel));
  const detectorMetadataChanged = !equal(metadataShape(suggestionLabel), metadataShape(reviewedLabel));

  const changes = {};
  if (eligibilityChanged) changes.researchEligibility = [suggestionEligibility, reviewedEligibility];
  if (ageSafetyChanged) changes.ageSafety = [suggestionAge, reviewedAge];

  if (detectorPolicyChanged) {
    const before = policyShape(suggestionLabel);
    const after = policyShape(reviewedLabel);
    changes.detectorPolicy = {};
    for (const key of ['nudity', 'sexualContext', 'graphicInjury', 'sensitiveSignals', 'possibleMinorConcern']) {
      if (!equal(before?.[key] ?? null, after?.[key] ?? null)) {
        changes.detectorPolicy[key] = [before?.[key] ?? null, after?.[key] ?? null];
      }
    }
  }

  if (detectorMetadataChanged) {
    const before = metadataShape(suggestionLabel);
    const after = metadataShape(reviewedLabel);
    changes.detectorMetadata = {};
    for (const key of ['confidence', 'uncertaintyFlags']) {
      if (!equal(before?.[key] ?? null, after?.[key] ?? null)) {
        changes.detectorMetadata[key] = [before?.[key] ?? null, after?.[key] ?? null];
      }
    }
  }

  return {
    exactMatch: !eligibilityChanged && !ageSafetyChanged && !detectorPolicyChanged && !detectorMetadataChanged,
    policyMatch: !eligibilityChanged && !ageSafetyChanged && !detectorPolicyChanged,
    eligibilityChanged,
    ageSafetyChanged,
    detectorPolicyChanged,
    detectorMetadataChanged,
    changes,
  };
};

const originalCorrections = [];
const currentMismatches = [];
let originalExactMatchCount = 0;
let originalPolicyMatchCount = 0;
let currentExactMatchCount = 0;
let currentPolicyMatchCount = 0;
let eligibilityCorrectionCount = 0;
let ageSafetyCorrectionCount = 0;
let detectorPolicyCorrectionCount = 0;
let detectorMetadataCorrectionCount = 0;
const nudityTransitions = {};
const sexualContextTransitions = {};

for (const reviewed of labels.items) {
  const original = originalByUrl.get(reviewed.sourceUrl);
  if (!original) throw new Error(`missing_original_assistant_prefill:${reviewed.fileName}`);
  const effective = effectiveSuggestion(original);

  const originalComparison = compare(original, reviewed);
  const currentComparison = compare(effective, reviewed);

  if (originalComparison.exactMatch) originalExactMatchCount += 1;
  if (originalComparison.policyMatch) originalPolicyMatchCount += 1;
  if (currentComparison.exactMatch) currentExactMatchCount += 1;
  if (currentComparison.policyMatch) currentPolicyMatchCount += 1;

  if (!originalComparison.exactMatch) {
    originalCorrections.push({
      fileName: reviewed.fileName,
      sourceUrl: reviewed.sourceUrl,
      changes: originalComparison.changes,
    });
  }
  if (!currentComparison.exactMatch) {
    currentMismatches.push({
      fileName: reviewed.fileName,
      sourceUrl: reviewed.sourceUrl,
      changes: currentComparison.changes,
    });
  }

  if (originalComparison.eligibilityChanged) eligibilityCorrectionCount += 1;
  if (originalComparison.ageSafetyChanged) ageSafetyCorrectionCount += 1;
  if (originalComparison.detectorPolicyChanged) detectorPolicyCorrectionCount += 1;
  if (originalComparison.detectorMetadataChanged) detectorMetadataCorrectionCount += 1;

  const originalLabel = normalizeLabel(original);
  const reviewedLabel = normalizeLabel(reviewed);
  const originalNudity = originalLabel?.nudity ?? 'no_label';
  const reviewedNudity = reviewedLabel?.nudity ?? 'no_label';
  if (originalNudity !== reviewedNudity) {
    const key = `${originalNudity} -> ${reviewedNudity}`;
    nudityTransitions[key] = (nudityTransitions[key] || 0) + 1;
  }
  const originalSexual = originalLabel?.sexualContext ?? 'no_label';
  const reviewedSexual = reviewedLabel?.sexualContext ?? 'no_label';
  if (originalSexual !== reviewedSexual) {
    const key = `${originalSexual} -> ${reviewedSexual}`;
    sexualContextTransitions[key] = (sexualContextTransitions[key] || 0) + 1;
  }
}

const total = labels.items.length;
const result = {
  ok: true,
  datasetSubdir: DATASET_SUBDIR,
  reviewedCount: total,
  originalAssistant: {
    exactMatchCount: originalExactMatchCount,
    exactMatchRate: Number((originalExactMatchCount / total).toFixed(3)),
    policyMatchCount: originalPolicyMatchCount,
    policyMatchRate: Number((originalPolicyMatchCount / total).toFixed(3)),
    correctedCount: originalCorrections.length,
    eligibilityCorrectionCount,
    ageSafetyCorrectionCount,
    detectorPolicyCorrectionCount,
    detectorMetadataCorrectionCount,
  },
  currentAssistantAfterOverrides: {
    exactMatchCount: currentExactMatchCount,
    exactMatchRate: Number((currentExactMatchCount / total).toFixed(3)),
    policyMatchCount: currentPolicyMatchCount,
    policyMatchRate: Number((currentPolicyMatchCount / total).toFixed(3)),
    remainingMismatchCount: currentMismatches.length,
  },
  nudityTransitions,
  sexualContextTransitions,
  originalCorrections,
  currentMismatches,
  interpretation: 'human_review_is_authoritative; comparison_is_for_offline_labeling_process_improvement_only',
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  runtimeEligible: false,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
