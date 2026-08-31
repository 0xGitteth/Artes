from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def replace_between(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0:
        raise AssertionError(f'{label}: start marker not found')
    end = text.find(end_marker, start + len(start_marker))
    if end < 0:
        raise AssertionError(f'{label}: end marker not found')
    return text[:start] + replacement + text[end:]


server_path = Path('functions/moderationLifecycle.js')
server = server_path.read_text(encoding='utf-8')
server = replace_between(
    server,
    "export const resolveUploadModerationState = (upload = {}) => {\n",
    "\nexport const resolveUploadPublicationState = (upload = {}) => {",
    """export const resolveUploadModerationState = (upload = {}) => {\n  const explicit = clean(upload?.moderationState);\n  if (explicit) {\n    if (!VALID_MODERATION_STATES.has(explicit)) {\n      return { valid: false, state: null, canonical: true, reason: 'unknown_moderation_state' };\n    }\n    // Canonical state is the server-owned authority. Legacy fields remain\n    // compatibility mirrors only and cannot override a modern document.\n    return { valid: true, state: explicit, canonical: true, reason: 'canonical' };\n  }\n\n  const legacyState = deriveLegacyModerationState(upload, { includeEvidence: true });\n  return legacyState\n    ? { valid: true, state: legacyState, canonical: false, reason: 'legacy' }\n    : { valid: false, state: null, canonical: false, reason: 'moderation_state_unresolved' };\n};\n""",
    'server moderation resolver',
)
server = replace_between(
    server,
    "export const resolveUploadPublicationState = (upload = {}) => {\n",
    "\nexport const resolveUploadLifecycle = (upload = {}) => {",
    """export const resolveUploadPublicationState = (upload = {}) => {\n  const explicit = clean(upload?.publicationState);\n  if (explicit) {\n    if (!VALID_PUBLICATION_STATES.has(explicit)) {\n      return { valid: false, state: null, canonical: true, reason: 'unknown_publication_state' };\n    }\n    // publicationStatus/publishStatus are legacy mirrors. Once canonical\n    // publicationState exists they are no longer operational authority.\n    return { valid: true, state: explicit, canonical: true, reason: 'canonical' };\n  }\n  const legacyState = deriveLegacyPublicationState(upload);\n  return legacyState\n    ? { valid: true, state: legacyState, canonical: false, reason: 'legacy' }\n    : { valid: false, state: null, canonical: false, reason: 'publication_state_unresolved' };\n};\n""",
    'server publication resolver',
)
server_path.write_text(server, encoding='utf-8')

client_lifecycle = r'''const clean = (value) => String(value || '').trim();

export const CLIENT_MODERATION_STATES = Object.freeze({
  allowed: 'allowed',
  reviewPending: 'review_pending',
  correctionPending: 'correction_pending',
  rejected: 'rejected',
  superseded: 'superseded',
});

export const CLIENT_PUBLICATION_STATES = Object.freeze({
  pending: 'pending',
  draft: 'draft',
  published: 'published',
  discarded: 'discarded',
  expired: 'expired',
});

const VALID_MODERATION_STATES = new Set(Object.values(CLIENT_MODERATION_STATES));
const VALID_PUBLICATION_STATES = new Set(Object.values(CLIENT_PUBLICATION_STATES));
const LEGACY_FRESH_EVALUATION_STATES = new Set(['freshEvalQueued', 'closedNoFingerprint']);
const LEGACY_DISCARDED_PUBLICATION_STATES = new Set(['discarded', 'deleted', 'deleted_pending_cleanup']);
const LEGACY_PENDING_PUBLICATION_STATES = new Set([
  '',
  'pending',
  'correction_accepted',
  'needs_user_correction',
  'user_disagreed',
  'blocked',
  'freshEvalQueued',
  'closedNoFingerprint',
]);

const hasForbiddenEvidence = (upload = {}) => {
  const outcome = clean(upload?.outcome).toLowerCase();
  const classification = clean(upload?.classification).toLowerCase();
  return outcome === 'forbidden'
    || outcome === 'explicit'
    || outcome === 'reported'
    || outcome === 'nocorrectionforbidden'
    || classification === 'reviewrequired'
    || classification === 'sensitivecorrection'
    || classification === 'review_required'
    || upload?.publishBlocked === true
    || (Array.isArray(upload?.forbiddenReasons) && upload.forbiddenReasons.length > 0);
};

const deriveLegacyModerationState = (upload = {}) => {
  const reviewStatus = clean(upload?.reviewStatus);
  const publicationStatus = clean(upload?.publicationStatus || upload?.publishStatus);
  const outcome = clean(upload?.outcome);
  const correctionNeedsReview = upload?.correction?.requiresModeratorReview === true;
  const correctionPending = upload?.requiresUploaderAcceptance === true
    || reviewStatus === 'needs_user_correction'
    || publicationStatus === 'needs_user_correction';

  if (LEGACY_FRESH_EVALUATION_STATES.has(reviewStatus)
    || LEGACY_FRESH_EVALUATION_STATES.has(publicationStatus)) return CLIENT_MODERATION_STATES.superseded;
  if (reviewStatus === 'inReview' || publicationStatus === 'user_disagreed' || correctionNeedsReview) {
    return CLIENT_MODERATION_STATES.reviewPending;
  }
  if (reviewStatus === 'rejected' || publicationStatus === 'blocked') return CLIENT_MODERATION_STATES.rejected;
  if (correctionPending && reviewStatus === 'approved') {
    return hasForbiddenEvidence(upload) ? CLIENT_MODERATION_STATES.rejected : CLIENT_MODERATION_STATES.allowed;
  }
  if (correctionPending) {
    return hasForbiddenEvidence(upload) ? CLIENT_MODERATION_STATES.rejected : CLIENT_MODERATION_STATES.correctionPending;
  }
  if (reviewStatus === 'approved') {
    return hasForbiddenEvidence(upload) ? CLIENT_MODERATION_STATES.rejected : CLIENT_MODERATION_STATES.allowed;
  }
  if (reviewStatus) return null;
  if (publicationStatus) return publicationStatus === 'published' ? CLIENT_MODERATION_STATES.allowed : null;
  if (upload?.shouldReview === true || outcome === 'review') return CLIENT_MODERATION_STATES.reviewPending;
  if (outcome === 'needsCorrection') return CLIENT_MODERATION_STATES.correctionPending;
  if (hasForbiddenEvidence(upload)) return CLIENT_MODERATION_STATES.rejected;
  if (outcome === 'allowed'
    && upload?.shouldReview !== true
    && upload?.publishBlocked !== true
    && (!Array.isArray(upload?.forbiddenReasons) || upload.forbiddenReasons.length === 0)) {
    return CLIENT_MODERATION_STATES.allowed;
  }
  return null;
};

const deriveLegacyPublicationState = (upload = {}) => {
  const raw = clean(upload?.publicationStatus || upload?.publishStatus);
  if (LEGACY_PENDING_PUBLICATION_STATES.has(raw)) return CLIENT_PUBLICATION_STATES.pending;
  if (raw === 'draft') return CLIENT_PUBLICATION_STATES.draft;
  if (raw === 'published') return CLIENT_PUBLICATION_STATES.published;
  if (LEGACY_DISCARDED_PUBLICATION_STATES.has(raw)) return CLIENT_PUBLICATION_STATES.discarded;
  if (raw === 'expired') return CLIENT_PUBLICATION_STATES.expired;
  return null;
};

export const resolveClientUploadModerationState = (upload = {}) => {
  const explicit = clean(upload?.moderationState);
  if (explicit) {
    return VALID_MODERATION_STATES.has(explicit)
      ? { valid: true, state: explicit, canonical: true, reason: 'canonical' }
      : { valid: false, state: null, canonical: true, reason: 'unknown_moderation_state' };
  }
  const legacyState = deriveLegacyModerationState(upload);
  return legacyState
    ? { valid: true, state: legacyState, canonical: false, reason: 'legacy' }
    : { valid: false, state: null, canonical: false, reason: 'moderation_state_unresolved' };
};

export const resolveClientUploadPublicationState = (upload = {}) => {
  const explicit = clean(upload?.publicationState);
  if (explicit) {
    return VALID_PUBLICATION_STATES.has(explicit)
      ? { valid: true, state: explicit, canonical: true, reason: 'canonical' }
      : { valid: false, state: null, canonical: true, reason: 'unknown_publication_state' };
  }
  const legacyState = deriveLegacyPublicationState(upload);
  return legacyState
    ? { valid: true, state: legacyState, canonical: false, reason: 'legacy' }
    : { valid: false, state: null, canonical: false, reason: 'publication_state_unresolved' };
};

export const resolveClientUploadLifecycle = (upload = {}) => {
  const moderation = resolveClientUploadModerationState(upload);
  const publication = resolveClientUploadPublicationState(upload);
  return {
    valid: moderation.valid && publication.valid,
    moderationState: moderation.state,
    publicationState: publication.state,
    moderationCanonical: moderation.canonical,
    publicationCanonical: publication.canonical,
    reason: !moderation.valid ? moderation.reason : !publication.valid ? publication.reason : 'resolved',
  };
};

export const isClientUploadAllowedPending = (upload = {}) => {
  const lifecycle = resolveClientUploadLifecycle(upload);
  return lifecycle.valid
    && lifecycle.moderationState === CLIENT_MODERATION_STATES.allowed
    && lifecycle.publicationState === CLIENT_PUBLICATION_STATES.pending;
};

export const isClientUploadCorrectionPending = (upload = {}) => {
  const lifecycle = resolveClientUploadLifecycle(upload);
  return lifecycle.valid
    && lifecycle.moderationState === CLIENT_MODERATION_STATES.correctionPending
    && lifecycle.publicationState === CLIENT_PUBLICATION_STATES.pending;
};

export const isClientUploadDiscarded = (upload = {}) => {
  const publication = resolveClientUploadPublicationState(upload);
  return publication.valid && publication.state === CLIENT_PUBLICATION_STATES.discarded;
};
'''
Path('src/utils/moderationUploadLifecycle.js').write_text(client_lifecycle, encoding='utf-8')

pending_path = Path('src/utils/pendingApprovedUpload.js')
pending_path.write_text(r'''import { isClientUploadAllowedPending } from './moderationUploadLifecycle.js';

export function resolveUploadTimestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value === 'number') return value;
  return 0;
}

export function isPendingApprovedUploadCandidate(upload = {}, options = {}) {
  const uploadId = String(upload?.id || '').trim();
  if (!uploadId) return false;
  if (options.acknowledgedUploadIds?.has?.(uploadId)) return false;
  if (!isClientUploadAllowedPending(upload)) return false;
  if (upload?.publishedAt || upload?.postId) return false;
  if (upload?.discardedAt || upload?.discardedByUid) return false;
  if (upload?.publicationPromptOpenedAt || upload?.publicationPromptDismissedAt) return false;
  return true;
}

export function selectPendingApprovedUploadReminder(uploads = [], options = {}) {
  const candidates = (Array.isArray(uploads) ? uploads : [])
    .filter((upload) => isPendingApprovedUploadCandidate(upload, options))
    .sort((a, b) => {
      const left = resolveUploadTimestampMs(b.reviewDecisionAt) || resolveUploadTimestampMs(b.approvedAt) || resolveUploadTimestampMs(b.createdAt);
      const right = resolveUploadTimestampMs(a.reviewDecisionAt) || resolveUploadTimestampMs(a.approvedAt) || resolveUploadTimestampMs(a.createdAt);
      return left - right;
    });

  if (!candidates.length) return null;
  return {
    uploadId: candidates[0].id,
    count: candidates.length,
  };
}
''', encoding='utf-8')

routing_path = Path('src/utils/moderationPublicationRouting.js')
routing_path.write_text(r'''import {
  CLIENT_MODERATION_STATES,
  CLIENT_PUBLICATION_STATES,
  resolveClientUploadLifecycle,
} from './moderationUploadLifecycle.js';

const clean = (value) => String(value || '').trim();

export function resolvePersistedModerationPublicationUploadId({
  isResumeFlow = false,
  resumeUpload = null,
  reviewUploadId = null,
  acceptedModeratorCorrection = false,
  currentModerationAllowed = false,
} = {}) {
  const persistedReviewUploadId = clean(reviewUploadId);
  if (acceptedModeratorCorrection && persistedReviewUploadId) return persistedReviewUploadId;

  const resumeUploadId = clean(resumeUpload?.id);
  const resumeLifecycle = resolveClientUploadLifecycle(resumeUpload || {});
  if (
    isResumeFlow
    && resumeUploadId
    && resumeLifecycle.valid
    && resumeLifecycle.moderationState === CLIENT_MODERATION_STATES.allowed
    && resumeLifecycle.publicationState === CLIENT_PUBLICATION_STATES.pending
  ) {
    return resumeUploadId;
  }

  if (currentModerationAllowed && persistedReviewUploadId) return persistedReviewUploadId;

  return null;
}
''', encoding='utf-8')

app_path = Path('src/ArtesApp.jsx')
app = app_path.read_text(encoding='utf-8')
app = replace_once(
    app,
    "import { resolvePersistedModerationPublicationUploadId } from './utils/moderationPublicationRouting';\n",
    "import { resolvePersistedModerationPublicationUploadId } from './utils/moderationPublicationRouting';\n"
    "import { isClientUploadCorrectionPending, isClientUploadDiscarded } from './utils/moderationUploadLifecycle';\n",
    'client lifecycle import',
)
old_query = """        const snapshot = await getDocs(query(\n          collection(db, 'uploads'),\n          where('userId', '==', authUser.uid),\n          where('reviewStatus', '==', 'approved'),\n          limit(10),\n        ));\n        if (!active || snapshot.empty) {\n          setPendingApprovedReminder(null);\n          return;\n        }\n\n        const uploads = [];\n        for (const docSnap of snapshot.docs) {\n"""
new_query = """        const [canonicalSnapshot, legacySnapshot] = await Promise.all([\n          getDocs(query(\n            collection(db, 'uploads'),\n            where('userId', '==', authUser.uid),\n            where('moderationState', '==', 'allowed'),\n            where('publicationState', '==', 'pending'),\n            limit(10),\n          )),\n          getDocs(query(\n            collection(db, 'uploads'),\n            where('userId', '==', authUser.uid),\n            where('reviewStatus', '==', 'approved'),\n            limit(10),\n          )),\n        ]);\n        const pendingDocs = Array.from(new Map(\n          [...canonicalSnapshot.docs, ...legacySnapshot.docs].map((docSnap) => [docSnap.id, docSnap])\n        ).values());\n        if (!active || pendingDocs.length === 0) {\n          setPendingApprovedReminder(null);\n          return;\n        }\n\n        const uploads = [];\n        for (const docSnap of pendingDocs) {\n"""
app = replace_once(app, old_query, new_query, 'pending approved lifecycle queries')
app = replace_once(
    app,
    "        if (String(uploadData.publicationStatus || uploadData.publishStatus || '').trim() === 'discarded') {\n",
    "        if (isClientUploadDiscarded(uploadData)) {\n",
    'resume discard lifecycle check',
)
app = replace_once(
    app,
    "        const needsAcceptance = uploadData.requiresUploaderAcceptance === true && uploadData.publicationStatus === 'needs_user_correction';\n",
    "        const needsAcceptance = isClientUploadCorrectionPending(uploadData);\n",
    'resume correction lifecycle check',
)
app = replace_once(
    app,
    "          ? { ...previous, moderationState: 'allowed', publicationState: 'pending', reviewStatus: 'approved', publicationStatus: 'correction_accepted', requiresUploaderAcceptance: false }\n",
    "          ? { ...previous, moderationState: 'allowed', publicationState: 'pending', requiresUploaderAcceptance: false }\n",
    'optimistic correction canonical state',
)
app_path.write_text(app, encoding='utf-8')

server_test_path = Path('functions/test/moderationLifecycle.test.js')
server_test = server_test_path.read_text(encoding='utf-8')
old_conflict = r'''test('canonical lifecycle fails closed on conflicting legacy operational state', () => {
  assert.equal(resolveUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'pending',
    reviewStatus: 'rejected',
    publicationStatus: 'blocked',
  }).valid, false);
  assert.equal(resolveUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'published',
    reviewStatus: 'approved',
    publicationStatus: 'discarded',
  }).valid, false);
});
'''
new_conflict = r'''test('canonical lifecycle ignores stale legacy mirrors on modern uploads', () => {
  const pending = resolveUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'pending',
    reviewStatus: 'rejected',
    publicationStatus: 'blocked',
  });
  assert.equal(pending.valid, true);
  assert.equal(pending.moderationState, MODERATION_STATES.allowed);
  assert.equal(pending.publicationState, PUBLICATION_STATES.pending);

  const published = resolveUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'published',
    reviewStatus: 'rejected',
    publicationStatus: 'future_legacy_state',
  });
  assert.equal(published.valid, true);
  assert.equal(published.moderationState, MODERATION_STATES.allowed);
  assert.equal(published.publicationState, PUBLICATION_STATES.published);
});
'''
server_test = replace_once(server_test, old_conflict, new_conflict, 'server canonical mirror test')
server_test_path.write_text(server_test, encoding='utf-8')

policy_test_path = Path('functions/test/userModerationActionPolicy.test.js')
policy_test = policy_test_path.read_text(encoding='utf-8')
insert_policy = """

test('canonical lifecycle cannot be vetoed by stale legacy status mirrors', () => {
  const canonical = {
    moderationState: 'allowed',
    publicationState: 'pending',
    mediaState: 'ready',
    reviewStatus: 'rejected',
    publicationStatus: 'blocked',
    publishStatus: 'discarded',
  };
  assert.equal(canPublishUpload(canonical), true);
  assert.equal(canSaveDraftUpload(canonical), true);
  assert.equal(canManageApprovedUploadPrompt(canonical), true);
});
"""
marker = "\ntest('draft and publication-prompt actions are lifecycle scoped', () => {"
if policy_test.count(marker) != 1:
    raise AssertionError('policy canonical mirror insertion marker not unique')
policy_test = policy_test.replace(marker, insert_policy + marker, 1)
policy_test_path.write_text(policy_test, encoding='utf-8')

client_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_MODERATION_STATES,
  CLIENT_PUBLICATION_STATES,
  isClientUploadAllowedPending,
  isClientUploadCorrectionPending,
  isClientUploadDiscarded,
  resolveClientUploadLifecycle,
} from '../src/utils/moderationUploadLifecycle.js';

test('client canonical lifecycle wins over stale legacy mirrors', () => {
  const lifecycle = resolveClientUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'pending',
    reviewStatus: 'rejected',
    publicationStatus: 'blocked',
  });
  assert.equal(lifecycle.valid, true);
  assert.equal(lifecycle.moderationState, CLIENT_MODERATION_STATES.allowed);
  assert.equal(lifecycle.publicationState, CLIENT_PUBLICATION_STATES.pending);
  assert.equal(isClientUploadAllowedPending({
    moderationState: 'allowed',
    publicationState: 'pending',
    reviewStatus: 'rejected',
    publicationStatus: 'discarded',
  }), true);
});

test('unknown canonical values fail closed even when legacy mirrors look approved', () => {
  assert.equal(resolveClientUploadLifecycle({
    moderationState: 'future_state',
    publicationState: 'pending',
    reviewStatus: 'approved',
    publicationStatus: 'pending',
  }).valid, false);
  assert.equal(resolveClientUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'future_state',
    reviewStatus: 'approved',
    publicationStatus: 'pending',
  }).valid, false);
});

test('legacy-only uploads retain bounded lifecycle compatibility', () => {
  assert.equal(isClientUploadAllowedPending({ reviewStatus: 'approved', publicationStatus: 'pending' }), true);
  assert.equal(isClientUploadAllowedPending({ reviewStatus: 'approved' }), true);
  assert.equal(isClientUploadCorrectionPending({
    reviewStatus: 'needs_user_correction',
    publicationStatus: 'needs_user_correction',
    requiresUploaderAcceptance: true,
  }), true);
  assert.equal(isClientUploadDiscarded({ reviewStatus: 'approved', publishStatus: 'deleted' }), true);
});

test('canonical correction and discard states drive UI predicates', () => {
  assert.equal(isClientUploadCorrectionPending({
    moderationState: 'correction_pending',
    publicationState: 'pending',
    reviewStatus: 'approved',
    publicationStatus: 'pending',
  }), true);
  assert.equal(isClientUploadDiscarded({
    moderationState: 'allowed',
    publicationState: 'discarded',
    publicationStatus: 'pending',
  }), true);
});
'''
Path('tests/moderationUploadLifecycle.logic.test.mjs').write_text(client_test, encoding='utf-8')

pending_test = r'''import assert from 'node:assert/strict';
import {
  isPendingApprovedUploadCandidate,
  selectPendingApprovedUploadReminder,
} from '../src/utils/pendingApprovedUpload.js';

const legacyBaseUpload = {
  id: 'upload_approved_pending',
  reviewStatus: 'approved',
  publicationStatus: 'pending',
  reviewDecisionAt: { seconds: 20 },
};

assert.equal(isPendingApprovedUploadCandidate(legacyBaseUpload), true);
assert.deepEqual(
  selectPendingApprovedUploadReminder([legacyBaseUpload]),
  { uploadId: 'upload_approved_pending', count: 1 },
);

const approvedWithoutPublicationStatus = { ...legacyBaseUpload };
delete approvedWithoutPublicationStatus.publicationStatus;
assert.equal(isPendingApprovedUploadCandidate(approvedWithoutPublicationStatus), true);
assert.equal(isPendingApprovedUploadCandidate({ ...legacyBaseUpload, publicationStatus: '' }), true);
assert.equal(isPendingApprovedUploadCandidate({ ...approvedWithoutPublicationStatus, publishStatus: 'discarded' }), false);
assert.equal(isPendingApprovedUploadCandidate({ ...legacyBaseUpload, publicationStatus: 'draft' }), false);
assert.equal(isPendingApprovedUploadCandidate({ ...legacyBaseUpload, publicationPromptOpenedAt: { seconds: 30 } }), false);
assert.equal(isPendingApprovedUploadCandidate({ ...legacyBaseUpload, publicationStatus: 'discarded', discardedAt: { seconds: 31 } }), false);
assert.equal(isPendingApprovedUploadCandidate({ ...legacyBaseUpload, publicationStatus: 'published', publishedAt: { seconds: 32 } }), false);

assert.equal(isPendingApprovedUploadCandidate({
  ...legacyBaseUpload,
  moderationState: 'allowed',
  publicationState: 'pending',
  reviewStatus: 'rejected',
  publicationStatus: 'blocked',
}), true, 'canonical allowed/pending state is reminder authority');
assert.equal(isPendingApprovedUploadCandidate({
  ...legacyBaseUpload,
  moderationState: 'superseded',
  publicationState: 'pending',
  reviewStatus: 'approved',
  publicationStatus: 'pending',
}), false, 'canonical superseded state blocks stale approved mirrors');
assert.equal(isPendingApprovedUploadCandidate({
  ...legacyBaseUpload,
  moderationState: 'allowed',
  publicationState: 'discarded',
  reviewStatus: 'approved',
  publicationStatus: 'pending',
}), false, 'canonical discarded state blocks stale pending mirrors');

assert.equal(
  selectPendingApprovedUploadReminder([
    { ...legacyBaseUpload, id: 'older', reviewDecisionAt: { seconds: 10 } },
    { ...legacyBaseUpload, id: 'newer', reviewDecisionAt: { seconds: 20 } },
  ])?.uploadId,
  'newer',
);

for (const publicationStatus of ['expired', 'deleted', 'deleted_pending_cleanup']) {
  assert.equal(isPendingApprovedUploadCandidate({ ...legacyBaseUpload, publicationStatus }), false);
}
'''
Path('tests/pendingApprovedUpload.logic.test.mjs').write_text(pending_test, encoding='utf-8')

routing_test = r'''import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePersistedModerationPublicationUploadId } from '../src/utils/moderationPublicationRouting.js';

test('legacy resume publication uses persisted pending upload', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: { id: 'u1', reviewStatus: 'approved', publicationStatus: 'pending' },
  }), 'u1');
});

test('legacy resume publication also finalizes accepted corrections', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: { id: 'u1', reviewStatus: 'approved', publicationStatus: 'correction_accepted' },
  }), 'u1');
});

test('fresh exact-match accepted correction publishes through persisted upload', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    reviewUploadId: 'exact-upload',
    acceptedModeratorCorrection: true,
  }), 'exact-upload');
});

test('ordinary fresh upload does not route through persisted upload endpoint', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({ reviewUploadId: 'ordinary-upload' }), null);
});

test('accepted moderator correction routes persisted publication even when resume state is stale', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: { id: 'u1', moderationState: 'correction_pending', publicationState: 'pending' },
    reviewUploadId: 'u1',
    acceptedModeratorCorrection: true,
    currentModerationAllowed: true,
  }), 'u1');
});

test('ordinary allowed moderation result routes through its persisted upload', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    reviewUploadId: 'moderated-upload',
    currentModerationAllowed: true,
  }), 'moderated-upload');
});

test('resume routing uses canonical lifecycle authority over stale mirrors', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: {
      id: 'canonical-upload',
      moderationState: 'allowed',
      publicationState: 'pending',
      reviewStatus: 'rejected',
      publicationStatus: 'blocked',
    },
  }), 'canonical-upload');
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: {
      id: 'stale-upload',
      moderationState: 'superseded',
      publicationState: 'pending',
      reviewStatus: 'approved',
      publicationStatus: 'pending',
    },
  }), null);
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: {
      id: 'unknown-upload',
      moderationState: 'future_state',
      publicationState: 'pending',
      reviewStatus: 'approved',
      publicationStatus: 'pending',
    },
  }), null);
});
'''
Path('tests/moderationPublicationRouting.logic.test.mjs').write_text(routing_test, encoding='utf-8')

correction_source_path = Path('tests/moderationCorrectionClientSource.test.mjs')
correction_source = correction_source_path.read_text(encoding='utf-8')
correction_source = replace_once(
    correction_source,
    "  assert.match(source, /reviewStatus: 'approved', publicationStatus: 'correction_accepted'/);\n",
    "  assert.match(source, /moderationState: 'allowed', publicationState: 'pending', requiresUploaderAcceptance: false/);\n"
    "  assert.doesNotMatch(source, /moderationState: 'allowed', publicationState: 'pending', reviewStatus: 'approved', publicationStatus: 'correction_accepted'/);\n",
    'correction optimistic state source assertion',
)
correction_source_path.write_text(correction_source, encoding='utf-8')

client_source_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
const pendingSource = fs.readFileSync(new URL('../src/utils/pendingApprovedUpload.js', import.meta.url), 'utf8');
const routingSource = fs.readFileSync(new URL('../src/utils/moderationPublicationRouting.js', import.meta.url), 'utf8');
const lifecycleSource = fs.readFileSync(new URL('../src/utils/moderationUploadLifecycle.js', import.meta.url), 'utf8');

test('client lifecycle decisions share one canonical-first projection', () => {
  assert.match(pendingSource, /isClientUploadAllowedPending/);
  assert.match(routingSource, /resolveClientUploadLifecycle/);
  assert.match(appSource, /isClientUploadCorrectionPending/);
  assert.match(appSource, /isClientUploadDiscarded/);
  assert.match(lifecycleSource, /if \(explicit\)/);
  assert.match(lifecycleSource, /reason: 'canonical'/);
});

test('pending reminder discovery covers canonical uploads and bounded legacy fallback', () => {
  const start = appSource.indexOf('const loadPendingApprovedUpload = async');
  const end = appSource.indexOf('loadPendingApprovedUpload();', start);
  const body = appSource.slice(start, end);
  assert.match(body, /where\('moderationState', '==', 'allowed'\)/);
  assert.match(body, /where\('publicationState', '==', 'pending'\)/);
  assert.match(body, /where\('reviewStatus', '==', 'approved'\)/);
  assert.match(body, /pendingDocs = Array\.from\(new Map/);
});

test('resume UI no longer makes direct legacy lifecycle decisions', () => {
  assert.doesNotMatch(appSource, /String\(uploadData\.publicationStatus \|\| uploadData\.publishStatus/);
  assert.doesNotMatch(appSource, /uploadData\.requiresUploaderAcceptance === true && uploadData\.publicationStatus/);
  assert.match(appSource, /isClientUploadDiscarded\(uploadData\)/);
  assert.match(appSource, /isClientUploadCorrectionPending\(uploadData\)/);
});
'''
Path('tests/moderationClientLifecycleAuthoritySource.test.mjs').write_text(client_source_test, encoding='utf-8')

print('canonical client/server lifecycle authority refactor applied')
