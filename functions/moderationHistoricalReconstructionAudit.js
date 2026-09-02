const cleanString = (value) => String(value || '').trim();

const cleanList = (value) => (Array.isArray(value)
  ? value.map(cleanString).filter(Boolean)
  : []);

const firstNonEmpty = (...values) => values.map(cleanString).find(Boolean) || null;

const normalizeTaxonomy = (value = {}) => ({
  themes: cleanList(value?.themes),
  triggers: cleanList(value?.triggers),
});

const hasTaxonomy = (value = {}) => {
  const normalized = normalizeTaxonomy(value);
  return normalized.themes.length > 0 || normalized.triggers.length > 0;
};

const extractSha256 = ({ reviewCase = {}, upload = {} } = {}) => {
  const direct = firstNonEmpty(
    upload?.fingerprints?.sha256,
    reviewCase?.fingerprints?.sha256,
    reviewCase?.reportedFingerprints?.sha256,
  );
  if (direct) return direct;

  const reviewFingerprints = Array.isArray(reviewCase?.fingerprints) ? reviewCase.fingerprints : [];
  for (const fingerprint of reviewFingerprints) {
    const sha = cleanString(fingerprint?.sha256);
    if (sha) return sha;
  }
  return null;
};

const resolveDecision = (reviewCase = {}) => {
  const status = cleanString(reviewCase.status).toLowerCase();
  const policyOutcome = cleanString(reviewCase?.moderatorDecision?.finalPolicyOutcome).toLowerCase();
  if (status === 'approved' || policyOutcome === 'allowed') return 'allowed';
  if (status === 'rejected' || policyOutcome === 'forbidden') return 'forbidden';
  return null;
};

const resolveReasonCode = (reviewCase = {}) => firstNonEmpty(
  reviewCase?.moderatorDecision?.reasonCode,
  reviewCase?.reasonCode,
  reviewCase?.decisionReasonCode,
);

const resolveCorrectedTaxonomy = (reviewCase = {}) => {
  const direct = reviewCase?.moderatorDecision?.correctedTaxonomy;
  if (hasTaxonomy(direct)) return normalizeTaxonomy(direct);
  if (hasTaxonomy(reviewCase?.correctedTaxonomy)) return normalizeTaxonomy(reviewCase.correctedTaxonomy);
  return { themes: [], triggers: [] };
};

const hasAiEvidence = ({ reviewCase = {}, upload = {} } = {}) => Boolean(
  (upload?.aiResult && typeof upload.aiResult === 'object')
  || (upload?.moderationSignals && typeof upload.moderationSignals === 'object')
  || (reviewCase?.aiResult && typeof reviewCase.aiResult === 'object')
  || (reviewCase?.aiSummary && typeof reviewCase.aiSummary === 'object')
  || (reviewCase?.moderationSignals && typeof reviewCase.moderationSignals === 'object'),
);

const inferAction = ({ decision, correctedTaxonomy }) => {
  if (decision === 'forbidden') return 'rejectForbidden';
  if (decision === 'allowed' && hasTaxonomy(correctedTaxonomy)) return 'approveWithTaxonomyCorrection';
  if (decision === 'allowed') return 'approveAsIs';
  return null;
};

export const assessHistoricalModerationReconstruction = ({ reviewCase = {}, upload = {} } = {}) => {
  const decision = resolveDecision(reviewCase);
  const reasonCode = resolveReasonCode(reviewCase);
  const correctedTaxonomy = resolveCorrectedTaxonomy(reviewCase);
  const sha256 = extractSha256({ reviewCase, upload });
  const uploadId = firstNonEmpty(reviewCase.uploadId, ...(Array.isArray(reviewCase.linkedUploadIds) ? reviewCase.linkedUploadIds : []));
  const policyVersion = firstNonEmpty(reviewCase.policyVersion, upload.policyVersion);
  const aiEvidence = hasAiEvidence({ reviewCase, upload });
  const action = inferAction({ decision, correctedTaxonomy });
  const evidenceGaps = [];

  if (!decision) evidenceGaps.push('missing_final_decision');
  if (!uploadId) evidenceGaps.push('missing_upload_link');
  if (!sha256) evidenceGaps.push('missing_sha256');
  if (!reasonCode) evidenceGaps.push('missing_reason_code');
  if (!policyVersion) evidenceGaps.push('missing_policy_version');
  if (!aiEvidence) evidenceGaps.push('missing_ai_evidence');

  let reconstructionTier = 'insufficient';
  if (decision && sha256 && reasonCode) reconstructionTier = 'strong';
  else if (decision && sha256) reconstructionTier = 'partial';
  else if (decision && uploadId) reconstructionTier = 'weak';

  const requiresHumanRelabel = reconstructionTier !== 'strong';

  return {
    reconstructionTier,
    requiresHumanRelabel,
    evidenceGaps,
    inferred: {
      action,
      finalOutcome: decision,
      reasonCode,
      correctedTaxonomy,
      hasSha256: Boolean(sha256),
      hasUploadLink: Boolean(uploadId),
      hasPolicyVersion: Boolean(policyVersion),
      hasAiEvidence: aiEvidence,
    },
  };
};

export const summarizeHistoricalReconstruction = (records = []) => {
  const summary = {
    missingExampleCasesAssessed: 0,
    strongReconstruction: 0,
    partialReconstruction: 0,
    weakReconstruction: 0,
    insufficientReconstruction: 0,
    requiresHumanRelabel: 0,
    evidenceGaps: {},
    inferredActions: {},
    finalOutcomes: {},
    recordsWithReasonCode: 0,
    recordsWithSha256: 0,
    recordsWithCorrectedTaxonomy: 0,
    recordsWithAiEvidence: 0,
  };

  const increment = (target, key) => {
    const normalized = cleanString(key) || 'unknown';
    target[normalized] = (target[normalized] || 0) + 1;
  };

  for (const record of Array.isArray(records) ? records : []) {
    const assessment = assessHistoricalModerationReconstruction(record || {});
    summary.missingExampleCasesAssessed += 1;
    if (assessment.reconstructionTier === 'strong') summary.strongReconstruction += 1;
    else if (assessment.reconstructionTier === 'partial') summary.partialReconstruction += 1;
    else if (assessment.reconstructionTier === 'weak') summary.weakReconstruction += 1;
    else summary.insufficientReconstruction += 1;

    if (assessment.requiresHumanRelabel) summary.requiresHumanRelabel += 1;
    assessment.evidenceGaps.forEach((gap) => increment(summary.evidenceGaps, gap));
    increment(summary.inferredActions, assessment.inferred.action);
    increment(summary.finalOutcomes, assessment.inferred.finalOutcome);
    if (assessment.inferred.reasonCode) summary.recordsWithReasonCode += 1;
    if (assessment.inferred.hasSha256) summary.recordsWithSha256 += 1;
    if (hasTaxonomy(assessment.inferred.correctedTaxonomy)) summary.recordsWithCorrectedTaxonomy += 1;
    if (assessment.inferred.hasAiEvidence) summary.recordsWithAiEvidence += 1;
  }

  return summary;
};
