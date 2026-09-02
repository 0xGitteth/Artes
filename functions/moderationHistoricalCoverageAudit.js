const cleanString = (value) => String(value || '').trim();

const increment = (target, key) => {
  const normalized = cleanString(key) || 'unknown';
  target[normalized] = (target[normalized] || 0) + 1;
};

const unwrap = (record) => {
  if (record?.data && typeof record.data === 'object') {
    return { id: cleanString(record.id), data: record.data };
  }
  return { id: '', data: record && typeof record === 'object' ? record : {} };
};

export const isUploadLikeReviewCase = (data = {}) => {
  const caseType = cleanString(data.caseType).toLowerCase();
  if (caseType === 'upload') return true;
  if (caseType && caseType !== 'upload') return false;
  if (cleanString(data.uploadId)) return true;
  return Array.isArray(data.linkedUploadIds) && data.linkedUploadIds.some((value) => cleanString(value));
};

export const isDecidedReviewCase = (data = {}) => {
  const status = cleanString(data.status).toLowerCase();
  if (status === 'approved' || status === 'rejected') return true;
  if (data.decidedAt) return true;
  const finalPolicyOutcome = cleanString(data?.moderatorDecision?.finalPolicyOutcome).toLowerCase();
  return finalPolicyOutcome === 'allowed' || finalPolicyOutcome === 'forbidden';
};

const buildExampleLinkage = (moderationExamples = []) => {
  const exampleReviewCaseIds = new Set();
  const exampleDocIds = [];

  for (const rawExample of Array.isArray(moderationExamples) ? moderationExamples : []) {
    const { id, data } = unwrap(rawExample);
    const linkedReviewCaseId = cleanString(data.reviewCaseId);
    if (linkedReviewCaseId) exampleReviewCaseIds.add(linkedReviewCaseId);
    if (id) exampleDocIds.push(id);
  }

  return { exampleReviewCaseIds, exampleDocIds };
};

const hasModerationExampleForReviewCase = (reviewCaseId, linkage) => {
  const id = cleanString(reviewCaseId);
  if (!id) return false;
  if (linkage.exampleReviewCaseIds.has(id)) return true;
  return linkage.exampleDocIds.some((exampleId) => exampleId.startsWith(`${id}_`));
};

export const findDecidedUploadReviewCasesWithoutExamples = ({ reviewCases = [], moderationExamples = [] } = {}) => {
  const linkage = buildExampleLinkage(moderationExamples);
  const missing = [];

  for (const rawReviewCase of Array.isArray(reviewCases) ? reviewCases : []) {
    const { id, data } = unwrap(rawReviewCase);
    if (!isUploadLikeReviewCase(data) || !isDecidedReviewCase(data)) continue;
    if (hasModerationExampleForReviewCase(id, linkage)) continue;
    missing.push({ id, data });
  }

  return missing;
};

export const summarizeHistoricalModerationCoverage = ({ reviewCases = [], moderationExamples = [] } = {}) => {
  const linkage = buildExampleLinkage(moderationExamples);

  const summary = {
    totalReviewCases: 0,
    uploadLikeReviewCases: 0,
    nonUploadReviewCases: 0,
    decidedUploadReviewCases: 0,
    undecidedUploadReviewCases: 0,
    decidedUploadWithModerationExample: 0,
    decidedUploadWithoutModerationExample: 0,
    decidedUploadExampleCoverageRate: 0,
    reviewCaseStatuses: {},
    decidedUploadStatuses: {},
    moderationExamplesProvided: Array.isArray(moderationExamples) ? moderationExamples.length : 0,
  };

  for (const rawReviewCase of Array.isArray(reviewCases) ? reviewCases : []) {
    const { id, data } = unwrap(rawReviewCase);
    summary.totalReviewCases += 1;
    increment(summary.reviewCaseStatuses, data.status);

    const uploadLike = isUploadLikeReviewCase(data);
    if (!uploadLike) {
      summary.nonUploadReviewCases += 1;
      continue;
    }

    summary.uploadLikeReviewCases += 1;
    const decided = isDecidedReviewCase(data);
    if (!decided) {
      summary.undecidedUploadReviewCases += 1;
      continue;
    }

    summary.decidedUploadReviewCases += 1;
    increment(summary.decidedUploadStatuses, data.status);

    if (hasModerationExampleForReviewCase(id, linkage)) summary.decidedUploadWithModerationExample += 1;
    else summary.decidedUploadWithoutModerationExample += 1;
  }

  summary.decidedUploadExampleCoverageRate = summary.decidedUploadReviewCases > 0
    ? Number((summary.decidedUploadWithModerationExample / summary.decidedUploadReviewCases).toFixed(4))
    : 0;

  return summary;
};
