import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const oauthHelper = await readFile(new URL('../scripts/lib/flickrOAuth1.js', import.meta.url), 'utf8');
const oauthFlow = await readFile(new URL('../scripts/flickrAuthorizedResearchOAuth.js', import.meta.url), 'utf8');
const probe = await readFile(new URL('../scripts/probeAuthorizedFlickrRestrictedResearch.js', import.meta.url), 'utf8');
const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');

test('Flickr authorized research uses OAuth 1.0a HMAC-SHA1 and Flickr-owned HTTPS endpoints', () => {
  assert.match(oauthHelper, /HMAC-SHA1/);
  assert.match(oauthHelper, /createHmac\('sha1'/);
  assert.match(oauthHelper, /www\.flickr\.com/);
  assert.match(oauthHelper, /api\.flickr\.com/);
  assert.match(oauthFlow, /services\/oauth\/request_token/);
  assert.match(oauthFlow, /services\/oauth\/authorize/);
  assert.match(oauthFlow, /services\/oauth\/access_token/);
  assert.match(oauthFlow, /requestedPermission: 'read'/);
});

test('OAuth secrets stay local and are never printed by the setup flow', () => {
  assert.match(gitignore, /^\.tmp\/$/m);
  assert.match(oauthFlow, /\.tmp.*moderation-flickr-oauth/s);
  assert.match(oauthFlow, /mode: 0o600/);
  assert.match(oauthFlow, /secretPrinted: false/);
  assert.match(oauthFlow, /tokenSecretPrinted: false/);
  assert.match(oauthFlow, /tokenPrinted: false/);
  assert.doesNotMatch(oauthFlow, /console\.log\([^\n]*(apiSecret|accessTokenSecret|requestTokenSecret)/);
});

test('restricted proof compares authenticated safe and restricted visibility without downloading images', () => {
  assert.match(probe, /flickr\.photos\.search/);
  assert.match(probe, /safe_search: String\(safeSearch\)/);
  assert.match(probe, /searchUser\(consumer, access, 1\)/);
  assert.match(probe, /searchUser\(consumer, access, 3\)/);
  assert.match(probe, /content_types: '0'/);
  assert.match(probe, /flickr\.photosets\.getPhotos/);
  assert.match(probe, /72157651222352217/);
  assert.match(probe, /72157650849252192/);
  assert.match(probe, /imageBytesDownloaded: false/);
  assert.match(probe, /discoveryIsLabelAuthority: false/);
  assert.match(probe, /trainingReady: false/);
  assert.match(probe, /productionEligible: false/);
});

test('authorized proof is metadata-only and preserves exact erosunfoto revisit evidence', () => {
  assert.match(probe, /TARGET_USER_NSID = '128438623@N07'/);
  assert.match(probe, /safeSearch3IdsNotInSafeSearch1/);
  assert.match(probe, /restrictedVisibilityEvidenceFound/);
  assert.doesNotMatch(probe, /writeFile\([^\n]*(jpg|jpeg|png|webp)/i);
});
