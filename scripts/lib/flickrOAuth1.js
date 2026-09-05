import crypto from 'node:crypto';

const FLICKR_OAUTH_HOSTS = new Set(['www.flickr.com', 'api.flickr.com']);

export const percentEncode = (value) => encodeURIComponent(String(value))
  .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const nonce = () => crypto.randomBytes(18).toString('hex');
const timestamp = () => Math.floor(Date.now() / 1000).toString();

const normalizePairs = (pairs) => pairs
  .map(([key, value]) => [percentEncode(key), percentEncode(value)])
  .sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)))
  .map(([key, value]) => `${key}=${value}`)
  .join('&');

export const assertFlickrHttpsUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !FLICKR_OAUTH_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('flickr_oauth_host_not_allowed');
  }
  return url;
};

export const signOAuthGetUrl = ({
  url: inputUrl,
  consumerKey,
  consumerSecret,
  token = null,
  tokenSecret = '',
  oauthExtra = {},
  query = {},
}) => {
  if (!consumerKey || !consumerSecret) throw new Error('flickr_oauth_consumer_credentials_missing');
  const url = assertFlickrHttpsUrl(inputUrl);
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp(),
    oauth_version: '1.0',
    ...oauthExtra,
  };
  if (token) oauth.oauth_token = token;

  const pairs = [];
  for (const [key, value] of url.searchParams.entries()) pairs.push([key, value]);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    pairs.push([key, String(value)]);
  }
  for (const [key, value] of Object.entries(oauth)) {
    if (value === undefined || value === null) continue;
    pairs.push([key, String(value)]);
  }

  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const normalized = normalizePairs(pairs);
  const baseString = ['GET', percentEncode(baseUrl), percentEncode(normalized)].join('&');
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || '')}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  const signed = new URL(baseUrl);
  for (const [key, value] of url.searchParams.entries()) signed.searchParams.append(key, value);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) signed.searchParams.append(key, String(value));
  }
  for (const [key, value] of Object.entries(oauth)) {
    if (value !== undefined && value !== null) signed.searchParams.append(key, String(value));
  }
  signed.searchParams.append('oauth_signature', signature);
  return signed;
};

export const parseFormEncoded = (text) => Object.fromEntries(new URLSearchParams(String(text || '')).entries());

export const fetchSignedOAuthGet = async (options) => {
  const url = signOAuthGetUrl(options);
  const response = await fetch(url, {
    headers: { Accept: options.accept || 'application/json,text/plain;q=0.8,*/*;q=0.5' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`flickr_oauth_http_${response.status}`);
  const finalUrl = assertFlickrHttpsUrl(response.url);
  if (finalUrl.origin !== url.origin) throw new Error('flickr_oauth_redirect_origin_mismatch');
  return response;
};
