import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../docs/moderation-professional-adult-public-preview-sources-v1.json', import.meta.url), 'utf8'));
const script = await readFile(new URL('../scripts/discoverProfessionalAdultPublicPreviewAssets.js', import.meta.url), 'utf8');

test('professional adult sourcing starts from publisher and photographer previews, not random tube thumbnails', () => {
  assert.equal(config.status, 'research_professional_adult_public_preview_sources');
  assert.ok(config.sources.some((source) => source.sourceId === 'vivthomas_public_fhg'));
  assert.ok(config.sources.some((source) => source.sourceId === 'peter_juhan_public_explicit_portfolio'));
  assert.ok(config.sources.every((source) => source.automatedDiscoveryEligible === true));
  assert.equal(config.rules.publisherHostedAssetsPreferred, true);
  assert.equal(config.rules.professionalPhotographyPreferred, true);
});

test('Femjoy and Photodromm remain style evidence when their own terms block automated local collection', () => {
  assert.ok(Array.isArray(config.styleReferenceLeads));
  const femjoy = config.styleReferenceLeads.find((source) => source.sourceId === 'femjoy_public_index_style_reference');
  const photodromm = config.styleReferenceLeads.find((source) => source.sourceId === 'photodromm_style_reference');
  assert.ok(femjoy);
  assert.ok(photodromm);
  assert.equal(femjoy.automatedDiscoveryEligible, false);
  assert.equal(femjoy.termsStatus, 'explicit_no_reproduction_reference_only');
  assert.match(femjoy.reasonNotAutomated, /signup/i);
  assert.match(femjoy.reasonNotAutomated, /reproduction/i);
  assert.equal(photodromm.automatedDiscoveryEligible, false);
  assert.equal(photodromm.termsStatus, 'explicit_anti_automation_reference_only');
  assert.match(photodromm.reasonNotAutomated, /robots|scrapers/i);
  assert.equal(config.rules.explicitAntiAutomationRestrictionBlocksAutomatedDiscovery, true);
});

test('rights-confirmed adult promotional leads are kept separate until their exact hosted galleries are resolved', () => {
  assert.ok(Array.isArray(config.rightsConfirmedPromotionalLeads));
  const curiousCash = config.rightsConfirmedPromotionalLeads.find((source) => source.sourceId === 'curiouscash_public_promotional_material');
  const metArtMoney = config.rightsConfirmedPromotionalLeads.find((source) => source.sourceId === 'metartmoney_affiliate_promotional_material');
  assert.ok(curiousCash);
  assert.ok(metArtMoney);
  assert.equal(curiousCash.automatedDiscoveryEligible, false);
  assert.equal(curiousCash.termsStatus, 'promotional_use_explicitly_permitted_with_conditions');
  assert.match(curiousCash.nextStep, /exact current publisher-hosted/i);
  assert.equal(metArtMoney.automatedDiscoveryEligible, false);
  assert.equal(metArtMoney.termsStatus, 'affiliate_limited_license_after_program_access');
});

test('affiliate FHG leads do not silently become automated sources just because promo tools exist', () => {
  assert.ok(Array.isArray(config.affiliateGalleryLeads));
  for (const source of config.affiliateGalleryLeads) assert.equal(source.automatedDiscoveryEligible, false);
  assert.ok(config.affiliateGalleryLeads.some((source) => source.sourceId === 'centroprofits_fhg'));
  assert.ok(config.affiliateGalleryLeads.some((source) => source.sourceId === 'spizcash_fhg'));
  assert.ok(config.affiliateGalleryLeads.some((source) => source.sourceId === 'mastasia_legacy_public_fhg'));
});

test('adult entrance sites are leads but are not silently automated', () => {
  assert.ok(Array.isArray(config.adultEntranceLeads));
  assert.ok(config.adultEntranceLeads.some((source) => source.sourceId === 'hegre_public_previews'));
  assert.ok(config.adultEntranceLeads.some((source) => source.sourceId === 'xart_public_gallery_previews'));
  for (const source of config.adultEntranceLeads) assert.equal(source.automatedDiscoveryEligible, false);
  assert.equal(config.rules.noAgeGateBypass, true);
});

test('public preview discovery is metadata-only and never enters members areas', () => {
  assert.equal(config.rules.publicPreviewOnly, true);
  assert.equal(config.rules.noMemberArea, true);
  assert.equal(config.rules.noPaywallBypass, true);
  assert.equal(config.rules.noLoginBypass, true);
  assert.equal(config.rules.noSessionCookieReuse, true);
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});

test('discovery records asset hosts before any image fetcher can be built', () => {
  assert.match(script, /assetHostCounts/);
  assert.match(script, /collectHtmlImageCandidates/);
  assert.match(script, /og:image/);
  assert.match(script, /srcset/);
  assert.doesNotMatch(script, /arrayBuffer\(/);
});
