const toArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const pick = (source = {}, keys = []) => keys.reduce((acc, key) => {
  if (source?.[key] !== undefined) acc[key] = source[key];
  return acc;
}, {});

export const resolveModerationExampleFingerprints = (...sources) => {
  const resolved = {};
  for (const source of sources) {
    if (!source) continue;
    const candidates = [
      source.fingerprints,
      source.fingerprint,
      source.imageFingerprint,
      source.moderationFingerprint,
      source.uploadFingerprint,
      source.aiSnapshot?.fingerprints,
      source.moderation?.fingerprints,
      source.reuse?.fingerprints,
      source,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (!resolved.sha256 && candidate.sha256) resolved.sha256 = String(candidate.sha256);
      if (!resolved.dhash && candidate.dhash) resolved.dhash = String(candidate.dhash);
      if (!resolved.dhashPrefix && candidate.dhashPrefix) resolved.dhashPrefix = String(candidate.dhashPrefix);
    }
  }
  if (!resolved.dhashPrefix && resolved.dhash) resolved.dhashPrefix = resolved.dhash.slice(0, 8);
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

export const rankModerationExampleMatches = (matches = [], limit = 5) => {
  const priority = { sha256: 0, dhash: 1, dhashPrefix: 2, similar: 3 };
  const seen = new Map();
  for (const match of matches) {
    if (!match?.id) continue;
    const existing = seen.get(match.id);
    if (!existing || (priority[match.matchType] ?? 99) < (priority[existing.matchType] ?? 99)) {
      seen.set(match.id, match);
    }
  }
  return [...seen.values()]
    .sort((a, b) => {
      const priorityDiff = (priority[a.matchType] ?? 99) - (priority[b.matchType] ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      const aTime = Number(a.data?.createdAt?.toMillis?.() || Date.parse(a.data?.createdAt || '') || 0);
      const bTime = Number(b.data?.createdAt?.toMillis?.() || Date.parse(b.data?.createdAt || '') || 0);
      if (aTime !== bTime) return bTime - aTime;
      return String(a.id).localeCompare(String(b.id));
    })
    .slice(0, limit);
};

const addSnapshotDocs = (matches, snapshot, matchType) => {
  snapshot.docs.forEach((doc) => matches.push({ id: doc.id, data: doc.data() || {}, matchType }));
};

export const fetchModerationExamplesForFingerprints = async ({ db, fingerprints, sourceContext = {}, limit = 5 }) => {
  if (!fingerprints) return [];
  const matches = [];
  const collection = db.collection('moderationExamples');
  if (fingerprints.sha256) {
    addSnapshotDocs(matches, await collection.where('fingerprints.sha256', '==', fingerprints.sha256).limit(limit).get(), 'sha256');
  }
  if (fingerprints.dhash) {
    addSnapshotDocs(matches, await collection.where('fingerprints.dhash', '==', fingerprints.dhash).limit(limit).get(), 'dhash');
  }
  if (fingerprints.dhashPrefix) {
    addSnapshotDocs(matches, await collection.where('fingerprints.dhashPrefix', '==', fingerprints.dhashPrefix).limit(limit).get(), 'dhashPrefix');
  }
  if (matches.length < limit && sourceContext.finalOutcome) {
    addSnapshotDocs(matches, await collection.where('finalOutcome', '==', sourceContext.finalOutcome).limit(limit).get(), 'similar');
  }
  return rankModerationExampleMatches(matches, limit).map(sanitizeModerationExample);
};
