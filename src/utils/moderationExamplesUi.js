const toArray = (value) => (Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined && item !== '') : []);

const safeString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const normalizeExample = (example = {}) => ({
  exampleId: safeString(example.exampleId),
  createdAt: example.createdAt || null,
  finalOutcome: safeString(example.finalOutcome),
  learningStatus: safeString(example.learningStatus),
  fingerprintMatchType: safeString(example.fingerprintMatchType),
  moderatorDecision: {
    action: safeString(example.moderatorDecision?.action),
    reasonCode: safeString(example.moderatorDecision?.reasonCode),
  },
  aiSnapshot: {
    outcome: safeString(example.aiSnapshot?.outcome),
    classification: safeString(example.aiSnapshot?.classification),
    shouldReview: typeof example.aiSnapshot?.shouldReview === 'boolean' ? example.aiSnapshot.shouldReview : null,
    appliedTriggers: toArray(example.aiSnapshot?.appliedTriggers),
    suggestedTriggers: toArray(example.aiSnapshot?.suggestedTriggers),
    forbiddenReasons: toArray(example.aiSnapshot?.forbiddenReasons),
    requiredThemes: toArray(example.aiSnapshot?.requiredThemes),
  },
  analytics: {
    mismatchType: safeString(example.analytics?.mismatchType),
  },
});

export const normalizeModerationExamplesResponse = (payload = {}) => {
  const examples = Array.isArray(payload?.examples) ? payload.examples : [];
  return examples.slice(0, 5).map(normalizeExample);
};

export const hasModerationExampleDisplayValue = (example = {}) => Boolean(
  example.finalOutcome
  || example.learningStatus
  || example.fingerprintMatchType
  || example.moderatorDecision?.action
  || example.moderatorDecision?.reasonCode
  || example.aiSnapshot?.outcome
  || example.aiSnapshot?.classification
  || example.aiSnapshot?.shouldReview !== null
  || example.aiSnapshot?.appliedTriggers?.length
  || example.aiSnapshot?.suggestedTriggers?.length
  || example.aiSnapshot?.forbiddenReasons?.length
  || example.aiSnapshot?.requiredThemes?.length
  || example.analytics?.mismatchType
  || example.createdAt
);
