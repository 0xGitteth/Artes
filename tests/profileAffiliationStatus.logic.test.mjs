import assert from 'node:assert/strict';
import {
  AFFILIATION_STATUSES,
  applyAffiliationStatusTransitions,
  getPublicAffiliationProjectionPatch,
  isApprovedAffiliationStatus,
} from '../src/utils/profileAffiliationStatus.js';

const DELETE = Symbol('delete');
const NOW = Symbol('now');

assert.equal(isApprovedAffiliationStatus(undefined), false, 'missing linkedAgencyStatus is not approved');
assert.equal(isApprovedAffiliationStatus('pending'), false, 'pending linkedAgencyStatus is not approved');
assert.equal(isApprovedAffiliationStatus('approved'), true, 'approved linkedAgencyStatus is approved');
assert.equal(isApprovedAffiliationStatus('verified'), true, 'verified linkedAgencyStatus is approved');
assert.equal(isApprovedAffiliationStatus('rejected'), false, 'rejected linkedAgencyStatus is not approved');
assert.equal(isApprovedAffiliationStatus('removed'), false, 'removed linkedAgencyStatus is not approved');

assert.equal(isApprovedAffiliationStatus(undefined), false, 'missing linkedCompanyStatus is not approved');
assert.equal(isApprovedAffiliationStatus('pending'), false, 'pending linkedCompanyStatus is not approved');
assert.equal(isApprovedAffiliationStatus('approved'), true, 'approved linkedCompanyStatus is approved');
assert.equal(isApprovedAffiliationStatus('verified'), true, 'verified linkedCompanyStatus is approved');
assert.equal(isApprovedAffiliationStatus('rejected'), false, 'rejected linkedCompanyStatus is not approved');
assert.equal(isApprovedAffiliationStatus('removed'), false, 'removed linkedCompanyStatus is not approved');

assert.deepEqual(
  applyAffiliationStatusTransitions(
    { linkedAgencyId: 'agency-a' },
    {},
    { timestamp: NOW, deleteValue: DELETE },
  ),
  {
    linkedAgencyStatus: AFFILIATION_STATUSES.PENDING,
    linkedAgencyStatusUpdatedAt: NOW,
    linkedAgencyApprovedAt: DELETE,
    linkedAgencyApprovedBy: DELETE,
  },
  'new agency link defaults to pending',
);

assert.deepEqual(
  applyAffiliationStatusTransitions(
    { linkedAgencyId: 'agency-b' },
    { linkedAgencyId: 'agency-a', linkedAgencyStatus: 'approved' },
    { timestamp: NOW, deleteValue: DELETE },
  ),
  {
    linkedAgencyStatus: AFFILIATION_STATUSES.PENDING,
    linkedAgencyStatusUpdatedAt: NOW,
    linkedAgencyApprovedAt: DELETE,
    linkedAgencyApprovedBy: DELETE,
  },
  'changing agency id resets status to pending',
);

assert.deepEqual(
  applyAffiliationStatusTransitions(
    { bio: 'new bio' },
    { linkedAgencyId: 'agency-a', linkedAgencyStatus: 'approved' },
    { timestamp: NOW, deleteValue: DELETE },
  ),
  {},
  'editing unrelated profile fields preserves approved agency status by not touching it',
);

assert.deepEqual(
  applyAffiliationStatusTransitions(
    { linkedAgencyId: null },
    { linkedAgencyId: 'agency-a', linkedAgencyStatus: 'approved' },
    { timestamp: NOW, deleteValue: DELETE },
  ),
  {
    linkedAgencyId: null,
    linkedAgencyName: '',
    linkedAgencyStatus: DELETE,
    linkedAgencyStatusUpdatedAt: NOW,
    linkedAgencyApprovedAt: DELETE,
    linkedAgencyApprovedBy: DELETE,
  },
  'removing agency link clears agency status safely',
);

assert.deepEqual(
  applyAffiliationStatusTransitions(
    { linkedCompanyId: 'company-a' },
    {},
    { timestamp: NOW, deleteValue: DELETE },
  ),
  {
    linkedCompanyStatus: AFFILIATION_STATUSES.PENDING,
    linkedCompanyStatusUpdatedAt: NOW,
    linkedCompanyApprovedAt: DELETE,
    linkedCompanyApprovedBy: DELETE,
  },
  'new company link defaults to pending',
);

assert.deepEqual(
  applyAffiliationStatusTransitions(
    { linkedCompanyId: 'company-b' },
    { linkedCompanyId: 'company-a', linkedCompanyStatus: 'approved' },
    { timestamp: NOW, deleteValue: DELETE },
  ),
  {
    linkedCompanyStatus: AFFILIATION_STATUSES.PENDING,
    linkedCompanyStatusUpdatedAt: NOW,
    linkedCompanyApprovedAt: DELETE,
    linkedCompanyApprovedBy: DELETE,
  },
  'changing company id resets status to pending',
);

assert.deepEqual(
  applyAffiliationStatusTransitions(
    { bio: 'new bio' },
    { linkedCompanyId: 'company-a', linkedCompanyStatus: 'approved' },
    { timestamp: NOW, deleteValue: DELETE },
  ),
  {},
  'editing unrelated profile fields preserves approved company status by not touching it',
);

assert.deepEqual(
  applyAffiliationStatusTransitions(
    { linkedCompanyId: null },
    { linkedCompanyId: 'company-a', linkedCompanyStatus: 'approved' },
    { timestamp: NOW, deleteValue: DELETE },
  ),
  {
    linkedCompanyId: null,
    linkedCompanyName: '',
    linkedCompanyStatus: DELETE,
    linkedCompanyStatusUpdatedAt: NOW,
    linkedCompanyApprovedAt: DELETE,
    linkedCompanyApprovedBy: DELETE,
  },
  'removing company link clears company status safely',
);

assert.deepEqual(
  getPublicAffiliationProjectionPatch({
    source: { linkedAgencyName: 'Free text agency', linkedAgencyStatus: 'approved' },
    kind: 'agency',
    deleteValue: DELETE,
  }),
  { linkedAgencyName: 'Free text agency', linkedAgencyStatus: DELETE },
  'linkedAgencyName without linkedAgencyId does not create a public approved affiliation',
);

assert.deepEqual(
  getPublicAffiliationProjectionPatch({
    source: { linkedCompanyName: 'Free text company', linkedCompanyStatus: 'approved' },
    kind: 'company',
    deleteValue: DELETE,
  }),
  { linkedCompanyName: 'Free text company', linkedCompanyStatus: DELETE },
  'linkedCompanyName without linkedCompanyId does not create a public approved affiliation',
);

assert.deepEqual(
  getPublicAffiliationProjectionPatch({
    source: { linkedAgencyId: null },
    existingPublic: { linkedAgencyId: 'agency-a', linkedAgencyName: 'Agency A', linkedAgencyStatus: 'approved' },
    kind: 'agency',
    deleteValue: DELETE,
  }),
  { linkedAgencyId: null, linkedAgencyName: '', linkedAgencyStatus: DELETE },
  'clearing approved agency link removes public approved projection',
);

assert.deepEqual(
  getPublicAffiliationProjectionPatch({
    source: { linkedCompanyId: null },
    existingPublic: { linkedCompanyId: 'company-a', linkedCompanyName: 'Company A', linkedCompanyStatus: 'approved' },
    kind: 'company',
    deleteValue: DELETE,
  }),
  { linkedCompanyId: null, linkedCompanyName: '', linkedCompanyStatus: DELETE },
  'clearing approved company link removes public approved projection',
);

console.log('profileAffiliationStatus logic tests passed');
