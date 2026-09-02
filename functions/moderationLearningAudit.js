import { assessModerationExampleCandidate } from './moderationLearningDataset.js';

const increment = (target, key) => {
  const normalized = String(key || 'unknown').trim() || 'unknown';
  target[normalized] = (target[normalized] || 0) + 1;
};

export const summarizeModerationLearningCandidates = (examples = []) => {
  const summary = {
    totalExamples: 0,
    candidateExamples: 0,
    excludedExamples: 0,
    candidateRate: 0,
    recordsWithSha256: 0,
    recordsWithPolicyVersion: 0,
    recordsWithReasonCode: 0,
    recordsWithCorrectedTaxonomy: 0,
    recordsWithModeratorNote: 0,
    exclusionReasons: {},
    qualityWarnings: {},
    moderatorActions: {},
    reasonCodes: {},
    finalOutcomes: {},
    mismatchTypes: {},
    policyVersions: {},
  };

  for (const rawExample of Array.isArray(examples) ? examples : []) {
    const example = rawExample?.data && typeof rawExample.data === 'object'
      ? rawExample.data
      : rawExample;
    if (!example || typeof example !== 'object') continue;

    const assessment = assessModerationExampleCandidate(example);
    const reasonCode = String(example?.moderatorDecision?.reasonCode || '').trim();
    const correctedTaxonomy = example?.moderatorDecision?.correctedTaxonomy;
    const correctedThemes = Array.isArray(correctedTaxonomy?.themes) ? correctedTaxonomy.themes.filter(Boolean) : [];
    const correctedTriggers = Array.isArray(correctedTaxonomy?.triggers) ? correctedTaxonomy.triggers.filter(Boolean) : [];
    const moderatorNote = String(example?.moderatorDecision?.notes || '').trim();

    summary.totalExamples += 1;
    if (assessment.candidate) summary.candidateExamples += 1;
    else summary.excludedExamples += 1;

    if (assessment.sourceEvidence.sha256) summary.recordsWithSha256 += 1;
    if (assessment.sourceEvidence.policyVersionKnown) summary.recordsWithPolicyVersion += 1;
    if (reasonCode) summary.recordsWithReasonCode += 1;
    if (correctedThemes.length > 0 || correctedTriggers.length > 0) summary.recordsWithCorrectedTaxonomy += 1;
    if (moderatorNote) summary.recordsWithModeratorNote += 1;

    assessment.reasons.forEach((reason) => increment(summary.exclusionReasons, reason));
    assessment.qualityWarnings.forEach((warning) => increment(summary.qualityWarnings, warning));
    increment(summary.moderatorActions, assessment.sourceEvidence.action);
    increment(summary.reasonCodes, reasonCode);
    increment(summary.finalOutcomes, assessment.sourceEvidence.finalOutcome);
    increment(summary.mismatchTypes, assessment.sourceEvidence.mismatchType);
    increment(summary.policyVersions, assessment.sourceEvidence.policyVersion);
  }

  summary.candidateRate = summary.totalExamples > 0
    ? Number((summary.candidateExamples / summary.totalExamples).toFixed(4))
    : 0;

  return summary;
};
