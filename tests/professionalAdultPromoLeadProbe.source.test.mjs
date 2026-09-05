import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../docs/moderation-professional-adult-public-preview-sources-v1.json', import.meta.url), 'utf8'));
const script = await readFile(new URL('../scripts/probeProfessionalAdultPromoGalleryLeads.js', import.meta.url), 'utf8');

test('promo lead probe starts only from curated rights and affiliate leads', () => {
  assert.ok(Array.isArray(config.rightsConfirmedPromotionalLeads));
  assert.ok(Array.isArray(config.affiliateGalleryLeads));
  assert.match(script, /rightsConfirmedPromotionalLeads/);
  assert.match(script, /affiliateGalleryLeads/);
  assert.doesNotMatch(script, /adultEntranceLeads/);
  assert.doesNotMatch(script, /styleReferenceLeads/);
});

test('promo lead probe is metadata-only and never authenticates or downloads images', () => {
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /authenticationUsed: false/);
  assert.match(script, /memberAreasEntered: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
  assert.doesNotMatch(script, /arrayBuffer\(/);
  assert.doesNotMatch(script, /writeFile\([^\n]*(jpg|jpeg|png|webp)/i);
});

test('promo lead probe searches specifically for gallery and promotional links', () => {
  assert.match(script, /fhg/);
  assert.match(script, /gallery/);
  assert.match(script, /promo/);
  assert.match(script, /hosted/);
  assert.match(script, /LINK_HINT/);
});

test('research safeguards remain explicit', () => {
  assert.equal(config.rules.noMemberArea, true);
  assert.equal(config.rules.noPaywallBypass, true);
  assert.equal(config.rules.noLoginBypass, true);
  assert.equal(config.rules.noAgeGateBypass, true);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
});
