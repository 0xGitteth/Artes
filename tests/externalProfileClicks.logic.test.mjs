import assert from 'node:assert/strict';
import { getPostCreditRows } from '../src/utils/postCredits.js';
import { getManagedProfileBio, getManagedProfileTypeLabel } from '../src/utils/managedProfiles.js';

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


const externalPostWithSelfCredit = {
  ...externalCompanyPost,
  credits: [
    { role: 'photographer', name: 'Owner User', uid: 'owner_user', isSelf: true },
    { role: 'model', name: 'Model One', uid: 'model_user' },
  ],
};
const [externalSelfAuthorRow, externalContributorRow] = getPostCreditRows(externalPostWithSelfCredit);
assert.equal(externalSelfAuthorRow.name, 'Studio X', 'Existing self author credit shows the external authorName instead of the owner credit name');
assert.equal(externalSelfAuthorRow.publicProfileId, 'company_profile', 'Existing self author credit keeps external public profile id');
assert.equal(externalSelfAuthorRow.ownerUid, 'owner_user', 'Existing self author credit keeps owner uid for internal ownership');
assert.equal(externalContributorRow.name, 'Model One', 'Contributor credit keeps its own display name on an external post');
assert.equal(externalContributorRow.publicProfileId, null, 'Contributor credit is not remapped to external authorProfileId');
assert.equal(externalContributorRow.uid, 'model_user', 'Contributor credit keeps its own click target');

const [personalSelfAuthorRow] = getPostCreditRows({
  authorId: 'owner_user',
  authorUid: 'owner_user',
  authorOwnerUid: 'owner_user',
  authorProfileId: 'owner_user',
  authorName: 'Owner User',
  credits: [{ role: 'photographer', name: 'Owner User', uid: 'owner_user', isSelf: true }],
});
assert.equal(personalSelfAuthorRow.name, 'Owner User', 'Personal self author credit keeps its personal credit name');
assert.equal(personalSelfAuthorRow.publicProfileId, null, 'Personal self author credit does not receive an external public profile id');
assert.equal(personalSelfAuthorRow.uid, 'owner_user', 'Personal self author credit keeps opening the personal quick profile');

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
assert.equal(getManagedProfileBio({ type: 'company', bio: 'Quick profile omschrijving' }), 'Quick profile omschrijving', 'External quick profile bio copy resolves from the managed profile');
assert.equal(getManagedProfileBio({ type: 'agency' }), '', 'External quick profile keeps the empty state for old profiles without bio');

console.log('PASS externalProfileClicks.logic.test');
