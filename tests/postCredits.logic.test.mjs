import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getPostCreditRows,
  isAnonymousDisplayOnlyShadowProfile,
  isClaimableTemporaryContributor,
} from '../src/utils/postCredits.js';

const rowsFor = (credits, post = {}) => getPostCreditRows({
  id: 'post_1',
  authorId: 'author_1',
  authorName: 'Author',
  authorRole: 'photographer',
  ...post,
  credits,
});

const modelSelfMade = rowsFor([
  { role: 'model', isMaker: true, makerFunction: 'photographer', name: 'Mara Eliza', uid: 'author_1', isSelf: true },
]);
assert.equal(modelSelfMade.length, 1, 'model self-made credit renders one row');
assert.equal(modelSelfMade[0].roleLabel, 'Model');
assert.equal(modelSelfMade[0].name, 'Mara Eliza');
assert.equal(modelSelfMade[0].secondaryLabel, '', 'legacy self model makerFunction without selfPortrait is not labelled as self portrait');


const confirmedSelfPortraitWithoutMakerFunction = rowsFor([
  { role: 'model', isMaker: true, selfPortrait: true, name: 'Mara Eliza', uid: 'author_1', isSelf: true },
]);
assert.equal(confirmedSelfPortraitWithoutMakerFunction[0].secondaryLabel, 'Zelfportret', 'confirmed self portrait renders without makerFunction');
assert.equal(confirmedSelfPortraitWithoutMakerFunction[0].rawCredit.makerFunction, undefined, 'confirmed self portrait fixture does not store makerFunction');

const selfPortraitWithoutMakerFlag = rowsFor([
  { role: 'model', selfPortrait: true, name: 'Mara Eliza', uid: 'author_1', isSelf: true },
]);
assert.equal(selfPortraitWithoutMakerFlag[0].secondaryLabel, '', 'selfPortrait without isMaker is not labelled as self portrait');

const unconfirmedSelfModel = rowsFor([
  { role: 'model', name: 'Mara Eliza', uid: 'author_1', isSelf: true },
]);
assert.equal(unconfirmedSelfModel[0].secondaryLabel, '', 'unconfirmed self model credit is not labelled as self portrait');

const muaSelfMade = rowsFor([
  { role: 'mua', isMaker: true, makerFunction: 'photographer', name: 'Mara Eliza', uid: 'author_1', isSelf: true },
]);
assert.equal(muaSelfMade.length, 1, 'MUA self-made credit renders one row');
assert.equal(muaSelfMade[0].roleLabel, 'MUA');
assert.equal(muaSelfMade[0].secondaryLabel, 'Eigen werk');

const stylistSelfMade = rowsFor([
  { role: 'stylist', isMaker: true, makerFunction: 'photographer', name: 'Mara Eliza', uid: 'author_1', isSelf: true },
]);
assert.equal(stylistSelfMade.length, 1, 'stylist self-made credit renders one row');
assert.equal(stylistSelfMade[0].roleLabel, 'Stylist');
assert.equal(stylistSelfMade[0].secondaryLabel, 'Eigen werk');

const hairSelfMade = rowsFor([
  { role: 'hair', isMaker: true, makerFunction: 'photographer', name: 'Mara Eliza', uid: 'author_1', isSelf: true },
]);
assert.equal(hairSelfMade.length, 1, 'hairstylist self-made credit renders one row');
assert.equal(hairSelfMade[0].roleLabel, 'Hairstylist');
assert.equal(hairSelfMade[0].secondaryLabel, 'Eigen werk');

const companyMaker = rowsFor([
  { role: 'company', isMaker: true, makerFunction: 'productionOwner', name: 'Studio X', uid: 'company_1' },
], { authorId: 'company_1' });
assert.equal(companyMaker.length, 1, 'company maker credit renders one row');
assert.equal(companyMaker[0].roleLabel, 'Beeld door');
assert.equal(companyMaker[0].name, 'Studio X');
assert.notEqual(companyMaker[0].roleLabel, 'Fotograaf');

const agencyMaker = rowsFor([
  { role: 'agency', isMaker: true, makerFunction: 'rightsHolder', name: 'Agency X', uid: 'agency_1' },
], { authorId: 'agency_1' });
assert.equal(agencyMaker.length, 1, 'agency maker credit renders one row');
assert.equal(agencyMaker[0].roleLabel, 'Beeld door');
assert.equal(agencyMaker[0].name, 'Agency X');

const normalDifferentPeople = rowsFor([
  { role: 'model', name: 'Mara Eliza', uid: 'model_1' },
  { role: 'photographer', name: 'Dave Hendriks', uid: 'photo_1' },
], { authorId: 'photo_1' });
assert.equal(normalDifferentPeople.length, 2, 'different model and photographer credits render two rows');
assert.deepEqual(normalDifferentPeople.map((row) => row.roleLabel), ['Model', 'Fotograaf']);
assert.deepEqual(normalDifferentPeople.map((row) => row.name), ['Mara Eliza', 'Dave Hendriks']);

const anonymousMaker = rowsFor([
  { role: 'photographer', isMaker: true, makerFunction: 'photographer', isAnonymous: true },
], { authorId: null, authorName: '' });
assert.equal(anonymousMaker.length, 1, 'anonymous maker credit renders one row');
assert.equal(anonymousMaker[0].roleLabel, 'Fotograaf');
assert.equal(anonymousMaker[0].name, 'Anonieme fotograaf');

const legacyFallback = getPostCreditRows({ authorId: 'legacy_author', authorName: 'Legacy Name', authorRole: 'photographer' });
assert.equal(legacyFallback.length, 1, 'legacy post without structured credits renders fallback row');
assert.equal(legacyFallback[0].roleLabel, 'Fotograaf');
assert.equal(legacyFallback[0].name, 'Legacy Name');
assert.equal(legacyFallback[0].secondaryLabel, '');

assert.equal(legacyFallback[0].canOpenShadowByName, false, 'legacy fallback author name is not shadow-openable by name');

const synthesizedFallbackAuthor = rowsFor([
  { role: 'model', name: 'Mara Eliza' },
], { authorName: 'Legacy Author', authorId: null, authorRole: 'photographer' });
assert.equal(synthesizedFallbackAuthor.length, 2, 'structured credits synthesize an author fallback when no credit matches author');
assert.equal(synthesizedFallbackAuthor[0].isLegacyAuthorFallback, true, 'first row is synthesized legacy author fallback');
assert.equal(synthesizedFallbackAuthor[0].canOpenShadowByName, false, 'synthesized legacy author fallback has no explicit-name shadow flag');
assert.equal(synthesizedFallbackAuthor[1].name, 'Mara Eliza', 'explicit structured name credit keeps its display name');
assert.equal(synthesizedFallbackAuthor[1].canOpenShadowByName, true, 'explicit structured name credit keeps its explicit-name flag for analysis');

const legacySelfMakerConfirmedFallback = getPostCreditRows({
  authorId: 'legacy_model',
  authorName: 'Legacy Model',
  authorRole: 'model',
  uploadConsent: {
    selfMakerRoleConfirmed: true,
    selfMakerRole: 'photographer',
  },
});
assert.equal(legacySelfMakerConfirmedFallback.length, 1, 'legacy uploadConsent self maker post renders one fallback row');
assert.equal(legacySelfMakerConfirmedFallback[0].roleLabel, 'Model');
assert.equal(legacySelfMakerConfirmedFallback[0].name, 'Legacy Model');
assert.equal(legacySelfMakerConfirmedFallback[0].secondaryLabel, '', 'legacy uploadConsent self maker data does not display as self portrait');

// Static guard: timeline and modal must keep using the shared credit renderer.
const timelineSource = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('../src/components/PhotoDetailModal.jsx', import.meta.url), 'utf8');
assert.match(timelineSource, /<PostCreditDisplay\b/, 'timeline uses PostCreditDisplay');
assert.match(modalSource, /<PostCreditDisplay\b/, 'photo detail modal uses PostCreditDisplay');

const anonymousModel = rowsFor([
  { role: { label: 'Model', value: 'model' }, name: 'Anonieme bijdrager', anonymous: true },
], { authorId: null, authorName: '' });
assert.equal(anonymousModel.length, 1, 'anonymous model credit renders one row');
assert.equal(anonymousModel[0].roleLabel, 'Model');
assert.equal(anonymousModel[0].name, 'Anoniem model');
assert.equal(anonymousModel[0].isAnonymous, true, 'anonymous model is flagged display-only');
assert.equal(anonymousModel[0].contributorId, null, 'anonymous model does not expose a claimable contributor id');
assert.notEqual(anonymousModel[0].roleLabel, '[object Object]', 'role objects are normalized before rendering');

const anonymousPhotographer = rowsFor([
  { role: 'photographer', name: 'Anonieme bijdrager', isAnonymous: true, isMaker: true, makerFunction: 'photographer' },
], { authorId: null, authorName: '' });
assert.equal(anonymousPhotographer[0].roleLabel, 'Fotograaf');
assert.equal(anonymousPhotographer[0].name, 'Anonieme fotograaf');

const anonymousMissingRole = rowsFor([
  { name: 'Anonieme bijdrager', isAnonymous: true },
], { authorId: null, authorName: '' });
assert.equal(anonymousMissingRole[0].roleLabel, 'Bijdrager');
assert.equal(anonymousMissingRole[0].name, 'Anonieme bijdrager');

const legacyAnonymousContributor = rowsFor([
  { role: 'model', name: 'Anonieme bijdrager', contributorId: 'legacy_bad_temp' },
], { authorId: null, authorName: '' });
assert.equal(legacyAnonymousContributor[0].isAnonymous, true, 'legacy anonymous temporary names are guarded as anonymous');
assert.equal(legacyAnonymousContributor[0].contributorId, null, 'legacy anonymous temporary names are not claimable');


const anonymousLabelOnlyModel = rowsFor([
  { role: { label: 'Model' }, anonymous: true },
], { authorId: null, authorName: '' });
assert.equal(anonymousLabelOnlyModel[0].roleLabel, 'Model', 'label-only model role object is canonicalized');
assert.equal(anonymousLabelOnlyModel[0].name, 'Anoniem model');
assert.equal(anonymousLabelOnlyModel[0].isAnonymous, true);
assert.equal(anonymousLabelOnlyModel[0].contributorId, null);

const anonymousLabelOnlyPhotographer = rowsFor([
  { role: { label: 'Fotograaf' }, anonymous: true },
], { authorId: null, authorName: '' });
assert.equal(anonymousLabelOnlyPhotographer[0].roleLabel, 'Fotograaf', 'label-only photographer role object is canonicalized');
assert.equal(anonymousLabelOnlyPhotographer[0].name, 'Anonieme fotograaf');
assert.equal(anonymousLabelOnlyPhotographer[0].isAnonymous, true);
assert.equal(anonymousLabelOnlyPhotographer[0].contributorId, null);

const pendingInviteCandidates = [
  { contributorId: 'anon_flag', displayName: 'Anon flag', anonymous: true },
  { contributorId: 'is_anon_flag', displayName: 'Is anon flag', isAnonymous: true },
  { contributorId: 'anon_mode_flag', displayName: 'Anon mode flag', anonymousMode: true },
  { contributorId: 'anon_contributor_flag', displayName: 'Anon contributor flag', isAnonymousContributor: true },
  { contributorId: 'mode_anon', displayName: 'Mode anon', mode: 'anonymous' },
  { contributorId: 'type_anon', displayName: 'Type anon', type: 'anonymous' },
  { contributorId: 'consent_anon', displayName: 'Consent anon', consentStatus: 'anonymous' },
  { contributorId: 'credit_type_anon', displayName: 'Credit type anon', creditType: 'anonymous' },
  { contributorId: 'anon_model_name', displayName: 'Anoniem model' },
  { contributorId: 'anon_photographer_name', displayName: 'Anonieme fotograaf' },
  { contributorId: 'claimable_temp', displayName: 'Mara Eliza' },
];
assert.deepEqual(
  pendingInviteCandidates.filter(isClaimableTemporaryContributor).map((candidate) => candidate.contributorId),
  ['claimable_temp'],
  'claim invite filter only keeps named temporary contributors',
);

assert.equal(isAnonymousDisplayOnlyShadowProfile({ name: 'Anoniem model', externalLinks: [] }), true, 'shadow modal treats anonymous model as display-only');
assert.equal(isAnonymousDisplayOnlyShadowProfile({ name: 'Anonieme fotograaf', externalLinks: [] }), true, 'shadow modal treats anonymous photographer as display-only');
assert.equal(isAnonymousDisplayOnlyShadowProfile({ name: 'Anonieme fotograaf', externalLinks: [{ type: 'website', url: 'https://example.com' }] }), false, 'shadow modal keeps public identity entries claimable');
assert.equal(isAnonymousDisplayOnlyShadowProfile({ name: 'Named contributor', isAnonymous: true, externalLinks: [{ type: 'website', url: 'https://example.com' }] }), true, 'explicit anonymous flag wins for shadow modal');

console.log('PASS postCredits.logic.test.mjs');
