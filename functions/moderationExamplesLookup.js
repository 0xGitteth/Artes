const DHASH_PREFIX_LENGTH = 4;
const DHASH_THRESHOLD = Number.parseInt(process.env.DHASH_HAMMING_THRESHOLD || '8', 10);
const hexBitCounts = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

const toArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const pick = (source = {}, keys = []) => keys.reduce((acc, key) => {
  if (source?.[key] !== undefined) acc[key] = source[key];
  return acc;
}, {});

const firstString = (...values) => values.map((value) => String(value || '').trim()).find(Boolean) || null;

const uniqueMatchCount = (matches = []) => new Set(matches.map((match) => match?.id).filter(Boolean)).size;

const getCandidateWindow = (limit) => Math.max(limit * 5, 25);

const flattenFingerprintCandidate = (candidate) => {
  if (!candidate) return [];
  if (Array.isArray(candidate)) return candidate.flatMap(flattenFingerprintCandidate);
  if (typeof candidate !== 'object') return [];
  return [candidate];
};

export const hammingDistance = (a, b) => {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const left = Number.parseInt(a[i], 16);
    const right = Number.parseInt(b[i], 16);
    if (Number.isNaN(left) || Number.isNaN(right)) return Number.POSITIVE_INFINITY;
    distance += hexBitCounts[left ^ right] || 0;
  }
  return distance;
};

export const resolveReviewCaseUploadIds = (reviewCase = null) => [
  reviewCase?.uploadId,
  reviewCase?.linkedUploadId,
  ...(Array.isArray(reviewCase?.linkedUploadIds) ? reviewCase.linkedUploadIds : []),
]
  .map((item) => String(item || '').trim())
  .filter(Boolean);

export const resolveEffectiveUploadId = ({ requestUploadId = null, reviewCase = null } = {}) => firstString(
  requestUploadId,
  ...resolveReviewCaseUploadIds(reviewCase),
);

export const resolveModerationSourceFinalOutcome = ({ reviewCase = null, upload = null } = {}) => firstString(
  reviewCase?.finalOutcome,
  reviewCase?.moderatorDecision?.finalPolicyOutcome,
  reviewCase?.decision,
  reviewCase?.outcome,
  upload?.finalOutcome,
  upload?.outcome,
  upload?.moderatorDecision?.finalPolicyOutcome,
  upload?.decision,
);

export const resolveModerationExampleFingerprints = (...sources) => {
  const resolved = {};
  for (const source of sources) {
    if (!source) continue;
    const candidates = [
      source.fingerprints,
      source.fingerprint,
      source.reportedFingerprints,
      source.imageFingerprint,
      source.moderationFingerprint,
      source.uploadFingerprint,
      source.aiSnapshot?.fingerprints,
      source.moderation?.fingerprints,
      source.reuse?.fingerprints,
      source,
    ];
    for (const candidateGroup of candidates) {
      for (const candidate of flattenFingerprintCandidate(candidateGroup)) {
        if (!resolved.sha256 && candidate.sha256) resolved.sha256 = String(candidate.sha256);
        if (!resolved.dhash && candidate.dhash) resolved.dhash = String(candidate.dhash);
        if (!resolved.dhashPrefix && candidate.dhashPrefix) resolved.dhashPrefix = String(candidate.dhashPrefix);
      }
    }
  }
  if (!resolved.dhashPrefix && resolved.dhash) resolved.dhashPrefix = resolved.dhash.slice(0, DHASH_PREFIX_LENGTH);
  return Object.keys(resolved).length ? resolved : null;
};

export const sanitizeModerationExample = ({ id, data = {}, matchType = 'similar' } = {}) => ({
  exampleId: id || null,
  createdAt: data.createdAt || data.provenance?.createdAt || null,
  finalOutcome: data.finalOutcome || null,
  learningStatus: data.learningStatus || null,
  source: data.source || data.provenance?.sourceEndpoint || null,
  reviewCaseId: data.reviewCaseId || null,
  uploadId: data.uploadId || null,
  fingerprintMatchType: matchType,
  moderatorDecision: {
    action: data.moderatorDecision?.action || null,
    reasonCode: data.moderatorDecision?.reasonCode || null,
  },
  aiSnapshot: {
    outcome: data.aiSnapshot?.outcome || null,
    classification: data.aiSnapshot?.classification || null,
    shouldReview: typeof data.aiSnapshot?.shouldReview === 'boolean' ? data.aiSnapshot.shouldReview : null,
    appliedTriggers: toArray(data.aiSnapshot?.appliedTriggers),
    suggestedTriggers: toArray(data.aiSnapshot?.suggestedTriggers),
    forbiddenReasons: toArray(data.aiSnapshot?.forbiddenReasons),
    requiredThemes: toArray(data.aiSnapshot?.requiredThemes),
  },
  aiSafetySignals: pick(data.aiSafetySignals, [
    'safeSearch',
    'geminiAdultDecision',
    'explicitnessConfidence',
    'nuditySignal',
    'uncertaintyFlags',
  ]),
  policyDecision: pick(data.policyDecision, [
    'outcome',
    'shouldReview',
    'forbiddenReasons',
    'appliedPolicyTriggers',
    'requiredThemes',
    'needsCorrection',
  ]),
  analytics: {
    mismatchType: data.analytics?.mismatchType || null,
  },
});

const matchPriority = { sha256: 0, dhash: 1, dhashPrefix: 2, similar: 3 };

const getCreatedAtMs = (data = {}) => Number(data?.createdAt?.toMillis?.() || Date.parse(data?.createdAt || '') || 0);

const getDistance = (match = {}) => (Number.isFinite(match.distance) ? match.distance : Number.POSITIVE_INFINITY);

const isBetterSamePriorityMatch = (candidate, existing) => {
  if (candidate?.matchType === 'dhashPrefix') {
    const distanceDiff = getDistance(candidate) - getDistance(existing);
    if (distanceDiff !== 0) return distanceDiff < 0;
  }
  const timeDiff = getCreatedAtMs(candidate?.data) - getCreatedAtMs(existing?.data);
  if (timeDiff !== 0) return timeDiff > 0;
  return String(candidate?.id || '').localeCompare(String(existing?.id || '')) < 0;
};

export const rankModerationExampleMatches = (matches = [], limit = 5) => {
  const seen = new Map();
  for (const match of matches) {
    if (!match?.id) continue;
    const existing = seen.get(match.id);
    const candidatePriority = matchPriority[match.matchType] ?? 99;
    const existingPriority = matchPriority[existing?.matchType] ?? 99;
    if (
      !existing
      || candidatePriority < existingPriority
      || (candidatePriority === existingPriority && isBetterSamePriorityMatch(match, existing))
    ) {
      seen.set(match.id, match);
    }
  }
  return [...seen.values()]
    .sort((a, b) => {
      const priorityDiff = (matchPriority[a.matchType] ?? 99) - (matchPriority[b.matchType] ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      if (a.matchType === 'dhashPrefix' && b.matchType === 'dhashPrefix') {
        const distanceDiff = getDistance(a) - getDistance(b);
        if (distanceDiff !== 0) return distanceDiff;
      }
      const timeDiff = getCreatedAtMs(b.data) - getCreatedAtMs(a.data);
      if (timeDiff !== 0) return timeDiff;
      return String(a.id).localeCompare(String(b.id));
    })
    .slice(0, limit);
};

const isSourceModerationExample = (data = {}, sourceIdentifiers = {}) => {
  const sourceReviewCaseId = String(sourceIdentifiers.sourceReviewCaseId || '').trim();
  const sourceUploadId = String(sourceIdentifiers.sourceUploadId || '').trim();
  return Boolean(
    (sourceReviewCaseId && data?.reviewCaseId === sourceReviewCaseId)
    || (sourceUploadId && data?.uploadId === sourceUploadId),
  );
};

const addSnapshotDocs = (matches, snapshot, matchType, fingerprints = null, sourceIdentifiers = {}) => {
  snapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (isSourceModerationExample(data, sourceIdentifiers)) return;
    if (matchType === 'dhashPrefix' && fingerprints?.dhash) {
      const candidateDhash = data?.fingerprints?.dhash;
      const distance = candidateDhash ? hammingDistance(fingerprints.dhash, candidateDhash) : Number.POSITIVE_INFINITY;
      if (distance > DHASH_THRESHOLD) return;
      matches.push({ id: doc.id, data, matchType, distance });
      return;
    }
    matches.push({ id: doc.id, data, matchType });
  });
};

export const fetchModerationExamplesForFingerprints = async ({ db, fingerprints, sourceContext = {}, sourceIdentifiers = {}, limit = 5 }) => {
  if (!fingerprints && !sourceContext.finalOutcome) return [];
  const matches = [];
  const collection = db.collection('moderationExamples');
  const candidateWindow = getCandidateWindow(limit);
  if (fingerprints?.sha256) {
    addSnapshotDocs(matches, await collection.where('fingerprints.sha256', '==', fingerprints.sha256).limit(candidateWindow).get(), 'sha256', null, sourceIdentifiers);
  }
  if (fingerprints?.dhash) {
    addSnapshotDocs(matches, await collection.where('fingerprints.dhash', '==', fingerprints.dhash).limit(candidateWindow).get(), 'dhash', null, sourceIdentifiers);
  }
  if (fingerprints?.dhashPrefix) {
    addSnapshotDocs(
      matches,
      await collection.where('fingerprints.dhashPrefix', '==', fingerprints.dhashPrefix).limit(candidateWindow).get(),
      'dhashPrefix',
      fingerprints,
      sourceIdentifiers,
    );
  }
  if (uniqueMatchCount(matches) < limit && sourceContext.finalOutcome) {
    addSnapshotDocs(matches, await collection.where('finalOutcome', '==', sourceContext.finalOutcome).limit(candidateWindow).get(), 'similar', null, sourceIdentifiers);
  }
  return rankModerationExampleMatches(matches, limit).map(sanitizeModerationExample);
};
