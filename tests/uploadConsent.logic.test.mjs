import assert from 'node:assert/strict';
import {
  CONSENT_EXCEPTION_REASONS,
  CONTRIBUTOR_CONSENT_STATUSES,
  MISSING_MAKER_PROMPT_RESOLVED_BY,
  VISIBLE_PERSON_PROMPT_REASONS,
  VISIBLE_PERSON_PROMPT_RESOLVED_BY,
  buildUploadConsent,
  getMakerCreditIndex,
  getSelfMakerRoles,
  getMissingMakerPromptState,
  getVisiblePersonPromptState,
  hasMakerCredit,
  hasVisibleSubjectCredit,
  normalizeCreditAfterRoleChange,
  sanitizePostCreditForWrite,
  validateUploadConsent,
} from '../src/utils/uploadConsent.js';

assert.deepEqual(getSelfMakerRoles(['model', 'photographer', 'mua']), ['photographer']);
assert.equal(hasMakerCredit([{ role: 'model' }, { role: 'mua' }]), false, 'model plus MUA is not a maker credit');
assert.equal(hasMakerCredit([{ role: 'artist' }]), true, 'artist is an allowed maker role');
assert.equal(getMakerCreditIndex([{ role: 'model' }, { role: 'retoucher' }]), 1, 'maker index points at first maker credit');
assert.equal(getMakerCreditIndex([{ role: 'model' }, { role: 'mua' }]), -1, 'missing maker credit has no maker index');
assert.equal(hasVisibleSubjectCredit([{ role: 'model' }]), true, 'model is a visible subject role');

const sanitizedExternalCredit = sanitizePostCreditForWrite({
  role: 'model',
  name: 'External Contributor',
  contributorId: 'contributor_1',
  instagramHandle: 'artist',
  website: 'example.com',
  email: 'private@example.com',
  proofData: { emailVerified: true },
  claimCode: 'secret',
  isExternal: true,
  consentStatus: CONTRIBUTOR_CONSENT_STATUSES.PENDING,
});
assert.equal(sanitizedExternalCredit.email, undefined, 'post credit sanitization removes email');
assert.equal(sanitizedExternalCredit.proofData, undefined, 'post credit sanitization removes proof data');
assert.equal(sanitizedExternalCredit.claimCode, undefined, 'post credit sanitization removes claim verification fields');
assert.equal(sanitizedExternalCredit.instagramHandle, 'artist', 'post credit sanitization keeps public instagram handle');
assert.equal(sanitizedExternalCredit.website, 'example.com', 'post credit sanitization keeps public website');

assert.deepEqual(
  normalizeCreditAfterRoleChange({ role: 'photographer', isMaker: true, makerFunction: 'photographer' }, 'model'),
  { role: 'model', isMaker: false, makerFunction: '' },
  'changing role photographer -> model clears isMaker and makerFunction',
);
assert.deepEqual(
  normalizeCreditAfterRoleChange({ role: 'photographer', isMaker: true, makerFunction: 'photographer' }, 'mua'),
  { role: 'mua', isMaker: false, makerFunction: '' },
  'changing role photographer -> MUA clears isMaker and makerFunction',
);
assert.deepEqual(
  normalizeCreditAfterRoleChange({ role: 'photographer', isMaker: true, makerFunction: 'photographer' }, 'agency'),
  { role: 'agency', isMaker: false, makerFunction: '' },
  'changing role photographer -> agency clears isMaker and makerFunction',
);
assert.deepEqual(
  normalizeCreditAfterRoleChange({ role: 'model', isMaker: false, makerFunction: '' }, 'photographer'),
  { role: 'photographer', isMaker: true, makerFunction: 'photographer' },
  'changing role model -> photographer sets isMaker true and makerFunction photographer',
);
const modelRoleAfterReset = normalizeCreditAfterRoleChange({ role: 'photographer', isMaker: true, makerFunction: 'photographer' }, 'model');
const explicitModelMakerAfterReset = { ...modelRoleAfterReset, isMaker: true, makerFunction: 'photographer' };
assert.equal(hasMakerCredit([explicitModelMakerAfterReset]), true, 'explicitly marking a non-maker role as maker still works after role change');
assert.equal(getMakerCreditIndex([{ role: 'model' }, explicitModelMakerAfterReset]), 1, 'makerCreditIndex points only to the actual explicit maker credit');

const missingMaker = validateUploadConsent({
  credits: [{ role: 'model', isSelf: true }],
  uploaderRole: 'model',
  profileRoles: ['model'],
});
assert.equal(typeof missingMaker.maker, 'string');

const validSelfMaker = validateUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['photographer', 'model'],
});
assert.deepEqual(validSelfMaker, {});

const modelUploaderMissingMakerPrompt = getMissingMakerPromptState({
  credits: [{ role: 'model', isSelf: true }],
  uploaderRole: 'model',
  profileRoles: ['model'],
});
assert.equal(modelUploaderMissingMakerPrompt.shouldShowMissingMakerPrompt, true, 'model uploader + no maker credit shows missing-maker warning');
assert.equal(modelUploaderMissingMakerPrompt.missingMakerPromptResolved, false);
assert.equal(typeof validateUploadConsent({
  credits: [{ role: 'model', isSelf: true }],
  uploaderRole: 'model',
  profileRoles: ['model'],
}).maker, 'string', 'publish validation blocks while no maker credit exists');

const photographerContributorResolvesMakerPrompt = getMissingMakerPromptState({
  credits: [{ role: 'model', isSelf: true }, { role: 'photographer', name: 'Photographer' }],
  uploaderRole: 'model',
  profileRoles: ['model'],
  missingMakerPromptShown: true,
});
assert.equal(photographerContributorResolvesMakerPrompt.shouldShowMissingMakerPrompt, false, 'model uploader + photographer contributor resolves warning');
assert.equal(photographerContributorResolvesMakerPrompt.missingMakerPromptResolved, true);
assert.equal(photographerContributorResolvesMakerPrompt.missingMakerResolvedBy, MISSING_MAKER_PROMPT_RESOLVED_BY.TAGGED_CONTRIBUTOR);
assert.equal(validateUploadConsent({
  credits: [{ role: 'model', isSelf: true }, { role: 'photographer', name: 'Photographer' }],
  uploaderRole: 'model',
  profileRoles: ['model'],
}).maker, undefined);

const anonymousPhotographerResolvesMakerPrompt = getMissingMakerPromptState({
  credits: [{ role: 'model', isSelf: true }, { role: 'photographer', name: 'Anonieme maker', isAnonymous: true }],
  uploaderRole: 'model',
  profileRoles: ['model'],
  missingMakerPromptShown: true,
});
assert.equal(anonymousPhotographerResolvesMakerPrompt.missingMakerPromptResolved, true, 'model uploader + anonymous photographer resolves warning');
assert.equal(anonymousPhotographerResolvesMakerPrompt.missingMakerResolvedBy, MISSING_MAKER_PROMPT_RESOLVED_BY.ANONYMOUS_CONTRIBUTOR);

const validSelfTaggedMakerPrompt = getMissingMakerPromptState({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['model', 'photographer'],
  missingMakerPromptShown: true,
});
assert.equal(validSelfTaggedMakerPrompt.missingMakerPromptResolved, true, 'self tagging as maker resolves if maker role exists in profile roles');
assert.equal(validSelfTaggedMakerPrompt.missingMakerResolvedBy, MISSING_MAKER_PROMPT_RESOLVED_BY.SELF_TAGGED_MAKER);
assert.equal(validateUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['model', 'photographer'],
}).maker, undefined);
const inProfileSelfMakerConsent = buildUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['model', 'photographer'],
  missingMakerPromptShown: true,
  missingMakerPromptResolvedAt: '2026-05-06T00:00:00.000Z',
});
assert.equal(inProfileSelfMakerConsent.missingMakerPromptResolved, true, 'self maker credit with maker role already in profileRoles resolves without extra outside-profile warning');
assert.equal(inProfileSelfMakerConsent.selfMakerRoleOutsideProfile, false);

const unconfirmedOutsideProfileSelfMakerPrompt = getMissingMakerPromptState({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['model'],
  missingMakerPromptShown: true,
});
assert.equal(unconfirmedOutsideProfileSelfMakerPrompt.missingMakerPromptResolved, false, 'self maker credit without confirmation does not resolve when role is outside profileRoles');
assert.equal(typeof validateUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['model'],
}).selfRole, 'string');

const confirmedModelSelfPhotographerPrompt = getMissingMakerPromptState({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['model'],
  missingMakerPromptShown: true,
  selfMakerRoleConfirmed: true,
  selfMakerRole: 'photographer',
});
assert.equal(confirmedModelSelfPhotographerPrompt.missingMakerPromptResolved, true, 'model profile role + self photographer credit + confirmation resolves missing-maker warning');
assert.equal(confirmedModelSelfPhotographerPrompt.missingMakerResolvedBy, MISSING_MAKER_PROMPT_RESOLVED_BY.SELF_TAGGED_MAKER);
assert.deepEqual(validateUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['model'],
  selfMakerRoleConfirmed: true,
  selfMakerRole: 'photographer',
}), {});

const confirmedMuaSelfPhotographerPrompt = getMissingMakerPromptState({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['mua'],
  missingMakerPromptShown: true,
  selfMakerRoleConfirmed: true,
  selfMakerRole: 'photographer',
});
assert.equal(confirmedMuaSelfPhotographerPrompt.missingMakerPromptResolved, true, 'MUA profile role + self photographer credit + confirmation resolves missing-maker warning');
assert.equal(confirmedMuaSelfPhotographerPrompt.missingMakerResolvedBy, MISSING_MAKER_PROMPT_RESOLVED_BY.SELF_TAGGED_MAKER);
assert.deepEqual(validateUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['mua'],
  selfMakerRoleConfirmed: true,
  selfMakerRole: 'photographer',
}), {});

const originalProfileRoles = ['model'];
const profileRolesAfterConfirmation = [...originalProfileRoles];
getMissingMakerPromptState({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: profileRolesAfterConfirmation,
  selfMakerRoleConfirmed: true,
  selfMakerRole: 'photographer',
});
assert.deepEqual(profileRolesAfterConfirmation, originalProfileRoles, 'profileRoles are not modified by this flow');

const subjectOnlyMakerPrompt = getMissingMakerPromptState({
  credits: [{ role: 'model', name: 'Model' }, { role: 'mua', name: 'MUA' }, { role: 'stylist', name: 'Stylist' }],
  uploaderRole: 'model',
  profileRoles: ['model'],
});
assert.equal(subjectOnlyMakerPrompt.shouldShowMissingMakerPrompt, true, 'model/MUA/stylist-only credits do not resolve warning');
assert.equal(subjectOnlyMakerPrompt.missingMakerPromptResolved, false);

const stylistSelfMakerPrompt = getMissingMakerPromptState({
  credits: [{ role: 'stylist', isSelf: true, isMaker: true, makerFunction: 'photographer' }],
  uploaderRole: 'stylist',
  profileRoles: ['stylist'],
  missingMakerPromptShown: true,
  selfMakerRoleConfirmed: true,
  selfMakerRole: 'photographer',
});
assert.equal(stylistSelfMakerPrompt.missingMakerPromptResolved, true, 'stylist account role can self-credit as maker after confirmation');
assert.equal(stylistSelfMakerPrompt.missingMakerResolvedBy, MISSING_MAKER_PROMPT_RESOLVED_BY.SELF_TAGGED_MAKER);

const agencyWithoutMakerFunctionPrompt = getMissingMakerPromptState({
  credits: [{ role: 'agency', name: 'Agency' }],
  uploaderRole: 'agency',
  profileRoles: ['agency'],
});
assert.equal(agencyWithoutMakerFunctionPrompt.missingMakerPromptResolved, false, 'agency/company generic credit does not resolve without explicit maker function');

const agencyRightsHolderPrompt = getMissingMakerPromptState({
  credits: [{ role: 'agency', name: 'Agency', isMaker: true, makerFunction: 'rightsHolder' }],
  uploaderRole: 'agency',
  profileRoles: ['agency'],
});
assert.equal(agencyRightsHolderPrompt.missingMakerPromptResolved, true, 'agency can be credited as maker when explicitly marked as rights holder');
assert.equal(agencyRightsHolderPrompt.missingMakerResolvedBy, MISSING_MAKER_PROMPT_RESOLVED_BY.TAGGED_CONTRIBUTOR);

const companyProductionOwnerPrompt = getMissingMakerPromptState({
  credits: [{ role: 'company', name: 'Company', isMaker: true, makerFunction: 'productionOwner' }],
  uploaderRole: 'company',
  profileRoles: ['company'],
});
assert.equal(companyProductionOwnerPrompt.missingMakerPromptResolved, true, 'company can be credited as maker when explicitly marked as production owner');

const modelWithUnmarkedMakerFunctionPrompt = getMissingMakerPromptState({
  credits: [{ role: 'model', name: 'Model', makerFunction: 'photographer' }],
  uploaderRole: 'model',
  profileRoles: ['model'],
});
assert.equal(modelWithUnmarkedMakerFunctionPrompt.missingMakerPromptResolved, false, 'makerFunction without explicit isMaker does not satisfy maker requirement for generic roles');

const anonymousExplicitMakerPrompt = getMissingMakerPromptState({
  credits: [{ role: 'model', name: 'Anonieme maker', isAnonymous: true, isMaker: true, makerFunction: 'maker' }],
  uploaderRole: 'model',
  profileRoles: ['model'],
  missingMakerPromptShown: true,
});
assert.equal(anonymousExplicitMakerPrompt.missingMakerPromptResolved, true, 'anonymous maker still works with explicit maker function');
assert.equal(anonymousExplicitMakerPrompt.missingMakerResolvedBy, MISSING_MAKER_PROMPT_RESOLVED_BY.ANONYMOUS_CONTRIBUTOR);

const unresolvedVisiblePersonPrompt = validateUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['photographer'],
  aiPeoplePresent: true,
});
assert.equal(typeof unresolvedVisiblePersonPrompt.visiblePersonPrompt, 'string', 'maker uploader + AI visible-person suggestion + no subject contributor triggers the prompt');
assert.match(unresolvedVisiblePersonPrompt.visiblePersonPrompt, /lijkt mogelijk/, 'AI visible-person signal is worded as a suggestion, not certainty');

const promptState = getVisiblePersonPromptState({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  aiPeoplePresent: true,
});
assert.equal(promptState.visiblePersonPromptShown, true);
assert.equal(promptState.visiblePersonPromptReason, VISIBLE_PERSON_PROMPT_REASONS.MAKER_AI_VISIBLE_PERSON_NO_SUBJECT);
assert.equal(promptState.unresolved, true);
assert.equal(promptState.resolvedBy, null);

const subjectContributorResolved = validateUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }, { role: 'model', name: 'Subject' }],
  uploaderRole: 'photographer',
  profileRoles: ['photographer'],
  aiPeoplePresent: true,
});
assert.equal(subjectContributorResolved.visiblePersonPrompt, undefined, 'model/subject contributor present resolves the prompt');
assert.equal(getVisiblePersonPromptState({
  credits: [{ role: 'photographer', isSelf: true }, { role: 'model', name: 'Subject' }],
  uploaderRole: 'photographer',
  aiPeoplePresent: true,
}).resolvedBy, VISIBLE_PERSON_PROMPT_RESOLVED_BY.TAGGED_CONTRIBUTOR);

const anonymousContributorState = getVisiblePersonPromptState({
  credits: [{ role: 'photographer', isSelf: true }, { role: 'model', name: 'Anonieme bijdrager', isAnonymous: true }],
  uploaderRole: 'photographer',
  aiPeoplePresent: true,
});
assert.equal(anonymousContributorState.unresolved, false, 'anonymous contributor resolves the prompt');
assert.equal(anonymousContributorState.resolvedBy, VISIBLE_PERSON_PROMPT_RESOLVED_BY.ANONYMOUS_CONTRIBUTOR);
assert.equal(anonymousContributorState.anonymousContributorUsed, true);

const exceptionState = getVisiblePersonPromptState({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  aiPeoplePresent: true,
  exception: { enabled: true, type: CONSENT_EXCEPTION_REASONS.DOCUMENTARY, reason: '' },
});
assert.equal(exceptionState.unresolved, false, 'street/press/documentary exception resolves the prompt');
assert.equal(exceptionState.resolvedBy, VISIBLE_PERSON_PROMPT_RESOLVED_BY.EXCEPTION);
assert.equal(exceptionState.selectedExceptionReason, CONSENT_EXCEPTION_REASONS.DOCUMENTARY);
assert.equal(validateUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['photographer'],
  aiPeoplePresent: true,
  exception: { enabled: true, type: CONSENT_EXCEPTION_REASONS.STREET, reason: '' },
}).visiblePersonPrompt, undefined);

const notApplicableState = getVisiblePersonPromptState({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  aiPeoplePresent: true,
  userAcknowledgedVisiblePersonPrompt: true,
});
assert.equal(notApplicableState.unresolved, false, 'explicit not applicable resolves the prompt');
assert.equal(notApplicableState.resolvedBy, VISIBLE_PERSON_PROMPT_RESOLVED_BY.NOT_APPLICABLE);

const nonMakerUploaderValidation = validateUploadConsent({
  credits: [{ role: 'artist', name: 'Maker' }, { role: 'model', isSelf: true }],
  uploaderRole: 'model',
  profileRoles: ['model'],
  aiPeoplePresent: true,
});
assert.equal(nonMakerUploaderValidation.visiblePersonPrompt, undefined, 'non-maker uploader role does not show maker-specific wording');
assert.equal(getVisiblePersonPromptState({
  credits: [{ role: 'artist', name: 'Maker' }, { role: 'model', isSelf: true }],
  uploaderRole: 'model',
  aiPeoplePresent: true,
}).visiblePersonPromptShown, false);

const consent = buildUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }, { role: 'model', name: 'Temporary' }],
  uploaderRole: 'photographer',
  aiPeoplePresent: true,
  subjectWarningAcknowledged: false,
  visiblePersonPromptResolvedAt: '2026-05-06T00:00:00.000Z',
});
assert.equal(consent.hasMaker, true);
assert.equal(consent.makerCreditIndex, 0);
assert.equal(consent.hasVisibleSubject, true);
assert.equal(consent.audit[0].pendingConsentCount, 1);
assert.equal(consent.visiblePersonPromptShown, true);
assert.equal(consent.visiblePersonPromptReason, VISIBLE_PERSON_PROMPT_REASONS.MAKER_AI_VISIBLE_PERSON_NO_SUBJECT);
assert.equal(consent.userAcknowledgedVisiblePersonPrompt, false);
assert.equal(consent.selectedExceptionReason, null);
assert.equal(consent.anonymousContributorUsed, false);
assert.equal(consent.resolvedBy, VISIBLE_PERSON_PROMPT_RESOLVED_BY.TAGGED_CONTRIBUTOR);
assert.equal(consent.resolvedAt, '2026-05-06T00:00:00.000Z');
assert.equal(consent.audit[0].resolvedBy, VISIBLE_PERSON_PROMPT_RESOLVED_BY.TAGGED_CONTRIBUTOR, 'consent metadata records the resolution');
assert.equal(consent.audit[0].resolvedAt, '2026-05-06T00:00:00.000Z');

const missingMakerResolutionConsent = buildUploadConsent({
  credits: [{ role: 'model', isSelf: true }, { role: 'photographer', name: 'Photographer' }],
  uploaderRole: 'model',
  profileRoles: ['model'],
  missingMakerPromptShown: true,
  missingMakerPromptResolvedAt: '2026-05-06T00:00:00.000Z',
});
assert.equal(missingMakerResolutionConsent.missingMakerPromptShown, true);
assert.equal(missingMakerResolutionConsent.missingMakerPromptResolved, true);
assert.equal(missingMakerResolutionConsent.missingMakerResolvedBy, MISSING_MAKER_PROMPT_RESOLVED_BY.TAGGED_CONTRIBUTOR);
assert.equal(missingMakerResolutionConsent.missingMakerResolvedAt, '2026-05-06T00:00:00.000Z');
assert.equal(missingMakerResolutionConsent.audit[0].missingMakerResolvedBy, MISSING_MAKER_PROMPT_RESOLVED_BY.TAGGED_CONTRIBUTOR);

const confirmedSelfMakerConsent = buildUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['model'],
  missingMakerPromptShown: true,
  missingMakerPromptResolvedAt: '2026-05-06T00:00:00.000Z',
  selfMakerRoleConfirmed: true,
  selfMakerRole: 'photographer',
  selfMakerRoleConfirmedAt: '2026-05-06T00:00:00.000Z',
});
assert.equal(confirmedSelfMakerConsent.hasMaker, true);
assert.equal(confirmedSelfMakerConsent.makerCreditIndex, 0, 'makerCreditIndex points to the self maker credit');
assert.equal(confirmedSelfMakerConsent.missingMakerResolvedBy, MISSING_MAKER_PROMPT_RESOLVED_BY.SELF_TAGGED_MAKER);
assert.equal(confirmedSelfMakerConsent.selfMakerRoleConfirmed, true);
assert.equal(confirmedSelfMakerConsent.selfMakerRole, 'photographer');
assert.equal(confirmedSelfMakerConsent.selfMakerRoleOutsideProfile, true);
assert.equal(confirmedSelfMakerConsent.selfMakerRoleConfirmedAt, '2026-05-06T00:00:00.000Z');
assert.equal(confirmedSelfMakerConsent.audit[0].selfMakerRoleOutsideProfile, true);

const agencyRightsHolderConsent = buildUploadConsent({
  credits: [{ role: 'agency', name: 'Agency', isMaker: true, makerFunction: 'rightsHolder' }],
  uploaderRole: 'agency',
  profileRoles: ['agency'],
  missingMakerPromptShown: true,
  missingMakerPromptResolvedAt: '2026-05-06T00:00:00.000Z',
});
assert.equal(agencyRightsHolderConsent.hasMaker, true);
assert.equal(agencyRightsHolderConsent.makerCreditIndex, 0, 'makerCreditIndex points to the actual explicit maker credit');
assert.equal(agencyRightsHolderConsent.missingMakerPromptResolved, true);
assert.equal(agencyRightsHolderConsent.audit[0].makerCount, 1);

const externalPhotographerConsent = buildUploadConsent({
  credits: [{ role: 'photographer', name: 'External Photographer' }],
  uploaderRole: 'model',
  profileRoles: ['model'],
});
assert.equal(externalPhotographerConsent.hasMaker, true, 'external photographer maker still works');
assert.equal(externalPhotographerConsent.makerCreditIndex, 0);
assert.equal(externalPhotographerConsent.audit[0].makerCount, 1);

const anonymousResolutionConsent = buildUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }, { role: 'model', name: 'Anonieme bijdrager', isAnonymous: true }],
  uploaderRole: 'photographer',
  aiPeoplePresent: true,
  visiblePersonPromptResolvedAt: '2026-05-06T00:00:00.000Z',
});
assert.equal(anonymousResolutionConsent.anonymousContributorUsed, true);
assert.equal(anonymousResolutionConsent.resolvedBy, VISIBLE_PERSON_PROMPT_RESOLVED_BY.ANONYMOUS_CONTRIBUTOR);
assert.equal(anonymousResolutionConsent.audit[0].anonymousContributorUsed, true);

const exceptionResolutionConsent = buildUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  aiPeoplePresent: true,
  exception: { enabled: true, type: CONSENT_EXCEPTION_REASONS.PRESS, reason: '' },
  visiblePersonPromptResolvedAt: '2026-05-06T00:00:00.000Z',
});
assert.equal(exceptionResolutionConsent.selectedExceptionReason, CONSENT_EXCEPTION_REASONS.PRESS);
assert.equal(exceptionResolutionConsent.resolvedBy, VISIBLE_PERSON_PROMPT_RESOLVED_BY.EXCEPTION);

const notApplicableConsent = buildUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  aiPeoplePresent: true,
  subjectWarningAcknowledged: true,
  visiblePersonPromptResolvedAt: '2026-05-06T00:00:00.000Z',
});
assert.equal(notApplicableConsent.userAcknowledgedVisiblePersonPrompt, true);
assert.equal(notApplicableConsent.resolvedBy, VISIBLE_PERSON_PROMPT_RESOLVED_BY.NOT_APPLICABLE);

const streetConsent = buildUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }, { role: 'model', name: 'Anonymous', isAnonymous: true }],
  uploaderRole: 'photographer',
  exception: { enabled: true, type: 'streetPhotography', reason: 'Crowd in public square' },
});
assert.equal(streetConsent.makerCreditIndex, 0);
assert.equal(streetConsent.exception.type, 'streetPhotography');
assert.equal(streetConsent.consentStatuses.includes(CONTRIBUTOR_CONSENT_STATUSES.PRESS_OR_STREET_EXCEPTION), true);

const appendedMakerConsent = buildUploadConsent({
  credits: Array.from({ length: 10 }, (_, index) => ({ role: index % 2 === 0 ? 'model' : 'mua', name: `Non-maker ${index}` }))
    .concat({ role: 'videographer', name: 'Late maker' }),
});
assert.equal(appendedMakerConsent.hasMaker, true);
assert.equal(appendedMakerConsent.makerCreditIndex, 10, 'existing makerCreditIndex logic still works for appended maker');

const anonymousMakerConsent = buildUploadConsent({
  credits: [{ role: 'model', name: 'Subject' }, { role: 'artist', name: 'Anonymous maker', isAnonymous: true }],
});
assert.equal(anonymousMakerConsent.hasMaker, true);
assert.equal(anonymousMakerConsent.makerCreditIndex, 1, 'existing makerCreditIndex logic still works for anonymous maker');

const noMakerConsent = buildUploadConsent({
  credits: [{ role: 'model', name: 'Subject' }, { role: 'mua', name: 'Makeup' }],
});
assert.equal(noMakerConsent.hasMaker, false);
assert.equal(noMakerConsent.makerCreditIndex, -1, 'existing makerCreditIndex logic still works when missing maker');

console.log('PASS uploadConsent.logic.test');
