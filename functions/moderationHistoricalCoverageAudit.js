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

const isUploadLikeReviewCase = (data = {}) => {
  const caseType = cleanString(data.caseType).toLowerCase();
  if (caseType === 'upload') return true;
  if (caseType && caseType !== 'upload') return false;
  if (cleanString(data.uploadId)) return true;
  return Array.isArray(data.linkedUploadIds) && data.linkedUploadIds.some((value) => cleanString(value));
};

const isDecidedReviewCase = (data = {}) => {
  const status = cleanString(data.status).toLowerCase();
  if (status === 'approved' || status === 'rejected') return true;
  if (data.decidedAt) return true;
  const finalPolicyOutcome = cleanString(data?.moderatorDecision?.finalPolicyOutcome).toLowerCase();
  return finalPolicyOutcome === 'allowed' || finalPolicyOutcome === 'forbidden';
};

export const summarizeHistoricalModerationCoverage = ({ reviewCases = [], moderationExamples = [] } = {}) => {
  const exampleReviewCaseIds = new Set();
  const exampleDocIds = [];

  for (const rawExample of Array.isArray(moderationExamples) ? moderationExamples : []) {
    const { id, data } = unwrap(rawExample);
    const linkedReviewCaseId = cleanString(data.reviewCaseId);
    if (linkedReviewCaseId) exampleReviewCaseIds.add(linkedReviewCaseId);
    if (id) exampleDocIds.push(id);
  }

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

    const linkedByField = id && exampleReviewCaseIds.has(id);
    const linkedByLegacyDocId = id && exampleDocIds.some((exampleId) => exampleId.startsWith(`${id}_`));
    if (linkedByField || linkedByLegacyDocId) summary.decidedUploadWithModerationExample += 1;
    else summary.decidedUploadWithoutModerationExample += 1;
  }

  summary.decidedUploadExampleCoverageRate = summary.decidedUploadReviewCases > 0
    ? Number((summary.decidedUploadWithModerationExample / summary.decidedUploadReviewCases).toFixed(4))
    : 0;

  return summary;
};
