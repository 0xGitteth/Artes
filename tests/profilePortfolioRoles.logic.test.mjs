import assert from 'node:assert/strict';
import {
  ALL_PROFILE_PORTFOLIO_TAB,
  filterProfilePostsByRole,
  getEligibleProfilePosts,
  getProfilePortfolioTabs,
  getProfilePostRoleKeys,
} from '../src/utils/profilePortfolioRoles.js';

const profile = (roles = ['model'], overrides = {}) => ({
  uid: 'user-1',
  contributorId: 'contrib-1',
  roles,
  ...overrides,
});
const post = (overrides = {}) => ({ id: 'post', authorId: 'user-2', credits: [], ...overrides });
const tabKeys = (posts, profileUser = profile()) => getProfilePortfolioTabs(posts, profileUser).map((tab) => tab.key);
const eligibleIds = (posts, profileUser = profile()) => getEligibleProfilePosts(posts, profileUser).map((item) => item.id);

const modelPost = post({
  id: 'model-post',
  authorId: 'user-1',
  credits: [{ uid: 'user-1', role: 'model', isSelf: true }],
});
assert.deepEqual(tabKeys([modelPost], profile(['model'])), [], 'single role profile with model posts gets no role tabs and no Alles tab');
assert.deepEqual(eligibleIds([modelPost], profile(['model'])), ['model-post'], 'single role model post remains eligible for direct grid');

const photographerPost = post({
  id: 'photographer-post',
  authorId: 'user-1',
  credits: [{ uid: 'user-1', role: 'photographer', isSelf: true }],
});
assert.deepEqual(
  tabKeys([modelPost, photographerPost], profile(['model', 'photographer'])),
  [ALL_PROFILE_PORTFOLIO_TAB, 'model', 'photographer'],
  'multi-role profile with model and photographer content gets Alles, Model, Fotograaf in profile role order',
);
assert.deepEqual(tabKeys([modelPost], profile(['model', 'photographer'])), [], 'multi-role profile with only model content gets no role tabs');

assert.deepEqual(
  filterProfilePostsByRole([modelPost, photographerPost], profile(['model', 'photographer']), 'stylist').map((item) => item.id),
  ['model-post', 'photographer-post'],
  'stale role key falls back to all eligible posts when active tab is not present in current tabs',
);
assert.deepEqual(
  filterProfilePostsByRole([modelPost], profile(['model']), 'photographer').map((item) => item.id),
  ['model-post'],
  'single-role profile with stale photographer active tab still shows model eligible posts',
);
assert.deepEqual(
  filterProfilePostsByRole([modelPost, photographerPost], profile(['model', 'photographer']), 'photographer').map((item) => item.id),
  ['photographer-post'],
  'multi-role profile with valid active photographer tab filters normally',
);

const creditedAsMua = post({
  id: 'credited-mua',
  credits: [{ uid: 'user-1', contributorId: 'contrib-1', role: 'mua' }],
});
assert.deepEqual(getProfilePostRoleKeys(creditedAsMua, profile(['model'])), [], 'profile with role model credited as MUA gets no role keys');
assert.deepEqual(eligibleIds([creditedAsMua], profile(['model'])), [], 'profile with role model credited as MUA does not include that post');
assert.deepEqual(getProfilePostRoleKeys(creditedAsMua, profile(['model', 'mua'])), ['mua'], 'profile with roles model and MUA credited as MUA resolves to MUA');
assert.deepEqual(filterProfilePostsByRole([creditedAsMua], profile(['model', 'mua']), 'mua').map((item) => item.id), ['credited-mua'], 'profile with roles model and MUA includes credited MUA post under MUA');

const selfPortrait = post({
  id: 'self-portrait',
  authorId: 'user-1',
  credits: [{ uid: 'user-1', role: 'model', isSelf: true, isMaker: true, makerFunction: 'photographer' }],
});
assert.deepEqual(getProfilePostRoleKeys(selfPortrait, profile(['model', 'photographer'])), ['model'], 'self portrait makerFunction photographer returns only model');
assert.deepEqual(filterProfilePostsByRole([selfPortrait], profile(['model', 'photographer']), 'photographer').map((item) => item.id), ['self-portrait'], 'invalid inactive photographer tab falls back to eligible grid when no tabs exist');
assert.deepEqual(
  filterProfilePostsByRole([selfPortrait, photographerPost], profile(['model', 'photographer']), 'photographer').map((item) => item.id),
  ['photographer-post'],
  'self portrait appears under Model only, not Fotograaf, when a photographer tab exists',
);

const muaOwnWork = post({
  id: 'mua-own-work',
  authorId: 'user-1',
  credits: [{ uid: 'user-1', role: 'mua', isSelf: true, isMaker: true, makerFunction: 'photographer' }],
});
assert.deepEqual(getProfilePostRoleKeys(muaOwnWork, profile(['mua', 'photographer'])), ['mua'], 'MUA own work makerFunction photographer returns only MUA');

const companyProductionOwner = post({
  id: 'company-production-owner',
  authorId: 'user-1',
  credits: [{ uid: 'user-1', role: 'company', isSelf: true, makerFunction: 'productionOwner' }],
});
assert.deepEqual(getProfilePostRoleKeys(companyProductionOwner, profile(['company', 'photographer'])), ['company'], 'Company makerFunction productionOwner returns only company');

const agencyRightsHolder = post({
  id: 'agency-rights-holder',
  authorId: 'user-1',
  credits: [{ uid: 'user-1', role: 'agency', isSelf: true, makerFunction: 'rightsHolder' }],
});
assert.deepEqual(getProfilePostRoleKeys(agencyRightsHolder, profile(['agency', 'photographer'])), ['agency'], 'Agency makerFunction rightsHolder returns only agency');

const modelRetoucherPost = post({
  id: 'model-retoucher',
  authorId: 'user-1',
  credits: [
    { uid: 'user-1', role: 'model', isSelf: true },
    { uid: 'user-1', role: 'retoucher', isSelf: true },
  ],
});
assert.deepEqual(getProfilePostRoleKeys(modelRetoucherPost, profile(['model', 'retoucher'])), ['model', 'retoucher'], 'same post returns model and retoucher when both roles are in profile.roles');
assert.deepEqual(getProfilePostRoleKeys(modelRetoucherPost, profile(['model'])), ['model'], 'same post returns only model when profile.roles only contains model');

const structuredOverridesFallback = post({
  id: 'structured-overrides-fallback',
  authorId: 'user-1',
  authorRole: 'model',
  credits: [{ uid: 'user-1', role: 'photographer', isSelf: true }],
});
assert.deepEqual(getProfilePostRoleKeys(structuredOverridesFallback, profile(['model', 'photographer'])), ['photographer'], 'structured credit role overrides fallback profile or author role');
assert.deepEqual(getProfilePostRoleKeys(structuredOverridesFallback, profile(['model'])), [], 'structured out-of-profile role does not fall back to model');

const legacyAuthorRole = post({ id: 'legacy-author-role', authorId: 'user-1', authorRole: 'model' });
const legacyFirstProfileRole = post({ id: 'legacy-first-role', authorId: 'user-1' });
const legacyInvalidAuthorRole = post({ id: 'legacy-invalid-role', authorId: 'user-1', authorRole: 'photographer' });
assert.deepEqual(getProfilePostRoleKeys(legacyAuthorRole, profile(['model'])), ['model'], 'legacy authored post uses safe authorRole fallback');
assert.deepEqual(getProfilePostRoleKeys(legacyFirstProfileRole, profile(['model'])), ['model'], 'legacy authored post without authorRole uses first profile role fallback');
assert.deepEqual(getProfilePostRoleKeys(legacyInvalidAuthorRole, profile(['model'])), [], 'legacy fallback role must be within profile.roles');
assert.deepEqual(eligibleIds([legacyAuthorRole, legacyFirstProfileRole, legacyInvalidAuthorRole], profile(['model'])), ['legacy-author-role', 'legacy-first-role'], 'legacy authored posts still appear when fallback role is eligible');

const sophieProfile = (roles = ['model']) => profile(roles, { uid: 'user-sophie', contributorId: 'contrib-sophie' });
const sophieAuthoredWithOtherContributorCredit = post({
  id: 'sophie-authored-other-credit',
  authorId: 'user-sophie',
  authorRole: 'model',
  credits: [{ uid: 'user-tom', role: 'photographer' }],
});
assert.deepEqual(
  getProfilePostRoleKeys(sophieAuthoredWithOtherContributorCredit, sophieProfile(['model'])),
  ['model'],
  'legacy authored post with credits for another contributor still uses authorRole fallback for the author',
);
assert.deepEqual(
  eligibleIds([sophieAuthoredWithOtherContributorCredit], sophieProfile(['model'])),
  ['sophie-authored-other-credit'],
  'legacy authored post with credits for another contributor remains eligible for the author',
);
assert.deepEqual(
  getProfilePostRoleKeys(sophieAuthoredWithOtherContributorCredit, sophieProfile(['photographer'])),
  [],
  'legacy authored post with credits for another contributor is excluded when authorRole is outside profile.roles',
);
assert.deepEqual(
  eligibleIds([sophieAuthoredWithOtherContributorCredit], sophieProfile(['photographer'])),
  [],
  'legacy authored post with credits for another contributor is not eligible when fallback role is outside profile.roles',
);

const nonAuthoredOtherContributorCredit = post({
  id: 'non-authored-other-credit',
  authorId: 'user-other',
  authorRole: 'model',
  credits: [{ uid: 'user-tom', role: 'photographer' }],
});
assert.deepEqual(
  getProfilePostRoleKeys(nonAuthoredOtherContributorCredit, sophieProfile(['model'])),
  [],
  'non-authored post with credits for other people does not fall back onto this profile',
);

const matchingOutOfProfileStructuredCredit = post({
  id: 'matching-out-of-profile-credit',
  authorId: 'user-sophie',
  authorRole: 'model',
  credits: [{ uid: 'user-sophie', role: 'mua' }],
});
assert.deepEqual(
  getProfilePostRoleKeys(matchingOutOfProfileStructuredCredit, sophieProfile(['model'])),
  [],
  'matching structured credit outside profile.roles does not fall back to authorRole',
);

const matchingEligibleStructuredCredit = post({
  id: 'matching-eligible-structured-credit',
  authorId: 'user-sophie',
  authorRole: 'model',
  credits: [{ uid: 'user-sophie', role: 'photographer' }],
});
assert.deepEqual(
  getProfilePostRoleKeys(matchingEligibleStructuredCredit, sophieProfile(['model', 'photographer'])),
  ['photographer'],
  'matching structured eligible credit wins over authorRole fallback',
);

const unrelatedCreditPost = post({
  id: 'unrelated-credit',
  credits: [{ uid: 'user-3', contributorId: 'contrib-3', role: 'mua' }],
});
assert.deepEqual(getProfilePostRoleKeys(unrelatedCreditPost, profile(['mua'])), [], 'unrelated user credits do not create role keys for this profile');
assert.deepEqual(tabKeys([unrelatedCreditPost], profile(['mua'])), [], 'unrelated user credits do not create tabs for this profile');
assert.deepEqual(eligibleIds([unrelatedCreditPost], profile(['mua'])), [], 'unrelated user credits do not create eligible posts for this profile');

const contributorMatch = post({
  id: 'contributor-match',
  credits: [{ contributorId: 'contrib-1', role: 'photographer' }],
});
const contributorMismatch = post({
  id: 'contributor-mismatch',
  credits: [{ contributorId: 'contrib-2', role: 'photographer' }],
});
assert.deepEqual(getProfilePostRoleKeys(contributorMatch, profile(['photographer'])), ['photographer'], 'contributorId matching works when contributorId belongs to viewed profile');
assert.deepEqual(getProfilePostRoleKeys(contributorMismatch, profile(['photographer'])), [], 'contributorId matching ignores other contributorIds');

assert.equal(
  tabKeys([modelPost, photographerPost], profile(['model', 'photographer'])).includes('moodboards'),
  false,
  'no Moodboards tab is added by portfolio role helpers',
);

console.log('profilePortfolioRoles logic tests passed');
