import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../docs/moderation-professional-explicit-diversity-leads-v1.json', import.meta.url), 'utf8'));
const script = await readFile(new URL('../scripts/probeProfessionalExplicitDiversityGalleryLeads.js', import.meta.url), 'utf8');

test('explicit diversity research does not accept one adult publisher as sufficient coverage', () => {
  assert.equal(config.rules.explicitSourceDiversityRequired, true);
  assert.ok(config.leads.length >= 4);
  assert.ok(config.leads.some((lead) => lead.sourceId === 'paperstreetcash_public_fhg_examples'));
  assert.ok(config.leads.some((lead) => lead.sourceId === 'buddyprofits_hosted_galleries'));
  assert.ok(config.leads.some((lead) => lead.sourceId === 'glowdollars_hosted_galleries'));
});

test('diversity probe is public metadata-only research and cannot enter affiliate or member areas', () => {
  assert.equal(config.rules.noAffiliateLoginBypass, true);
  assert.equal(config.rules.noMemberArea, true);
  assert.equal(config.rules.noPaywallBypass, true);
  assert.equal(config.rules.noAgeGateBypass, true);
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /authenticationUsed: false/);
  assert.match(script, /memberAreasEntered: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});

test('probe looks for actual hosted-gallery evidence rather than treating marketing copy as an image label', () => {
  assert.match(script, /LINK_HINT/);
  assert.match(script, /fhg/);
  assert.match(script, /hosted/);
  assert.match(script, /galler/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
});
