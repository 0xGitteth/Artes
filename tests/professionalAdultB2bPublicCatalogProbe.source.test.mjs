import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../docs/moderation-professional-adult-b2b-public-catalog-sources-v1.json', import.meta.url), 'utf8'));
const script = await readFile(new URL('../scripts/probeProfessionalAdultB2bPublicCatalogs.js', import.meta.url), 'utf8');

test('B2B public catalog lane adds real professional source diversity beyond one adult publisher', () => {
  assert.equal(config.status, 'research_professional_adult_b2b_public_catalog_sources');
  assert.ok(config.sources.some((source) => source.sourceId === 'adultlabs_public_catalog'));
  assert.ok(config.sources.some((source) => source.sourceId === 'weshootadult_public_catalog'));
  assert.ok(config.sources.some((source) => source.sourceId === 'photorama_public_catalog'));
  assert.ok(config.sources.some((source) => source.targetHints.includes('male_explicit_diversity')));
});

test('B2B catalog probe is metadata-only and cannot login, buy or download images', () => {
  assert.equal(config.rules.publicCatalogPagesOnly, true);
  assert.equal(config.rules.noLogin, true);
  assert.equal(config.rules.noPurchase, true);
  assert.equal(config.rules.noPaywallBypass, true);
  assert.equal(config.rules.noSessionCookieReuse, true);
  assert.equal(config.rules.downloadImageBytes, false);
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /authenticationUsed: false/);
  assert.match(script, /purchasePerformed: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
  assert.doesNotMatch(script, /arrayBuffer\(/);
});

test('youth-coded adult marketing is preserved as review context rather than treated as age evidence', () => {
  assert.equal(config.rules.youthCodedMarketingIsNotAgeProof, true);
  assert.match(script, /YOUTH_CODED/);
  assert.match(script, /youthCodedMarketingMarkerCount/);
  assert.match(script, /youthCodedMarketingIsNotAgeProof: true/);
  assert.match(script, /humanVisualScreeningRequired: true/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
});

test('research outputs cannot self-promote into training or production', () => {
  assert.equal(config.rules.researchOnly, true);
  assert.equal(config.rules.trainingReady, false);
  assert.equal(config.rules.productionEligible, false);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
});
