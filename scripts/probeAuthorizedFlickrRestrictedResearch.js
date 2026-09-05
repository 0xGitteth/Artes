import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSignedOAuthGet } from './lib/flickrOAuth1.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const STATE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-flickr-oauth');
const CONSUMER_PATH = path.join(STATE_DIR, 'consumer.json');
const ACCESS_PATH = path.join(STATE_DIR, 'access-token.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'authorized-flickr-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'restricted-visibility-probe.json');
const REST_URL = 'https://www.flickr.com/services/rest';
const TARGET_USER_NSID = '128438623@N07';
const TARGET_ALBUMS = [
  { id: '72157651222352217', name: 'nude / self-arousal' },
  { id: '72157650849252192', name: 'nude / erotic' },
];

const readJson = async (filePath, label) => {
  try { return JSON.parse(await readFile(filePath, 'utf8')); }
  catch { throw new Error(`${label}_missing_complete_oauth_setup_first`); }
};

const apiCall = async ({ consumer, access, method, params = {} }) => {
  const response = await fetchSignedOAuthGet({
    url: REST_URL,
    consumerKey: consumer.apiKey,
    consumerSecret: consumer.apiSecret,
    token: access.accessToken,
    tokenSecret: access.accessTokenSecret,
    query: {
      method,
      api_key: consumer.apiKey,
      format: 'json',
      nojsoncallback: '1',
      ...params,
    },
    accept: 'application/json,*/*;q=0.5',
  });
  const data = JSON.parse(await response.text());
  if (data?.stat !== 'ok') throw new Error(`flickr_api_${method}_${data?.code || 'failed'}:${String(data?.message || '').slice(0, 120)}`);
  return data;
};

const compactPhoto = (photo) => ({
  id: String(photo.id || ''),
  owner: String(photo.owner || TARGET_USER_NSID),
  title: String(photo.title || ''),
  license: photo.license ?? null,
  dateTaken: photo.datetaken || null,
  tags: String(photo.tags || '').split(/\s+/).filter(Boolean).slice(0, 40),
  media: photo.media || 'photo',
  pathAlias: photo.pathalias || null,
  urlQ: photo.url_q || null,
  urlZ: photo.url_z || null,
});

const searchUser = async (consumer, access, safeSearch) => {
  const data = await apiCall({
    consumer,
    access,
    method: 'flickr.photos.search',
    params: {
      user_id: TARGET_USER_NSID,
      safe_search: String(safeSearch),
      content_types: '0',
      media: 'photos',
      per_page: '500',
      page: '1',
      extras: 'license,date_taken,owner_name,tags,path_alias,url_q,url_z,media',
    },
  });
  return {
    total: Number(data.photos?.total || 0),
    pageCount: Array.isArray(data.photos?.photo) ? data.photos.photo.length : 0,
    photos: (data.photos?.photo || []).map(compactPhoto),
  };
};

const getAlbum = async (consumer, access, album) => {
  const data = await apiCall({
    consumer,
    access,
    method: 'flickr.photosets.getPhotos',
    params: {
      photoset_id: album.id,
      user_id: TARGET_USER_NSID,
      per_page: '500',
      page: '1',
      media: 'photos',
      extras: 'license,date_upload,date_taken,owner_name,tags,path_alias,url_q,url_z,media',
    },
  });
  return {
    id: album.id,
    name: album.name,
    total: Number(data.photoset?.total || 0),
    pageCount: Array.isArray(data.photoset?.photo) ? data.photoset.photo.length : 0,
    photos: (data.photoset?.photo || []).map(compactPhoto),
  };
};

const consumer = await readJson(CONSUMER_PATH, 'flickr_consumer_credentials');
const access = await readJson(ACCESS_PATH, 'flickr_access_token');

const auth = await apiCall({ consumer, access, method: 'flickr.auth.oauth.checkToken' });
const permission = auth?.oauth?.perms?._content || auth?.oauth?.perms || null;
const authenticatedUserNsid = auth?.oauth?.user?.nsid || access.userNsid || null;
if (!['read', 'write', 'delete'].includes(String(permission || '').toLowerCase())) {
  throw new Error('flickr_oauth_read_permission_not_confirmed');
}

const safe = await searchUser(consumer, access, 1);
const restrictedSetting = await searchUser(consumer, access, 3);
const safeIds = new Set(safe.photos.map((photo) => photo.id));
const restrictedOnly = restrictedSetting.photos.filter((photo) => !safeIds.has(photo.id));
const albums = [];
for (const album of TARGET_ALBUMS) albums.push(await getAlbum(consumer, access, album));

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'authorized_flickr_research_probe_only',
  generatedAt: new Date().toISOString(),
  targetUserNsid: TARGET_USER_NSID,
  authenticatedUserNsid,
  permission,
  safeSearch1: safe,
  safeSearch3: restrictedSetting,
  safeSearch3IdsNotInSafeSearch1: restrictedOnly,
  albums,
  imageBytesDownloaded: false,
  discoveryIsLabelAuthority: false,
  humanVisualScreeningRequired: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  authenticated: true,
  permission,
  targetUserNsid: TARGET_USER_NSID,
  safeSearch1Total: safe.total,
  safeSearch3Total: restrictedSetting.total,
  safeSearch3PageCount: restrictedSetting.pageCount,
  safeSearch3IdsNotInSafeSearch1Count: restrictedOnly.length,
  albumCounts: Object.fromEntries(albums.map((album) => [album.name, album.total])),
  restrictedVisibilityEvidenceFound: restrictedOnly.length > 0 || albums.some((album) => album.total > (album.name === 'nude / self-arousal' ? 2 : 1)),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  tokenPrinted: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
