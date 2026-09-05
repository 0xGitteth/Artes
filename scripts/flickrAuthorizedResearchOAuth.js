import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSignedOAuthGet, parseFormEncoded } from './lib/flickrOAuth1.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const STATE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-flickr-oauth');
const CONSUMER_PATH = path.join(STATE_DIR, 'consumer.json');
const REQUEST_PATH = path.join(STATE_DIR, 'request-token.json');
const ACCESS_PATH = path.join(STATE_DIR, 'access-token.json');

const REQUEST_TOKEN_URL = 'https://www.flickr.com/services/oauth/request_token';
const AUTHORIZE_URL = 'https://www.flickr.com/services/oauth/authorize';
const ACCESS_TOKEN_URL = 'https://www.flickr.com/services/oauth/access_token';

const writeSecretJson = async (filePath, value) => {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
};

const readJson = async (filePath, label) => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    throw new Error(`${label}_missing_run_previous_step`);
  }
};

const setup = async () => {
  const apiKey = String(process.env.FLICKR_API_KEY || '').trim();
  const apiSecret = String(process.env.FLICKR_API_SECRET || '').trim();
  if (!apiKey || !apiSecret) throw new Error('set_FLICKR_API_KEY_and_FLICKR_API_SECRET_first');
  await writeSecretJson(CONSUMER_PATH, { apiKey, apiSecret, storedAt: new Date().toISOString() });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stored: '.tmp/moderation-flickr-oauth/consumer.json',
    secretPrinted: false,
    committed: false,
  }, null, 2)}\n`);
};

const requestToken = async () => {
  const consumer = await readJson(CONSUMER_PATH, 'flickr_consumer_credentials');
  const callback = String(process.env.FLICKR_OAUTH_CALLBACK || '').trim();
  if (!callback) throw new Error('FLICKR_OAUTH_CALLBACK_required_use_codespace_authorizer_or_set_explicit_callback');
  const parsedCallback = new URL(callback);
  if (parsedCallback.protocol !== 'https:') throw new Error('flickr_oauth_callback_must_be_https');
  const response = await fetchSignedOAuthGet({
    url: REQUEST_TOKEN_URL,
    consumerKey: consumer.apiKey,
    consumerSecret: consumer.apiSecret,
    oauthExtra: { oauth_callback: callback },
    accept: 'text/plain,*/*;q=0.5',
  });
  const parsed = parseFormEncoded(await response.text());
  if (parsed.oauth_callback_confirmed !== 'true' || !parsed.oauth_token || !parsed.oauth_token_secret) {
    throw new Error('flickr_request_token_response_invalid');
  }
  await writeSecretJson(REQUEST_PATH, {
    requestToken: parsed.oauth_token,
    requestTokenSecret: parsed.oauth_token_secret,
    callback,
    storedAt: new Date().toISOString(),
  });
  const authorize = new URL(AUTHORIZE_URL);
  authorize.searchParams.set('oauth_token', parsed.oauth_token);
  authorize.searchParams.set('perms', 'read');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    authorizationUrl: authorize.toString(),
    next: 'Open authorizationUrl, approve read access, then copy oauth_verifier from the callback URL and run: node scripts/flickrAuthorizedResearchOAuth.js exchange <oauth_verifier>',
    tokenSecretPrinted: false,
    requestedPermission: 'read',
  }, null, 2)}\n`);
};

const exchange = async (verifier) => {
  const cleanVerifier = String(verifier || '').trim();
  if (!cleanVerifier || !/^[A-Za-z0-9_-]{4,256}$/.test(cleanVerifier)) {
    throw new Error('oauth_verifier_missing_or_invalid');
  }
  const consumer = await readJson(CONSUMER_PATH, 'flickr_consumer_credentials');
  const request = await readJson(REQUEST_PATH, 'flickr_request_token');
  const response = await fetchSignedOAuthGet({
    url: ACCESS_TOKEN_URL,
    consumerKey: consumer.apiKey,
    consumerSecret: consumer.apiSecret,
    token: request.requestToken,
    tokenSecret: request.requestTokenSecret,
    oauthExtra: { oauth_verifier: cleanVerifier },
    accept: 'text/plain,*/*;q=0.5',
  });
  const parsed = parseFormEncoded(await response.text());
  if (!parsed.oauth_token || !parsed.oauth_token_secret || !parsed.user_nsid) {
    throw new Error('flickr_access_token_response_invalid');
  }
  await writeSecretJson(ACCESS_PATH, {
    accessToken: parsed.oauth_token,
    accessTokenSecret: parsed.oauth_token_secret,
    userNsid: parsed.user_nsid,
    username: parsed.username || null,
    fullname: parsed.fullname || null,
    permission: 'read',
    storedAt: new Date().toISOString(),
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    authorized: true,
    userNsid: parsed.user_nsid,
    username: parsed.username || null,
    permission: 'read',
    tokenPrinted: false,
    stored: '.tmp/moderation-flickr-oauth/access-token.json',
  }, null, 2)}\n`);
};

const status = async () => {
  let consumer = false;
  let request = false;
  let access = null;
  try { await readFile(CONSUMER_PATH, 'utf8'); consumer = true; } catch {}
  try { await readFile(REQUEST_PATH, 'utf8'); request = true; } catch {}
  try {
    const parsed = JSON.parse(await readFile(ACCESS_PATH, 'utf8'));
    access = { present: true, userNsid: parsed.userNsid || null, username: parsed.username || null, permission: parsed.permission || null };
  } catch {
    access = { present: false };
  }
  process.stdout.write(`${JSON.stringify({ ok: true, consumerCredentialsPresent: consumer, requestTokenPresent: request, access }, null, 2)}\n`);
};

const command = process.argv[2];
if (command === 'setup') await setup();
else if (command === 'request') await requestToken();
else if (command === 'exchange') await exchange(process.argv[3]);
else if (command === 'status') await status();
else {
  process.stderr.write('Usage: node scripts/flickrAuthorizedResearchOAuth.js <setup|request|exchange VERIFIER|status>\n');
  process.exitCode = 2;
}
