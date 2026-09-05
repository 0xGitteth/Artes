import assert from 'node:assert/strict';
import {
  buildAdultSubjectAttestationInputFromModeration,
  hasPossibleMinorConcern,
  isAllowedAdultClassification,
  shouldBlockAdultSubjectAttestationForModeration,
} from '../src/utils/adultSubjectAttestationRouting.js';

assert.equal(isAllowedAdultClassification('allowed_adult_art_nude'), true);
assert.equal(isAllowedAdultClassification('allowed_adult_erotic_suggestive'), true);
assert.equal(isAllowedAdultClassification('allowed_general'), false);
assert.equal(isAllowedAdultClassification('disallowed_sexual_explicit'), false);

assert.equal(hasPossibleMinorConcern(['possible_minor_concern']), true);
assert.equal(hasPossibleMinorConcern([{ trigger: 'possible_minor_concern' }]), true);
assert.equal(hasPossibleMinorConcern([{ reason: 'possible_minor_concern' }]), true);
assert.equal(hasPossibleMinorConcern(['sexual_explicit_uncertain']), false);

const artNudeInput = buildAdultSubjectAttestationInputFromModeration({
  classification: 'allowed_adult_art_nude',
  forbiddenReasons: [],
  credits: [{ role: 'model', isAnonymous: true }],
});
assert.equal(artNudeInput.adultOrSexualContentPresent, true);
assert.equal(artNudeInput.ageNotReliablyVerifiable, true);
assert.equal(artNudeInput.possibleMinorConcern, false);

const minorConcernInput = buildAdultSubjectAttestationInputFromModeration({
  classification: 'allowed_adult_art_nude',
  forbiddenReasons: ['possible_minor_concern'],
});
assert.equal(minorConcernInput.possibleMinorConcern, true);

assert.equal(shouldBlockAdultSubjectAttestationForModeration({ classification: 'disallowed_sexual_explicit' }), true);
assert.equal(shouldBlockAdultSubjectAttestationForModeration({ classification: 'allowed_adult_art_nude' }), false);

console.log('PASS adultSubjectAttestationRouting.logic.test.mjs');
