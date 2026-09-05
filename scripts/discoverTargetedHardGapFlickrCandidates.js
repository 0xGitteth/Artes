import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'docs', 'moderation-hard-gap-targeted-sources-v1.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'hard-gap-targeted-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'flickr-targeted-candidates.json');
const FLICKR_HOSTS = new Set(['www.flickr.com', 'flickr.com']);
const EXACT_PHOTO_PATH = /^\/photos\/([^/]+)\/(\d+)\/?$/;
const ALBUM_PATH = /^\/photos\/([^/]+)\/(?:albums|sets)\/(\d+)\/?$/;
const USER_AGENT = 'ArtesModerationResearch/1.0';
const POSSIBLE_MINOR_SIGNALS = ['child', 'children', 'kid', 'kids', 'teen', 'teenager', 'minor', 'underage', 'preteen', 'schoolgirl', 'schoolboy'];

const clean = (value) => String(value || '').trim();
const normalizeText = (value) => clean(value).replace(/\s+/g, ' ').toLowerCase();
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');
const stripTags = (html) => decodeHtml(String(html || '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 180);

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
if (
  config?.status !== 'research_targeted_source_discovery_only'
  || config?.rules?.publicPagesOnly !== true
  || config?.rules?.noLoginOrPaywallBypass !== true
  || config?.rules?.noAuthOrCookies !== true
  || config?.rules?.metadataDiscoveryOnly !== true
  || config?.rules?.downloadImageBytes !== false
  || config?.rules?.sourceIntentIsLabelAuthority !== false
  || config?.rules?.researchOnly !== true
  || config?.rules?.trainingReady !== false
  || config?.rules?.productionEligible !== false
  || !Array.isArray(config?.sources)
  || config.sources.length < 5
) {
  throw new Error('invalid_targeted_hard_gap_source_config');
}

const assertFlickrUrl = (value, expectedKind) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !FLICKR_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('targeted_source_host_not_allowed');
  }
  const matches = expectedKind === 'photo' ? EXACT_PHOTO_PATH.test(url.pathname) : ALBUM_PATH.test(url.pathname);
  if (!matches) throw new Error(`targeted_source_not_exact_${expectedKind}`);
  return url;
};

const fetchPublicHtml = async (sourceUrl, expectedKind) => {
  const requested = assertFlickrUrl(sourceUrl, expectedKind);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`targeted_flickr_${expectedKind}_http_${response.status}`);
  const finalUrl = assertFlickrUrl(response.url, expectedKind);
  if (finalUrl.pathname.replace(/\/$/, '') !== requested.pathname.replace(/\/$/, '')) {
    throw new Error(`targeted_flickr_${expectedKind}_redirect_mismatch`);
  }
  return response.text();
};

const findPossibleMinorSignal = (text) => {
  const normalized = normalizeText(text);
  for (const signal of POSSIBLE_MINOR_SIGNALS) {
    const pattern = new RegExp(`(^|[^a-z0-9])${signal}([^a-z0-9]|$)`, 'i');
    if (pattern.test(normalized)) return signal;
  }
  return null;
};

const collectAlbumPhotoLinks = (html, source) => {
  const matches = [];
  const seen = new Set();
  const pattern = /href=["'](https:\/\/(?:www\.)?flickr\.com\/photos\/[^"'#?]+\/\d+\/?|\/photos\/[^"'#?]+\/\d+\/?)["']/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const absolute = match[1].startsWith('http') ? match[1] : `https://www.flickr.com${match[1]}`;
    let url;
    try {
      url = assertFlickrUrl(absolute, 'photo');
    } catch {
      continue;
    }
    const identity = url.pathname.replace(/\/$/, '');
    if (seen.has(identity)) continue;
    seen.add(identity);
    const pathMatch = url.pathname.match(EXACT_PHOTO_PATH);
    const contextStart = Math.max(0, match.index - 500);
    const contextEnd = Math.min(html.length, pattern.lastIndex + 1000);
    const localContext = stripTags(html.slice(contextStart, contextEnd)).slice(0, 1400);
    matches.push({
      sourcePageUrl: `https://www.flickr.com/photos/${pathMatch[1]}/${pathMatch[2]}`,
      ownerSlug: pathMatch[1],
      photoId: pathMatch[2],
      localContext: localContext || null,
      metadataPossibleMinorConcernSignal: findPossibleMinorSignal(localContext),
      curatedSourceId: source.sourceId,
      sourcePoolId: source.sourcePoolId,
      targetHints: Array.isArray(source.targetHints) ? source.targetHints : [],
      creator: source.creator || null,
      sourceContext: source.sourceContext || null,
      ageContext: source.ageContext || null,
      termsStatus: source.termsStatus || 'unverified_research_only',
    });
  }
  return matches;
};

const candidateByUrl = new Map();
const sourceStats = [];
const safetyHolds = [];

const addCandidate = (candidate) => {
  if (candidate.metadataPossibleMinorConcernSignal) {
    safetyHolds.push({
      ...candidate,
      safetyHold: 'metadata_possible_minor_concern',
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    });
    return false;
  }
  const existing = candidateByUrl.get(candidate.sourcePageUrl);
  if (existing) {
    existing.curatedSourceIds = Array.from(new Set([...(existing.curatedSourceIds || []), candidate.curatedSourceId]));
    existing.targetHints = Array.from(new Set([...(existing.targetHints || []), ...(candidate.targetHints || [])]));
    return false;
  }
  candidateByUrl.set(candidate.sourcePageUrl, {
    sourceType: 'flickr_public_photo_page',
    sourcePageUrl: candidate.sourcePageUrl,
    ownerSlug: candidate.ownerSlug,
    photoId: candidate.photoId,
    sourcePoolId: candidate.sourcePoolId,
    curatedSourceIds: [candidate.curatedSourceId],
    creator: candidate.creator,
    targetHints: candidate.targetHints,
    discoveryContext: candidate.localContext,
    sourceContext: candidate.sourceContext,
    ageContext: candidate.ageContext,
    termsStatus: candidate.termsStatus,
    sourceIntentIsLabelAuthority: false,
    humanVisualScreeningRequired: true,
    humanAgeSafetyReviewRequired: true,
    detectorLabel: null,
    researchOnly: true,
    trainingReady: false,
    productionEligible: false,
  });
  return true;
};

for (const source of config.sources) {
  const maxCandidates = Math.max(1, Number(source.maxCandidates || config.sourceCandidateCapDefault || 24));
  let discovered = 0;
  let held = 0;
  let error = null;
  try {
    if (source.sourceType === 'flickr_album') {
      const html = await fetchPublicHtml(source.sourceUrl, 'album');
      const albumCandidates = collectAlbumPhotoLinks(html, source).slice(0, maxCandidates);
      for (const candidate of albumCandidates) {
        if (candidate.metadataPossibleMinorConcernSignal) held += 1;
        if (addCandidate(candidate)) discovered += 1;
      }
    } else if (source.sourceType === 'flickr_exact_photos') {
      for (const rawUrl of (source.photoUrls || []).slice(0, maxCandidates)) {
        const url = assertFlickrUrl(rawUrl, 'photo');
        const pathMatch = url.pathname.match(EXACT_PHOTO_PATH);
        const html = await fetchPublicHtml(url.toString(), 'photo');
        const pageContext = stripTags(html).slice(0, 5000);
        const candidate = {
          sourcePageUrl: `https://www.flickr.com/photos/${pathMatch[1]}/${pathMatch[2]}`,
          ownerSlug: pathMatch[1],
          photoId: pathMatch[2],
          localContext: pageContext.slice(0, 1400),
          metadataPossibleMinorConcernSignal: findPossibleMinorSignal(pageContext),
          curatedSourceId: source.sourceId,
          sourcePoolId: source.sourcePoolId,
          targetHints: Array.isArray(source.targetHints) ? source.targetHints : [],
          creator: source.creator || null,
          sourceContext: source.sourceContext || null,
          ageContext: source.ageContext || null,
          termsStatus: source.termsStatus || 'unverified_research_only',
        };
        if (candidate.metadataPossibleMinorConcernSignal) held += 1;
        if (addCandidate(candidate)) discovered += 1;
      }
    } else {
      throw new Error(`unsupported_targeted_source_type:${source.sourceType}`);
    }
  } catch (sourceError) {
    error = safeError(sourceError);
  }
  sourceStats.push({
    sourceId: source.sourceId,
    sourcePoolId: source.sourcePoolId,
    sourceType: source.sourceType,
    targetHints: source.targetHints || [],
    maxCandidates,
    newCandidateCount: discovered,
    safetyHoldCount: held,
    error,
  });
  process.stdout.write(`Targeted source ${source.sourceId}: ${discovered} new candidates, ${held} safety holds${error ? `, error ${error}` : ''}.\n`);
}

const candidates = [...candidateByUrl.values()];
const sourcePoolCount = new Set(candidates.map((item) => item.sourcePoolId).filter(Boolean)).size;
const ownerCount = new Set(candidates.map((item) => item.ownerSlug).filter(Boolean)).size;
const targetHintCounts = candidates.reduce((acc, candidate) => {
  for (const hint of candidate.targetHints || []) acc[hint] = (acc[hint] || 0) + 1;
  return acc;
}, {});

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_targeted_flickr_candidates_only',
  generatedFrom: path.relative(REPO_ROOT, CONFIG_PATH),
  candidateCount: candidates.length,
  safetyHoldCount: safetyHolds.length,
  sourcePoolCount,
  ownerCount,
  targetHintCounts,
  sourceStats,
  sourceIntentIsLabelAuthority: false,
  imageBytesDownloaded: false,
  humanVisualScreeningRequired: true,
  humanAgeSafetyReviewRequired: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  candidates,
  safetyHolds,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  candidateCount: candidates.length,
  safetyHoldCount: safetyHolds.length,
  sourcePoolCount,
  ownerCount,
  targetHintCounts,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  sourceIntentIsLabelAuthority: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
