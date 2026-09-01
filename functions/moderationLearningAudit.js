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
    exclusionReasons: {},
    moderatorActions: {},
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
    summary.totalExamples += 1;
    if (assessment.candidate) summary.candidateExamples += 1;
    else summary.excludedExamples += 1;

    assessment.reasons.forEach((reason) => increment(summary.exclusionReasons, reason));
    increment(summary.moderatorActions, assessment.sourceEvidence.action);
    increment(summary.finalOutcomes, assessment.sourceEvidence.finalOutcome);
    increment(summary.mismatchTypes, assessment.sourceEvidence.mismatchType);
    increment(summary.policyVersions, assessment.sourceEvidence.policyVersion);
  }

  summary.candidateRate = summary.totalExamples > 0
    ? Number((summary.candidateExamples / summary.totalExamples).toFixed(4))
    : 0;

  return summary;
};
