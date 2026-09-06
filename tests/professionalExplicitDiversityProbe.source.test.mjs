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

test('dashboard-only leads are not repeatedly probed as if their galleries were public', () => {
  const glow = config.leads.find((lead) => lead.sourceId === 'glowdollars_hosted_galleries');
  const buddy = config.leads.find((lead) => lead.sourceId === 'buddyprofits_hosted_galleries');
  assert.equal(glow.publicProbeEligible, false);
  assert.equal(glow.publicResolutionStatus, 'partner_dashboard_only');
  assert.equal(buddy.publicProbeEligible, false);
  assert.match(buddy.publicResolutionStatus, /marketing_only/);
  assert.match(script, /publicProbeEligible !== false/);
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

test('probe resolves nonstandard public gallery links rather than only ordinary anchors', () => {
  assert.match(script, /anchor_onclick/);
  assert.match(script, /data-gallery/);
  assert.match(script, /plain_html_url/);
  assert.match(script, /extractUrlishFragments/);
  assert.match(script, /exampleMarkerCount/);
});

test('probe separates strong gallery evidence from weak marketing links', () => {
  assert.match(script, /STRONG_GALLERY_HINT/);
  assert.match(script, /WEAK_MARKETING_HINT/);
  assert.match(script, /strongGalleryLinks/);
  assert.match(script, /weakMarketingLinks/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
});
