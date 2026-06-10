import assert from 'node:assert/strict';
import { getPostCreditRows } from '../src/utils/postCredits.js';
import { getManagedProfileTypeLabel } from '../src/utils/managedProfiles.js';

const externalCompanyPost = {
  authorId: 'owner_user',
  authorUid: 'owner_user',
  authorOwnerUid: 'owner_user',
  authorProfileId: 'company_profile',
  authorName: 'Studio X',
  authorRole: 'company',
};

const [companyAuthorRow] = getPostCreditRows(externalCompanyPost);
assert.equal(companyAuthorRow.uid, 'owner_user', 'External author row keeps owner uid for safe personal fallback');
assert.equal(companyAuthorRow.publicProfileId, 'company_profile', 'External author row exposes public profile id for click handling');
assert.equal(companyAuthorRow.ownerUid, 'owner_user', 'External author row keeps owner uid separate from public profile id');

const [personalAuthorRow] = getPostCreditRows({
  authorId: 'owner_user',
  authorUid: 'owner_user',
  authorOwnerUid: 'owner_user',
  authorProfileId: 'owner_user',
  authorName: 'Owner User',
});
assert.equal(personalAuthorRow.publicProfileId, null, 'Personal authorProfileId does not become an external public profile click target');
assert.equal(personalAuthorRow.uid, 'owner_user', 'Personal posts keep the existing user click target');

const [legacyAuthorRow] = getPostCreditRows({ authorId: 'owner_user', authorName: 'Legacy Owner' });
assert.equal(legacyAuthorRow.publicProfileId, null, 'Legacy posts without authorProfileId keep existing personal fallback');
assert.equal(legacyAuthorRow.uid, 'owner_user', 'Legacy posts remain clickable via owner uid');

assert.equal(getManagedProfileTypeLabel({ type: 'company' }), 'Bedrijfsprofiel', 'Bedrijfsprofiel label is correct');
assert.equal(getManagedProfileTypeLabel({ type: 'agency' }), 'Agency', 'Agency label is correct');
assert.equal(getManagedProfileTypeLabel({ type: 'collective' }), 'Collectief', 'Collectief label is correct');

console.log('PASS externalProfileClicks.logic.test');
