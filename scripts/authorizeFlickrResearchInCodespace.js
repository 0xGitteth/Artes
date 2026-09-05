import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSignedOAuthGet, parseFormEncoded } from './lib/flickrOAuth1.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const STATE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-flickr-oauth');
const CONSUMER_PATH = path.join(STATE_DIR, 'consumer.json');
const ACCESS_PATH = path.join(STATE_DIR, 'access-token.json');
const REQUEST_TOKEN_URL = 'https://www.flickr.com/services/oauth/request_token';
const AUTHORIZE_URL = 'https://www.flickr.com/services/oauth/authorize';
const ACCESS_TOKEN_URL = 'https://www.flickr.com/services/oauth/access_token';
const CALLBACK_PATH = '/flickr/callback';
const PORT = Number(process.env.FLICKR_OAUTH_CALLBACK_PORT || 53682);
const TIMEOUT_MS = 10 * 60 * 1000;

const readConsumer = async () => {
  try { return JSON.parse(await readFile(CONSUMER_PATH, 'utf8')); }
  catch { throw new Error('flickr_consumer_credentials_missing_run_setup_first'); }
};

const resolveCallbackUrl = () => {
  const explicit = String(process.env.FLICKR_OAUTH_CALLBACK || '').trim();
  if (explicit) {
    const url = new URL(explicit);
    if (url.protocol !== 'https:' || url.pathname !== CALLBACK_PATH) throw new Error('FLICKR_OAUTH_CALLBACK_must_be_https_and_end_in_/flickr/callback');
    return url.toString();
  }
  const codespace = String(process.env.CODESPACE_NAME || '').trim();
  const domain = String(process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || '').trim();
  if (!codespace || !domain) throw new Error('codespace_callback_not_detected_set_FLICKR_OAUTH_CALLBACK');
  return `https://${codespace}-${PORT}.${domain}${CALLBACK_PATH}`;
};

const writeAccess = async (value) => {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(ACCESS_PATH, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
};

const consumer = await readConsumer();
const callback = resolveCallbackUrl();
let requestToken = null;
let requestTokenSecret = null;
let completed = false;
let rejectCompletion;
let resolveCompletion;
const completion = new Promise((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    if (requestUrl.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const returnedToken = String(requestUrl.searchParams.get('oauth_token') || '');
    const verifier = String(requestUrl.searchParams.get('oauth_verifier') || '');
    if (!requestToken || returnedToken !== requestToken || !/^[A-Za-z0-9_-]{4,256}$/.test(verifier)) {
      throw new Error('flickr_oauth_callback_token_or_verifier_invalid');
    }

    const response = await fetchSignedOAuthGet({
      url: ACCESS_TOKEN_URL,
      consumerKey: consumer.apiKey,
      consumerSecret: consumer.apiSecret,
      token: requestToken,
      tokenSecret: requestTokenSecret,
      oauthExtra: { oauth_verifier: verifier },
      accept: 'text/plain,*/*;q=0.5',
    });
    const parsed = parseFormEncoded(await response.text());
    if (!parsed.oauth_token || !parsed.oauth_token_secret || !parsed.user_nsid) throw new Error('flickr_access_token_response_invalid');

    await writeAccess({
      accessToken: parsed.oauth_token,
      accessTokenSecret: parsed.oauth_token_secret,
      userNsid: parsed.user_nsid,
      username: parsed.username || null,
      fullname: parsed.fullname || null,
      permission: 'read',
      storedAt: new Date().toISOString(),
    });
    completed = true;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Artes Flickr research</title><body style="font-family:system-ui;padding:2rem"><h1>Flickr gekoppeld</h1><p>Read-only research access is lokaal opgeslagen. Je kunt terug naar de terminal.</p></body>');
    resolveCompletion({ userNsid: parsed.user_nsid, username: parsed.username || null });
  } catch (error) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Flickr authorization failed. Return to the terminal.');
    rejectCompletion(error);
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, '0.0.0.0', resolve);
});

try {
  const response = await fetchSignedOAuthGet({
    url: REQUEST_TOKEN_URL,
    consumerKey: consumer.apiKey,
    consumerSecret: consumer.apiSecret,
    oauthExtra: { oauth_callback: callback },
    accept: 'text/plain,*/*;q=0.5',
  });
  const parsed = parseFormEncoded(await response.text());
  if (parsed.oauth_callback_confirmed !== 'true' || !parsed.oauth_token || !parsed.oauth_token_secret) throw new Error('flickr_request_token_response_invalid');
  requestToken = parsed.oauth_token;
  requestTokenSecret = parsed.oauth_token_secret;

  const authorize = new URL(AUTHORIZE_URL);
  authorize.searchParams.set('oauth_token', requestToken);
  authorize.searchParams.set('perms', 'read');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    waitingForAuthorization: true,
    callbackUrl: callback,
    authorizationUrl: authorize.toString(),
    requestedPermission: 'read',
    next: 'Open authorizationUrl in your browser and approve read access. Keep this terminal running.',
    secretPrinted: false,
  }, null, 2)}\n`);

  const timer = setTimeout(() => rejectCompletion(new Error('flickr_oauth_callback_timeout')), TIMEOUT_MS);
  const result = await completion;
  clearTimeout(timer);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    authorized: true,
    userNsid: result.userNsid,
    username: result.username,
    permission: 'read',
    tokenPrinted: false,
    stored: '.tmp/moderation-flickr-oauth/access-token.json',
  }, null, 2)}\n`);
} finally {
  if (!completed) process.stderr.write('Flickr authorization did not complete. No access token was printed.\n');
  await new Promise((resolve) => server.close(() => resolve()));
}
