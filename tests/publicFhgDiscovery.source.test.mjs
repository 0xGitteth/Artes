import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../docs/moderation-public-fhg-sources-v1.json', import.meta.url), 'utf8'));
const script = await readFile(new URL('../scripts/discoverPublicFhgGalleryAssets.js', import.meta.url), 'utf8');

test('public FHG lane starts from publisher-exposed galleries rather than generic adult search results', () => {
  assert.equal(config.status, 'research_public_fhg_source_discovery_only');
  assert.ok(config.sources.some((source) => source.sourceId === 'mastasia_public_fhg_index'));
  assert.ok(config.sources.some((source) => source.sourceId === 'metart_public_fhg_current_example'));
  assert.equal(config.rules.publisherHostedAssetsPreferred, true);
});

test('public FHG discovery never fabricates affiliate identity or enters member areas', () => {
  assert.equal(config.rules.noAffiliateIdFabrication, true);
  assert.equal(config.rules.noAffiliateAccountRequired, true);
  assert.equal(config.rules.noMemberArea, true);
  assert.match(script, /url\.search = ''/);
  assert.match(script, /Never fabricate one/);
  assert.doesNotMatch(script, /YOUR_ID.*=/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});

test('public FHG discovery is metadata-only and non-authoritative', () => {
  assert.equal(config.rules.metadataDiscoveryOnly, true);
  assert.equal(config.rules.downloadImageBytes, false);
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /humanVisualScreeningRequired: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
  assert.doesNotMatch(script, /arrayBuffer\(/);
});

test('legacy HTTP gallery links may only be upgraded to HTTPS on the same whitelisted publisher host', () => {
  assert.match(script, /url\.protocol === 'http:'/);
  assert.match(script, /url\.protocol = 'https:'/);
  assert.match(script, /allowedHostsFor\(source\)/);
  assert.match(script, /public_fhg_host_not_allowed/);
});
