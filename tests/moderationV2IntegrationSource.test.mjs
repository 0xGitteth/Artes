import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
const uploadModalSource = fs.readFileSync(new URL('../src/components/UploadModal.jsx', import.meta.url), 'utf8');
const postCardSource = fs.readFileSync(new URL('../src/components/PostCard.jsx', import.meta.url), 'utf8');
const photoDetailSource = fs.readFileSync(new URL('../src/components/PhotoDetailModal.jsx', import.meta.url), 'utf8');
const classifierSource = fs.readFileSync(new URL('../functions/geminiModerationClassifier.js', import.meta.url), 'utf8');

test('moderation v2 classifier is wired into the live function flow', () => {
  assert.match(indexSource, /runGeminiClassifier as runGeminiClassifierV2/);
  assert.match(indexSource, /await runGeminiClassifierV2\(parsed\)/);
});

test('forbidden moderation outcomes always produce blocking copy', () => {
  assert.match(indexSource, /const forbiddenOutcome = outcome === 'forbidden'/);
  assert.match(indexSource, /const publishBlocked = Boolean\(policyResult\.publishBlocked \|\| forbiddenOutcome\)/);
  assert.match(indexSource, /const userMessage = forbiddenOutcome/);
  assert.match(indexSource, /classification === 'disallowed_moderator_rejected'/);
  assert.match(indexSource, /Deze publicatie is geblokkeerd op basis van een eerdere moderatiebeslissing/);
});

test('effective moderator taxonomy reaches uploader state and publish payloads', () => {
  assert.match(indexSource, /moderatorCorrectionApplied: Boolean\(policyResult\.moderatorCorrectionApplied\)/);
  assert.match(appSource, /returnedUserTaxonomy = data\?\.moderatorCorrectionApplied === true/);
  assert.match(appSource, /setSelectedStyles\(nextEffectiveThemes\)/);
  assert.match(appSource, /setMakerTags\(nextEffectiveMakerTags\)/);
  assert.match(appSource, /effectiveUserTaxonomy = moderationData\?\.moderatorCorrectionApplied === true/);
  assert.match(appSource, /styles: effectiveSelectedStyles/);
  assert.match(appSource, /makerTags: effectiveMakerTags/);
});


test('Gemini v2 preserves graphic sensitive evidence in diagnostics for policy', () => {
  assert.match(classifierSource, /const graphicSensitiveSignals = Array\.isArray\(trustedNormalized\?\.triggers\)/);
  assert.match(classifierSource, /graphicSensitiveSignals,/);
});


test('all emitted sensitive warning triggers are registered and labeled in the client', () => {
  const triggerIds = ['bloodInjury', 'selfHarm', 'suicide', 'eatingDisorder', 'substanceDistress', 'violence', 'horrorScare'];
  for (const trigger of triggerIds) {
    assert.ok(appSource.includes(`id: '${trigger}'`), `missing ${trigger} in ArtesApp trigger preferences`);
    assert.ok(uploadModalSource.includes(`id: '${trigger}'`), `missing ${trigger} in UploadModal trigger options`);
    assert.ok(postCardSource.includes(`${trigger}:`), `missing ${trigger} PostCard label`);
    assert.ok(photoDetailSource.includes(`${trigger}:`), `missing ${trigger} PhotoDetail label`);
  }
  for (const source of [appSource, uploadModalSource, postCardSource, photoDetailSource]) {
    assert.ok(source.includes('adultGraphicSensitive'));
  }
});


test('retired object/topic-only categories are not exposed as core moderation preferences', () => {
  for (const trigger of ['needlesInjections', 'spidersInsects', 'drugUse', 'weapons']) {
    assert.equal(appSource.includes(`id: '${trigger}'`), false);
    assert.equal(uploadModalSource.includes(`id: '${trigger}'`), false);
  }
  for (const trigger of ['needlesInjections', 'spidersInsects']) {
    assert.ok(postCardSource.includes(`${trigger}:`), `missing historical ${trigger} PostCard label`);
    assert.ok(photoDetailSource.includes(`${trigger}:`), `missing historical ${trigger} PhotoDetail label`);
  }
});


test('live v2 routing uses canonical safety IDs and exposes moderator corrections', () => {
  assert.ok(indexSource.includes("routeGeminiForbiddenReasons({"));
  assert.equal(indexSource.includes("lowerReason.includes('sexual')"), false);
  assert.ok(indexSource.includes('moderatorCorrectedTaxonomy: policyResult.moderatorCorrectedTaxonomy'));
  assert.ok(appSource.includes("nextOutcome === 'needsCorrection'"));
  assert.ok(appSource.includes('moderatorCorrectedTaxonomy: data?.moderatorCorrectedTaxonomy || null'));
});


test('live previous-example routing uses canonical moderator actions', () => {
  assert.ok(indexSource.includes("import { MODERATOR_DECISION_ACTIONS, isModeratorDecisionActionCompatible, normalizeModeratorDecisionAction, validateCorrectedTaxonomyForAction } from './moderatorDecision.js';"));
  assert.ok(indexSource.includes('isFinalModerationExampleAction(previousExampleAction)'));
  assert.ok(indexSource.includes('compareModerationExampleCandidates(candidate, best)'));
  assert.equal(indexSource.includes("const FINAL_MODERATOR_ACTIONS = new Set(['approve', 'reject']);"), false);
});

test('all uploader taxonomy edits invalidate completed moderation state', () => {
  assert.ok(appSource.includes('const acceptedCorrectionChanged = Boolean(correctionAcceptedAt'));
  assert.ok(appSource.includes('const invalidateModerationAfterTaxonomyEdit = () => {'));
  assert.match(appSource, /const invalidateModerationAfterTaxonomyEdit = \(\) => \{[\s\S]{0,700}?setOutcome\('unchecked'\)[\s\S]{0,700}?setPolicyAppliedTriggers\(\[\]\)[\s\S]{0,700}?setCorrectionAcceptedAt\(null\)/);
  assert.match(appSource, /const toggleStyle = \(theme\) => \{\s*invalidateModerationAfterTaxonomyEdit\(\);/);
  assert.match(appSource, /key=\{trigger\.id\}[\s\S]{0,650}?invalidateModerationAfterTaxonomyEdit\(\);[\s\S]{0,350}?setMakerTags/);
  assert.ok(appSource.includes("setTaxonomyCorrection((previous) => (previous?.fromModeratorReview ? previous : null));"));
});


test('automatic moderator corrections are invalidated by later uploader taxonomy edits', () => {
  assert.ok(appSource.includes('const moderatorCorrectionBaselineRef = useRef(null);'));
  assert.ok(appSource.includes('moderatorCorrectionBaselineRef.current = returnedUserTaxonomy ?'));
  assert.match(appSource, /const invalidateModerationAfterTaxonomyEdit = \(\) => \{[\s\S]{0,180}?moderationInputRevisionRef\.current \+= 1;[\s\S]{0,180}?moderatorCorrectionBaselineRef\.current = null;[\s\S]{0,200}?setOutcome\('unchecked'\)/);
});

test('accepted moderator correction taxonomy is enforced in the server publication path', () => {
  assert.ok(indexSource.includes('buildModeratedPublicationTaxonomy({ upload: latestUpload, postDraft })'));
  assert.ok(indexSource.includes("error.code = publicationTaxonomy.code || 'moderated_taxonomy_mismatch'"));
});


test('live Gemini reason routing keeps medium explicit confidence in review', () => {
  assert.ok(indexSource.includes("import { routeGeminiForbiddenReasons } from './geminiModerationRouting.js';"));
  assert.ok(indexSource.includes('routedGeminiForbiddenReasons.explicitDecisionAddedForbiddenReason'));
  assert.equal(indexSource.includes("forbiddenReasons.push({ trigger, reason: normalizedReason, score: 1 });"), false);
});

test('review copy distinguishes sexual uncertainty from nonsexual safety review', () => {
  assert.ok(indexSource.includes("reason?.reason === 'sexual_explicit_uncertain'"));
  assert.ok(indexSource.includes('Deze content moet eerst handmatig worden beoordeeld voordat je kunt publiceren.'));
});


test('rejecting a moderator correction reopens its review case', () => {
  const start = indexSource.indexOf("if (correctionPlan) {");
  assert.notEqual(start, -1);
  const body = indexSource.slice(start, indexSource.indexOf("if (publicationPlan) {", start));
  assert.ok(body.includes("if (action === 'rejectCorrection')"));
  assert.ok(body.includes("db.collection('reviewCases').doc(correctionReviewCaseId)"));
  assert.ok(body.includes("status: 'inReview'"));
  assert.ok(body.includes("userCorrectionStatus: 'rejected'"));
});


test('exact moderation example routing scans every matching page', () => {
  const start = indexSource.indexOf('const findExactModerationExample = async');
  assert.notEqual(start, -1);
  const body = indexSource.slice(start, indexSource.indexOf('const findNearDuplicateUpload', start));
  assert.ok(body.includes('while (hasMore)'));
  assert.ok(body.includes('query = query.startAfter(cursor)'));
  assert.ok(body.includes('hasMore = false'));
  assert.ok(body.includes('compareModerationExampleCandidates(candidate, best)'));
});


test('exact-match moderator correction responses persist through userModerationAction', () => {
  assert.ok(indexSource.includes("const routedUserCorrection = outcome === 'needsCorrection'"));
  assert.ok(indexSource.includes("publicationStatus: 'needs_user_correction'"));
  assert.ok(indexSource.includes('correctionReviewCaseId: routedUserCorrectionReviewCaseId'));
  assert.ok(appSource.includes("const correctionUploadId = String(resumeUpload?.id || reviewUploadId || '').trim();"));
  assert.ok(appSource.includes("action: 'acceptCorrection',"));
  assert.ok(appSource.includes('postDraft: {'));
  assert.ok(appSource.includes("body: JSON.stringify({ uploadId: correctionUploadId, action: 'rejectCorrection' })"));
});

test('automatic moderator corrections are applied before server publication validation', () => {
  assert.ok(indexSource.includes('applyAutomaticModeratorCorrectionToPostDraft({ upload: latestUpload, postDraft: boundDraftState.draft })'));
  const bindIndex = indexSource.indexOf('buildPersistedModerationDraftState({ upload: latestUpload, draft: submittedPostDraft })');
  const correctionIndex = indexSource.indexOf('applyAutomaticModeratorCorrectionToPostDraft({ upload: latestUpload, postDraft: boundDraftState.draft })');
  const taxonomyIndex = indexSource.indexOf('buildModeratedPublicationTaxonomy({ upload: latestUpload, postDraft })');
  assert.ok(bindIndex >= 0 && bindIndex < correctionIndex && correctionIndex < taxonomyIndex);
  assert.ok(appSource.includes("uploadData?.moderatorDecision?.action === 'approveWithTaxonomyCorrection'"));
  assert.ok(appSource.includes('moderatorCorrectionBaselineRef.current = automaticModeratorCorrection'));
});

test('rejected exact-match corrections retarget the reopened review case to the current upload', () => {
  const start = indexSource.indexOf("if (action === 'rejectCorrection')");
  assert.notEqual(start, -1);
  const body = indexSource.slice(start, indexSource.indexOf('if (publicationPlan)', start));
  assert.ok(body.includes('uploadId,'));
  assert.ok(body.includes('linkedUploadIds: correctionPlan.reviewReopenPlan?.createNewReviewCase'));
  assert.ok(body.includes('? [uploadId]'));
  assert.ok(body.includes(': FieldValue.arrayUnion(uploadId)'));
});


test("reopened correction reviews restore the user's open review counter", () => {
  const start = indexSource.indexOf("if (action === 'rejectCorrection')");
  assert.notEqual(start, -1);
  const body = indexSource.slice(start, indexSource.indexOf('if (publicationPlan)', start));
  assert.ok(body.includes("db.collection('userModeration').doc(userId)"));
  assert.ok(body.includes('openReviewCount: 1'));
});


test('reasonless review outcomes create cases even without forbidden reasons', () => {
  assert.ok(indexSource.includes("const policyRequiresReview = policyResult.shouldReview || policyResult.outcome === 'review';"));
  assert.ok(indexSource.includes('shouldCreateProductionReviewCase({ isCodexActor, forbiddenReasons: finalForbiddenReasons, shouldReview: policyRequiresReview })'));
  assert.ok(indexSource.includes('(finalForbiddenReasons.length > 0 || policyRequiresReview)'));
  assert.ok(indexSource.includes("finalForbiddenReasons.length > 0 ? 'forbiddenOutcomeAutoReview' : 'policyReviewAuto'"));
});

test('visible AI checks preserve policy-applied trigger records through publication', () => {
  assert.ok(appSource.includes('const [policyAppliedTriggers, setPolicyAppliedTriggers] = useState([]);'));
  assert.ok(appSource.includes('setPolicyAppliedTriggers(Array.isArray(data.policyAppliedTriggers) ? data.policyAppliedTriggers : []);'));
  assert.ok(appSource.includes('resolvePolicyAppliedTriggersForPublication({'));
  assert.equal(appSource.includes('(policyAppliedTriggers.length ? policyAppliedTriggers : appliedTriggers)'), false);
  assert.ok(appSource.includes("source: 'moderatorCorrection'"));
  assert.ok(appSource.includes("source: 'acceptedCorrection'"));
  assert.ok(appSource.includes('uploadData?.correction?.finalAcceptedTriggers'));
});

test('exact-match correction rejection reopens the routed correction review case', () => {
  assert.ok(indexSource.includes("const correctionReviewCaseId = String(correctionPlan.reviewCaseId || '').trim();"));
});

test('nonsexual safety rejection reason codes exist on server and moderator client', () => {
  for (const reasonCode of [
    'forbidden_self_harm_instruction',
    'forbidden_suicide_instruction',
    'forbidden_eating_disorder_instruction',
    'forbidden_harmful_drug_instruction',
    'forbidden_other_safety',
  ]) {
    assert.ok(indexSource.includes(reasonCode), `server missing ${reasonCode}`);
    assert.ok(appSource.includes(reasonCode), `client missing ${reasonCode}`);
  }
});


test('moderation reuse excludes reports and filters stale prompt caches during selection', () => {
  assert.ok(indexSource.includes("GEMINI_MODERATION_PROMPT_VERSION"));
  assert.ok(indexSource.includes("isUploadModerationExampleData(candidate.data)"));
  assert.ok(indexSource.includes('isReusableModerationCache(uploadData, GEMINI_MODERATION_PROMPT_VERSION)'));
  assert.ok(indexSource.includes('hasMatchingReusableModerationTaxonomy({ uploadData, themes, makerTags })'));
  assert.ok(indexSource.includes("resolveCachedReviewCaseIdForUploader({ uploadData: matchedUpload.data, userId, isCodexActor })"));
  assert.equal(indexSource.includes("!isReusableModerationCache(matchedUpload.data, GEMINI_MODERATION_PROMPT_VERSION)"), false);
});


test('correction acceptance uses ownership-aware review-case resolution', () => {
  assert.ok(indexSource.includes("let reviewReopenPlan = resolveCorrectionReviewReopenPlan({"));
  assert.ok(indexSource.includes("newReviewCaseId: action === 'rejectCorrection' ? (rejectedCorrectionReviewRef?.id || null) : null"));
  assert.equal(indexSource.includes("targetReviewCaseId: latestUpload?.reviewCaseId || latestUpload?.correctionReviewCaseId || null"), false);
});


test('moderator keyboard shortcuts keep decision actions canonical', () => {
  assert.match(appSource, /event\.key\.toLowerCase\(\) === 'a'[\s\S]{0,180}?setDecisionAction\(MODERATOR_DECISION_ACTIONS\.approveAsIs\)[\s\S]{0,120}?setDecision\('approved'\)/);
  assert.match(appSource, /event\.key\.toLowerCase\(\) === 'r'[\s\S]{0,180}?setDecisionAction\(MODERATOR_DECISION_ACTIONS\.rejectForbidden\)[\s\S]{0,120}?setDecision\('rejected'\)/);
});

test('moderator decisions normalize stale upload moderation and correction state', () => {
  assert.ok(indexSource.includes('const moderatorLifecycleState = !isApproved'));
  assert.ok(indexSource.includes("outcome: 'needsCorrection'"));
  assert.ok(indexSource.includes('buildAcceptedCorrectionModerationState();'));
  assert.ok(indexSource.includes('uploaderCorrectionResponse: FieldValue.delete()'));
  assert.ok(indexSource.includes('correction: FieldValue.delete()'));
});

test('correction acceptance revalidates active case provenance inside the transaction', () => {
  assert.ok(indexSource.includes('finalizeCorrectionReviewCasePlan({'));
  assert.ok(indexSource.includes('validateRoutedCorrectionAcceptanceProvenance({'));
  assert.ok(indexSource.includes("error.code = 'correction_request_inactive'"));
  assert.ok(indexSource.includes(": 'correction_source_inactive'"));
  assert.ok(indexSource.includes("transaction.get(db.collection('reviewCases').doc(reviewCaseId))"));
  assert.ok(indexSource.includes("db.collection('reviewCases').doc(reviewReopenPlan.sourceReviewCaseId)"));
  assert.ok(indexSource.includes('publicationStatus: nextStatus'));
  assert.ok(indexSource.includes('requiresUploaderAcceptance: false'));
});

test('manual upload review cases persist fingerprints and report cases are filtered from upload reuse', () => {
  assert.ok(indexSource.includes('fingerprints: created'));
  assert.ok(indexSource.includes('findFirstUploadReviewCaseAcrossPages'));
  assert.ok(indexSource.includes('resolveReviewCaseUploadIds(openReviewCase.data).slice(0, 10)'));
});


test('moderator redecision resets active correction-rejection case state', () => {
  assert.ok(indexSource.includes('userCorrectionStatus: FieldValue.delete()'));
  assert.ok(indexSource.includes('userCorrectionRejectedAt: FieldValue.delete()'));
  assert.ok(indexSource.includes('userCorrectionRejectedByUid: FieldValue.delete()'));
});

test('stale sibling correction responses are rejected against the persisted case decision', () => {
  assert.ok(indexSource.includes('upload: latestUpload'));
  assert.ok(indexSource.includes("error.code = 'correction_superseded'"));
  assert.ok(indexSource.includes('reviewReopenPlan.correctionSuperseded'));
});


test('moderator learning preserves pre-decision upload review evidence', () => {
  assert.ok(indexSource.includes('uploadData: uploadSnapshotData || {}'));
  assert.ok(indexSource.includes('aiResult = uploadSnapshotData?.aiResult'));
});


test('automatic and manual open upload review lookups paginate before filtering reports', () => {
  const uses = indexSource.match(/findFirstUploadReviewCaseAcrossPages\(\{/g) || [];
  assert.ok(uses.length >= 2);
  const start = indexSource.indexOf('export const requestUploadReviewCase');
  const end = indexSource.indexOf('export const getModerationExamplesForCase', start);
  assert.match(indexSource.slice(start, end), /findFirstUploadReviewCaseAcrossPages/);
});


test('manual review transaction rechecks a concurrently linked upload case', () => {
  const start = indexSource.indexOf('export const requestUploadReviewCase');
  const end = indexSource.indexOf('export const getModerationExamplesForCase', start);
  const source = indexSource.slice(start, end);
  assert.match(source, /freshLinkedReviewCaseId = String\(freshUploadData\.reviewCaseId/);
  assert.match(source, /candidateReviewCaseIds = \[\.\.\.new Set/);
  assert.match(source, /freshLinkedReviewCaseId,\s*candidateReviewRef\?\.id/);
  assert.match(source, /await transaction\.get\(candidateRef\)/);
  assert.match(source, /reusableReviewRef = candidateRef/);
});


test('automatic review creation rechecks review rights, capacity and cooldown transactionally', () => {
  assert.ok(indexSource.includes('let hasReviewRights = true'));
  assert.ok(indexSource.includes('let reviewCapacityAvailable = true'));
  assert.ok(indexSource.includes('freshUserModerationSnap = await transaction.get(userModeration.ref)'));
  assert.ok(indexSource.includes('const freshReviewAccess = getReviewAccessDecision({'));
  assert.ok(indexSource.includes('reviewCapacityAvailable = freshReviewAccess.reviewCapacityAvailable'));
  assert.ok(indexSource.includes('if (!freshReviewAccess.allowed) return'));
  assert.match(indexSource, /canRequestReview = !isCodexActor[\s\S]*&& hasReviewRights[\s\S]*&& reviewCapacityAvailable/);
});

test('manual upload review creation enforces quota state in the same transaction', () => {
  const start = indexSource.indexOf('export const requestUploadReviewCase');
  const end = indexSource.indexOf('export const getModerationExamplesForCase', start);
  const source = indexSource.slice(start, end);
  assert.ok(source.includes('manualUserModeration = await getUserModeration(decoded.uid)'));
  assert.ok(source.includes('freshUserModerationSnap = await transaction.get(manualUserModeration.ref)'));
  assert.ok(source.includes('const freshReviewAccess = getReviewAccessDecision({'));
  assert.ok(source.includes('if (!freshReviewAccess.allowed)'));
  assert.ok(source.includes('error.status = freshReviewAccess.status'));
  assert.ok(source.includes('error.code = freshReviewAccess.code'));
  assert.match(source, /if \(created\) \{[\s\S]*transaction\.set\(manualUserModeration\.ref,[\s\S]*openReviewCount: 1/);
});


test('server rejects correction acceptance without verifiable provenance', () => {
  assert.ok(indexSource.includes('validateCorrectionAcceptancePlanProvenance({'));
  assert.ok(indexSource.includes("error.code = 'correction_provenance_missing'"));
});


test('near duplicates never reuse an allowed classifier result and only restrictive moderator history may route', () => {
  assert.match(indexSource, /const cachedGeminiDiagnostics = matchedUpload\?\.data && matchedFingerprintType === 'sha256'/);
  assert.ok(indexSource.includes("if (matchedModerationExample) matchedModerationExampleFingerprintType = 'sha256';"));
  assert.ok(indexSource.includes("if (!isCodexActor && !matchedModerationExample && matchedUpload && matchedFingerprintType === 'dhash')"));
  assert.ok(indexSource.includes("matchedModerationExampleFingerprintType = 'dhash'"));
  assert.ok(indexSource.includes('canRouteNearDuplicateModerationExampleAction(previousExampleAction)'));
  assert.equal(indexSource.includes('selectPreferredModerationExampleCandidate(['), false);
});

test('manual review drafts pin the selected managed author through resume publication', () => {
  assert.ok(appSource.includes('resolveModerationDraftAuthor({'));
  assert.ok(appSource.includes('authorProfileId: draftAuthor.authorProfileId'));
  assert.ok(appSource.includes('authorOwnerUid: draftAuthor.authorOwnerUid'));
  assert.ok(appSource.includes('authorName: draftAuthor.authorName'));
  assert.ok(appSource.includes('const publishProfileCheck = isResumeFlow ? { ok: true } : assertCanPublishWithManagedProfile(activeProfile);'));
});

test('cache hits preserve reusable Gemini provenance for later cache reuse', () => {
  assert.ok(indexSource.includes('buildReusableCacheGeminiDiagnostics'));
  assert.ok(indexSource.includes('const cachedGeminiDiagnostics = matchedUpload?.data'));
  assert.ok(indexSource.includes('let geminiDiagnostics = buildGeminiDiagnostics(cachedGeminiDiagnostics || {});'));
  assert.ok(indexSource.includes('aiSafetySignals: matchedUpload.data.aiSafetySignals || []'));
  assert.ok(indexSource.includes('aiVisionLabels: matchedUpload.data.aiVisionLabels || []'));
  assert.ok(indexSource.includes('policyAppliedTriggers: matchedUpload.data.policyAppliedTriggers || []'));
});

test('in-flight moderation cannot overwrite taxonomy edits with a stale response', () => {
  assert.ok(appSource.includes('const moderationInputRevisionRef = useRef(0);'));
  assert.ok(appSource.includes('const moderationRequestSequenceRef = useRef(0);'));
  assert.match(appSource, /const invalidateModerationAfterTaxonomyEdit = \(\) => \{\s*moderationInputRevisionRef\.current \+= 1;/);
  assert.match(appSource, /const handleFile = async \(e\) => \{[\s\S]{0,180}?moderationInputRevisionRef\.current \+= 1;/);
  assert.ok(appSource.includes('const requestInputRevision = moderationInputRevisionRef.current;'));
  assert.ok(appSource.includes('const requestSequence = moderationRequestSequenceRef.current + 1;'));
  assert.ok(appSource.includes('body: JSON.stringify({ image: requestImage, makerTags: requestMakerTags, themes: requestThemes })'));
  assert.ok(appSource.includes("logModerationDebug('moderate-image-response-stale'"));
  assert.ok(appSource.includes("logModerationDebug('moderate-image-error-stale'"));
  assert.match(appSource, /finally \{\s*if \(moderationRequestSequenceRef\.current === requestSequence\) \{\s*moderationInFlightRequestRef\.current = null;\s*setAiLoading\(false\);/);
});

test('visible taxonomy controls are frozen while moderation is running', () => {
  assert.match(appSource, /key=\{t\}[\s\S]{0,220}?onClick=\{\(\) => toggleStyle\(t\)\}[\s\S]{0,100}?disabled=\{aiLoading\}/);
  assert.match(appSource, /key=\{trigger\.id\}[\s\S]{0,180}?type="button"[\s\S]{0,100}?disabled=\{aiLoading\}/);
});

test('publication is synchronously blocked while a newer moderation request is in flight', () => {
  assert.ok(appSource.includes('const moderationInFlightRequestRef = useRef(null);'));
  assert.match(appSource, /moderationRequestSequenceRef\.current = requestSequence;\s*moderationInFlightRequestRef\.current = requestSequence;/);
  assert.match(appSource, /const handlePublish = async \([^)]*\) => \{\s*if \(moderationInFlightRequestRef\.current !== null \|\| aiLoading\)/);
  assert.match(appSource, /moderationInFlightRequestRef\.current = null;\s*setAiLoading\(false\);/);
  assert.match(appSource, /disabled=\{publishing \|\| aiLoading \|\| moderationInFlightRequestRef\.current !== null \|\| showSuggestionUI/);
});

test('cache reuse is gated by the current normalized uploader taxonomy and audit path reflects actual reuse', () => {
  assert.ok(indexSource.includes('hasMatchingReusableModerationTaxonomy'));
  const exactCacheStart = indexSource.indexOf('const findExactUpload = async');
  const nearCacheStart = indexSource.indexOf('const findNearDuplicateUpload = async');
  const cacheSelectionSource = indexSource.slice(exactCacheStart, indexSource.indexOf('const isFingerprintBlocked', nearCacheStart));
  assert.ok(cacheSelectionSource.includes('hasMatchingReusableModerationTaxonomy({ uploadData, themes, makerTags })'));
  assert.ok(cacheSelectionSource.includes('isReusableModerationCache(uploadData, GEMINI_MODERATION_PROMPT_VERSION)'));
  assert.equal(indexSource.includes('const cachedTaxonomyMatches ='), false);
  assert.match(indexSource, /const cachedGeminiDiagnostics = matchedUpload\?\.data/);
  assert.ok(indexSource.includes("? 'matchedUploadFreshEvaluation'"));
});

test('accepted correction drafts persist and restore the full consent-resolution state', () => {
  assert.ok(appSource.includes('const consentDraftState = buildConsentDraftState({'));
  assert.match(appSource, /pendingInviteContributors,\s*\.\.\.consentDraftState,\s*isChallenge/);
  assert.ok(appSource.includes('const resumedConsentDraft = normalizeConsentDraftState({ ...uploadData, ...draft });'));
  for (const setter of [
    'setConsentException(resumedConsentDraft.consentException)',
    'setAiPeoplePresent(resumedConsentDraft.aiPeoplePresent)',
    'setSubjectWarningAcknowledged(resumedConsentDraft.subjectWarningAcknowledged)',
    'setMissingMakerPromptShown(resumedConsentDraft.missingMakerPromptShown)',
    'setSelectedSelfMakerRole(resumedConsentDraft.selectedSelfMakerRole)',
    'setPendingSelfMakerRole(resumedConsentDraft.pendingSelfMakerRole)',
    'setSelfMakerRoleConfirmation(resumedConsentDraft.selfMakerRoleConfirmation)',
  ]) assert.ok(appSource.includes(setter), `missing consent resume wiring: ${setter}`);
});

test('initial review drafts preserve consent state for later correction resume', () => {
  const reviewStart = appSource.indexOf('const handleRequestReview = async () => {');
  const reviewEnd = appSource.indexOf('const getNewCreditMakerFields = useCallback', reviewStart);
  assert.ok(reviewStart >= 0 && reviewEnd > reviewStart, 'review-request block must be locatable');
  const reviewSource = appSource.slice(reviewStart, reviewEnd);
  assert.ok(reviewSource.includes('const consentDraftState = buildConsentDraftState({'));
  for (const field of [
    'consentException',
    'aiPeoplePresent',
    'subjectWarningAcknowledged',
    'missingMakerPromptShown',
    'selectedSelfMakerRole',
    'pendingSelfMakerRole',
    'selfMakerRoleConfirmation',
  ]) {
    assert.ok(reviewSource.includes(field), `review draft must include ${field}`);
  }
  assert.match(reviewSource, /credits,\s*pendingInviteContributors,\s*\.\.\.consentDraftState,\s*isChallenge/);
  assert.ok(reviewSource.includes('/requestUploadReviewCase'));
});

test('cache selection applies current taxonomy eligibility before choosing exact or near candidates', () => {
  assert.match(indexSource, /const findExactUpload = async \(sha256, \{ isCodexActor = false, themes = \[\], makerTags = \[\] \}/);
  assert.match(indexSource, /findExactUpload\(fingerprints\.sha256, \{ isCodexActor, themes: normalizedThemes, makerTags: normalizedMakerTags \}\)/);
  assert.match(indexSource, /findNearDuplicateUpload\(fingerprints, \{ isCodexActor, themes: normalizedThemes, makerTags: normalizedMakerTags, userId \}\)/);
  const exactStart = indexSource.indexOf('const findExactUpload = async');
  const nearStart = indexSource.indexOf('const findNearDuplicateUpload = async');
  assert.ok(indexSource.slice(exactStart, nearStart).includes('hasMatchingReusableModerationTaxonomy({ uploadData, themes, makerTags })'));
  assert.ok(indexSource.slice(nearStart, indexSource.indexOf('const isFingerprintBlocked', nearStart)).includes('hasMatchingReusableModerationTaxonomy({ uploadData, themes, makerTags })'));
});

test('moderation cache reuse never reuses another upload media identity', () => {
  const previewStart = indexSource.indexOf('let persistedPreview = null;');
  const uploadPayloadStart = indexSource.indexOf('const uploadPayload = {', previewStart);
  const previewSource = indexSource.slice(previewStart, uploadPayloadStart);
  assert.ok(previewSource.includes('persistModerationPreview({'));
  assert.ok(previewSource.includes('buffer: parsed.buffer'));
  assert.equal(previewSource.includes('matchedPreviewUrl'), false);
  assert.equal(indexSource.includes('extractStoragePathFromFirebaseUrl'), false);
});

test('review and correction drafts are server-bound to moderated media and sanitized continuity state', () => {
  assert.ok(indexSource.includes('buildPersistedModerationDraftState'));
  const reviewStart = indexSource.indexOf('export const requestUploadReviewCase');
  const reviewEnd = indexSource.indexOf('export const getModerationExamplesForCase', reviewStart);
  const reviewSource = indexSource.slice(reviewStart, reviewEnd);
  assert.ok(reviewSource.includes('buildPersistedModerationDraftState({'));
  assert.ok(reviewSource.includes('upload: uploadData'));
  assert.ok(reviewSource.includes('postDraft = draftState.draft'));
  assert.ok(indexSource.includes('acceptedCorrectionPostDraft = acceptedDraftState.draft'));
});

test('persisted publication binds image and taxonomy to the server moderation upload', () => {
  assert.ok(indexSource.includes('resolveTrustedModeratedImageUrl(latestUpload)'));
  assert.ok(indexSource.includes('buildModeratedPublicationTaxonomy({ upload: latestUpload, postDraft })'));
  assert.ok(indexSource.includes('styles: publicationTaxonomy.themes'));
  assert.ok(indexSource.includes('makerTags: publicationTaxonomy.triggers'));
  assert.ok(indexSource.includes('appliedTriggers: publicationTaxonomy.appliedTriggers'));
  assert.ok(indexSource.includes('moderationUploadId: uploadId'));
  assert.equal(indexSource.includes("String(postDraft?.imageUrl || latestUpload?.imageUrl"), false);
});

test('production publication is server-only while Codex Dev direct publication remains isolated', () => {
  assert.match(appSource, /currentModerationAllowed: nextOutcome === 'allowed'/);
  assert.ok(appSource.includes('const currentModerationUploadId = String(moderationData?.uploadId || reviewUploadId || resumeUpload?.id || \'\').trim();'));
  assert.ok(appSource.includes('if (!codexDevPublication && !persistedModerationPublicationUploadId)'));
  assert.match(indexSource, /postRef = action === 'publishNow' \|\| action === 'repairPublished'/);
});

test('silent moderation must return a concrete server result before publication continues', () => {
  assert.match(appSource, /moderationData = await runAICheck\(\{ silent: true \}\);\s*if \(!moderationData\)/);
});

test('initial review drafts carry pending contributor invites as well as consent state', () => {
  const reviewStart = appSource.indexOf('const handleRequestReview = async () => {');
  const reviewEnd = appSource.indexOf('const getNewCreditMakerFields = useCallback', reviewStart);
  const reviewSource = appSource.slice(reviewStart, reviewEnd);
  assert.ok(reviewSource.includes('pendingInviteContributors'));
});

test('near-duplicate lookup is same-uploader scoped before restrictive history can route', () => {
  const start = indexSource.indexOf('const findNearDuplicateUpload = async');
  const end = indexSource.indexOf('const isFingerprintBlocked', start);
  const nearLookup = indexSource.slice(start, end);
  assert.ok(nearLookup.includes('isNearDuplicateReuseOwnedByUploader({ uploadData, userId })'));
  assert.ok(indexSource.includes('findNearDuplicateUpload(fingerprints, { isCodexActor, themes: normalizedThemes, makerTags: normalizedMakerTags, userId })'));
});
