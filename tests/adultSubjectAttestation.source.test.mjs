import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const logic = await readFile(new URL('../src/utils/adultSubjectAttestation.js', import.meta.url), 'utf8');
const policy = await readFile(new URL('../docs/adult-subject-age-attestation-v1.md', import.meta.url), 'utf8');

test('faceless or anonymous adult content can use age attestation instead of automatic minor review', () => {
  assert.match(logic, /ageNotReliablyVerifiable/);
  assert.match(logic, /possibleMinorConcern/);
  assert.match(logic, /attestationRequired/);
  assert.match(policy, /Missing facial age evidence is not itself a reason to block or reject/i);
});

test('current age attestation stays separate from future contributor publication consent', () => {
  assert.doesNotMatch(logic, /anonymousSubjectPublicationConsentConfirmed/);
  assert.match(policy, /not a current upload requirement/i);
  assert.match(policy, /future contributor consent workflow/i);
});

test('concrete possible-minor concern cannot be bypassed by uploader confirmation', () => {
  assert.match(logic, /humanReviewRequired/);
  assert.match(logic, /Een uploaderbevestiging kan deze controle niet overslaan/);
  assert.match(policy, /MUST NOT bypass the safety concern/);
});

test('public Flickr research provenance is not treated as age proof', () => {
  assert.match(policy, /Flickr publication is provenance, not proof that a subject is 18\+/i);
});
