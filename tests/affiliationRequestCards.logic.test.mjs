import assert from 'node:assert/strict';
import {
  buildAffiliationRequestMessagePayload,
  deriveAffiliationRequestCardState,
  getAffiliationRequestMessageId,
  getAffiliationRequestThreadId,
  shouldCreateAffiliationRequestCard,
} from '../src/utils/affiliationRequestCards.js';

const agencyMessage = buildAffiliationRequestMessagePayload({
  requesterUid: 'talent_1',
  organizationUid: 'agency_1',
  affiliationType: 'agency',
  requesterName: 'Talent One',
  organizationName: 'Agency One',
  createdAt: 'now',
  updatedAt: 'now',
});

assert.equal(getAffiliationRequestThreadId('agency_1', 'talent_1'), 'dm_agency_1_talent_1');
assert.equal(getAffiliationRequestThreadId('talent_1', 'agency_1'), 'dm_agency_1_talent_1');
assert.equal(getAffiliationRequestMessageId({ requesterUid: 'talent_1', organizationUid: 'agency_1', affiliationType: 'agency' }), 'affiliation_agency_talent_1_agency_1');
assert.equal(agencyMessage.text, 'Talent One wil gekoppeld worden aan Agency One als Talent.');
assert.equal(agencyMessage.statusSnapshot, 'pending');

assert.equal(shouldCreateAffiliationRequestCard({
  affiliationType: 'agency',
  existing: {},
  next: { linkedAgencyId: 'agency_1', linkedAgencyStatus: 'pending' },
}), true, 'creating a new agency pending request produces a card');
assert.equal(shouldCreateAffiliationRequestCard({
  affiliationType: 'agency',
  existing: { linkedAgencyId: 'agency_1', linkedAgencyStatus: 'pending' },
  next: { linkedAgencyId: 'agency_1', linkedAgencyStatus: 'pending', bio: 'Updated' },
}), false, 'unrelated profile edit does not duplicate agency cards');
assert.equal(shouldCreateAffiliationRequestCard({
  affiliationType: 'agency',
  existing: { linkedAgencyId: 'agency_1', linkedAgencyStatus: 'pending' },
  next: { linkedAgencyId: 'agency_2', linkedAgencyStatus: 'pending' },
}), true, 'changing agency creates a new card');
assert.equal(shouldCreateAffiliationRequestCard({
  affiliationType: 'agency',
  existing: { linkedAgencyId: 'agency_1', linkedAgencyStatus: 'pending' },
  next: { linkedAgencyId: null },
}), false, 'clearing agency does not create a card');
assert.equal(shouldCreateAffiliationRequestCard({
  affiliationType: 'company',
  existing: {},
  next: { linkedCompanyId: 'company_1', linkedCompanyStatus: 'pending' },
}), true, 'creating a new company pending request produces a card');
assert.equal(shouldCreateAffiliationRequestCard({
  affiliationType: 'company',
  existing: { linkedCompanyId: 'company_1', linkedCompanyStatus: 'pending' },
  next: { linkedCompanyId: 'company_1', linkedCompanyStatus: 'pending', bio: 'Updated' },
}), false, 'unrelated profile edit does not duplicate company cards');

assert.deepEqual(deriveAffiliationRequestCardState({
  message: agencyMessage,
  requesterProfile: { linkedAgencyId: 'agency_1', linkedAgencyStatus: 'pending' },
  viewerUid: 'agency_1',
}).ownerCanApprove, true, 'owner sees Goedkeuren for pending agency cards');
assert.equal(deriveAffiliationRequestCardState({
  message: agencyMessage,
  requesterProfile: { linkedAgencyId: 'agency_1', linkedAgencyStatus: 'pending' },
  viewerUid: 'agency_1',
}).ownerCanReject, true, 'owner sees Afwijzen for pending agency cards');
assert.equal(deriveAffiliationRequestCardState({
  message: agencyMessage,
  requesterProfile: { linkedAgencyId: 'agency_1', linkedAgencyStatus: 'approved' },
  viewerUid: 'agency_1',
}).removeLabel, 'Verwijderen uit Talent', 'approved agency card uses Talent removal copy');
assert.equal(deriveAffiliationRequestCardState({
  message: { ...agencyMessage, affiliationType: 'company', organizationUid: 'company_1' },
  requesterProfile: { linkedCompanyId: 'company_1', linkedCompanyStatus: 'approved' },
  viewerUid: 'company_1',
}).removeLabel, 'Verwijderen uit Team', 'approved company card uses Team removal copy');
assert.equal(deriveAffiliationRequestCardState({
  message: agencyMessage,
  requesterProfile: { linkedAgencyId: 'agency_1', linkedAgencyStatus: 'rejected' },
  viewerUid: 'agency_1',
}).inactiveText, 'De aanvraag is afgewezen.', 'rejected is inactive');
assert.equal(deriveAffiliationRequestCardState({
  message: { ...agencyMessage, statusSnapshot: 'approved' },
  requesterProfile: { linkedAgencyId: null },
  viewerUid: 'agency_1',
}).inactiveText, 'De koppeling is verwijderd.', 'removed is inactive');
assert.equal(deriveAffiliationRequestCardState({
  message: agencyMessage,
  requesterProfile: { linkedAgencyId: 'agency_1', linkedAgencyStatus: 'pending' },
  viewerUid: 'talent_1',
}).ownerCanApprove, false, 'requesting user cannot approve');
assert.equal(deriveAffiliationRequestCardState({
  message: agencyMessage,
  requesterProfile: { linkedAgencyId: 'agency_1', linkedAgencyStatus: 'pending' },
  viewerUid: 'other_1',
}).ownerCanApprove, false, 'unrelated viewer cannot approve');

console.log('affiliationRequestCards logic tests passed');
