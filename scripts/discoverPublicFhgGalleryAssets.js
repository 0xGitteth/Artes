import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'docs', 'moderation-public-fhg-sources-v1.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'public-fhg-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'gallery-assets.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';

const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 220);
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
if (
  config?.status !== 'research_public_fhg_source_discovery_only'
  || config?.rules?.publicPagesOnly !== true
  || config?.rules?.noLoginOrPaywallBypass !== true
  || config?.rules?.noAffiliateAccountRequired !== true
  || config?.rules?.noAffiliateIdFabrication !== true
  || config?.rules?.noMemberArea !== true
  || config?.rules?.metadataDiscoveryOnly !== true
  || config?.rules?.downloadImageBytes !== false
  || config?.rules?.sourceIntentIsLabelAuthority !== false
  || config?.rules?.researchOnly !== true
  || config?.rules?.trainingReady !== false
  || config?.rules?.productionEligible !== false
) throw new Error('invalid_public_fhg_config');

const allowedHostsFor = (source) => new Set((source.allowedHosts || []).map((host) => clean(host).toLowerCase()).filter(Boolean));

const assertHttpsAllowed = (rawUrl, source) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('public_fhg_url_not_https');
  if (!allowedHostsFor(source).has(url.hostname.toLowerCase())) throw new Error('public_fhg_host_not_allowed');
  return url;
};

const fetchPublicHtml = async (rawUrl, source) => {
  const requested = assertHttpsAllowed(rawUrl, source);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`public_fhg_http_${response.status}`);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:') throw new Error('public_fhg_redirect_not_https');
  if (!allowedHostsFor(source).has(finalUrl.hostname.toLowerCase())) throw new Error('public_fhg_redirect_host_not_allowed');
  return { html: await response.text(), finalUrl };
};

const normalizeGalleryLink = (rawHref, pageUrl, source) => {
  const decoded = decodeHtml(clean(rawHref));
  if (!decoded || decoded.startsWith('#') || decoded.startsWith('javascript:') || decoded.startsWith('mailto:')) return null;
  let url;
  try { url = new URL(decoded, pageUrl); } catch { return null; }
  if (!allowedHostsFor(source).has(url.hostname.toLowerCase())) return null;
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') return null;
  const pattern = new RegExp(source.galleryPathPattern, 'i');
  if (!pattern.test(url.pathname)) return null;
  // Affiliate IDs are tracking only. Never fabricate one; discover the public gallery path itself.
  url.search = '';
  url.hash = '';
  return url.toString();
};

const collectGalleryLinksFromIndex = (html, pageUrl, source) => {
  const out = [];
  const seen = new Set();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) !== null) {
    const normalized = normalizeGalleryLink(match[1], pageUrl, source);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  // Some legacy affiliate pages print gallery URLs as plain text instead of anchors.
  const plainPattern = /https?:\/\/(?:www\.)?mastasia\.com\/affiliates\/fhg\/[A-Za-z0-9_./-]+\.php(?:\?[^\s<"']*)?/gi;
  while ((match = plainPattern.exec(html)) !== null) {
    const normalized = normalizeGalleryLink(match[0], pageUrl, source);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.slice(0, Math.max(1, Number(source.maxGalleryPages || 24)));
};

const normalizeAssetUrl = (raw, pageUrl) => {
  const decoded = decodeHtml(clean(raw)).replace(/^['"]|['"]$/g, '');
  if (!decoded || decoded.startsWith('data:') || decoded.startsWith('blob:') || decoded.startsWith('javascript:')) return null;
  try {
    const url = new URL(decoded, pageUrl);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
};

const collectImageCandidates = (html, pageUrl) => {
  const byUrl = new Map();
  const add = (rawUrl, origin) => {
    const normalized = normalizeAssetUrl(rawUrl, pageUrl);
    if (!normalized) return;
    const existing = byUrl.get(normalized);
    if (existing) {
      existing.origins = Array.from(new Set([...existing.origins, origin]));
      return;
    }
    const url = new URL(normalized);
    byUrl.set(normalized, { assetUrl: normalized, assetHost: url.hostname.toLowerCase(), origins: [origin] });
  };

  const metaPatterns = [
    /<meta\b[^>]*(?:property|name)=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["'][^>]*>/gi,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::url)?["'][^>]*>/gi,
  ];
  for (const pattern of metaPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) add(match[1], 'meta_image');
  }

  const imgPattern = /<img\b[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgPattern.exec(html)) !== null) {
    const tag = imgMatch[0];
    for (const attr of ['src', 'data-src', 'data-lazy-src', 'data-original']) {
      const match = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
      if (match?.[1]) add(match[1], `img_${attr}`);
    }
    for (const attr of ['srcset', 'data-srcset']) {
      const match = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
      if (!match?.[1]) continue;
      for (const part of match[1].split(',')) add(part.trim().split(/\s+/)[0], `img_${attr}`);
    }
  }
  return [...byUrl.values()];
};

const galleryRecords = [];
const assetByUrl = new Map();
const sourceStats = [];

const addAssets = (source, galleryUrl, assets) => {
  for (const asset of assets) {
    const existing = assetByUrl.get(asset.assetUrl);
    if (existing) {
      existing.sourceIds = Array.from(new Set([...existing.sourceIds, source.sourceId]));
      existing.galleryUrls = Array.from(new Set([...existing.galleryUrls, galleryUrl]));
      existing.targetHints = Array.from(new Set([...existing.targetHints, ...(source.targetHints || [])]));
      existing.origins = Array.from(new Set([...existing.origins, ...asset.origins]));
      continue;
    }
    assetByUrl.set(asset.assetUrl, {
      assetUrl: asset.assetUrl,
      assetHost: asset.assetHost,
      sourceIds: [source.sourceId],
      galleryUrls: [galleryUrl],
      targetHints: source.targetHints || [],
      origins: asset.origins,
      ageContext: source.ageContext || null,
      rightsContext: source.rightsContext || null,
      termsStatus: source.termsStatus || 'unverified_research_only',
      sourceIntentIsLabelAuthority: false,
      imageBytesDownloaded: false,
      humanVisualScreeningRequired: true,
      detectorLabel: null,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    });
  }
};

for (const source of config.sources || []) {
  const galleries = [];
  const errors = [];
  try {
    if (source.sourceType === 'publisher_public_fhg_index') {
      const { html, finalUrl } = await fetchPublicHtml(source.indexUrl, source);
      galleries.push(...collectGalleryLinksFromIndex(html, finalUrl, source));
    } else if (source.sourceType === 'publisher_exact_public_fhg') {
      for (const raw of (source.galleryUrls || []).slice(0, Math.max(1, Number(source.maxGalleryPages || 24)))) {
        galleries.push(assertHttpsAllowed(raw, source).toString());
      }
    } else {
      throw new Error(`unsupported_public_fhg_source_type:${source.sourceType}`);
    }
  } catch (error) {
    errors.push({ stage: 'source_discovery', error: safeError(error) });
  }

  let fetchedGalleryCount = 0;
  let assetCandidateCount = 0;
  for (const galleryUrl of galleries) {
    try {
      const { html, finalUrl } = await fetchPublicHtml(galleryUrl, source);
      fetchedGalleryCount += 1;
      const assets = collectImageCandidates(html, finalUrl);
      assetCandidateCount += assets.length;
      addAssets(source, finalUrl.toString(), assets);
      galleryRecords.push({
        sourceId: source.sourceId,
        requestedGalleryUrl: galleryUrl,
        finalGalleryUrl: finalUrl.toString(),
        assetCandidateCount: assets.length,
        error: null,
      });
    } catch (error) {
      galleryRecords.push({ sourceId: source.sourceId, requestedGalleryUrl: galleryUrl, finalGalleryUrl: null, assetCandidateCount: 0, error: safeError(error) });
    }
  }

  sourceStats.push({
    sourceId: source.sourceId,
    discoveredGalleryCount: galleries.length,
    fetchedGalleryCount,
    rawAssetCandidateCount: assetCandidateCount,
    errors,
  });
  process.stdout.write(`Public FHG source ${source.sourceId}: ${galleries.length} galleries discovered, ${fetchedGalleryCount} fetched, ${assetCandidateCount} raw image assets.\n`);
}

const candidates = [...assetByUrl.values()];
const assetHostCounts = candidates.reduce((acc, item) => {
  acc[item.assetHost] = (acc[item.assetHost] || 0) + 1;
  return acc;
}, {});

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_public_fhg_gallery_asset_candidates_only',
  generatedFrom: path.relative(REPO_ROOT, CONFIG_PATH),
  sourceCount: (config.sources || []).length,
  galleryRecordCount: galleryRecords.length,
  candidateCount: candidates.length,
  assetHostCounts,
  sourceStats,
  galleryRecords,
  imageBytesDownloaded: false,
  sourceIntentIsLabelAuthority: false,
  humanVisualScreeningRequired: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  candidates,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  sourceCount: (config.sources || []).length,
  galleryRecordCount: galleryRecords.length,
  candidateCount: candidates.length,
  assetHostCounts,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  sourceIntentIsLabelAuthority: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
