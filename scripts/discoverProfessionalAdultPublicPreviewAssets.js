import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'docs', 'moderation-professional-adult-public-preview-sources-v1.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-public-preview-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'asset-candidates.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';

const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 220);

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
if (
  config?.status !== 'research_professional_adult_public_preview_sources'
  || config?.rules?.publicPreviewOnly !== true
  || config?.rules?.noMemberArea !== true
  || config?.rules?.noPaywallBypass !== true
  || config?.rules?.noLoginBypass !== true
  || config?.rules?.noAgeGateBypass !== true
  || config?.rules?.sourceIntentIsLabelAuthority !== false
  || config?.rules?.researchOnly !== true
  || config?.rules?.trainingReady !== false
  || config?.rules?.productionEligible !== false
) {
  throw new Error('invalid_professional_adult_public_preview_config');
}

const automatedSources = (config.sources || []).filter((source) => source.automatedDiscoveryEligible === true);
if (automatedSources.length < 2) throw new Error('not_enough_automated_public_preview_sources');

const sourceAllowedHosts = (source) => new Set([
  ...(source.baseHost ? [source.baseHost] : []),
  ...((source.baseHosts || [])),
].map((host) => clean(host).toLowerCase()).filter(Boolean));

const assertPublicSeedPage = (rawUrl, source) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('public_preview_seed_must_be_https');
  const allowed = sourceAllowedHosts(source);
  if (!allowed.has(url.hostname.toLowerCase())) throw new Error('public_preview_seed_host_not_allowed');
  return url;
};

const fetchPublicHtml = async (rawUrl, source) => {
  const requested = assertPublicSeedPage(rawUrl, source);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`public_preview_http_${response.status}`);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:') throw new Error('public_preview_redirect_not_https');
  if (!sourceAllowedHosts(source).has(finalUrl.hostname.toLowerCase())) throw new Error('public_preview_redirect_host_not_allowed');
  return { html: await response.text(), finalUrl };
};

const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');

const normalizeAssetUrl = (raw, pageUrl) => {
  const cleaned = decodeHtml(clean(raw)).replace(/^['"]|['"]$/g, '');
  if (!cleaned || cleaned.startsWith('data:') || cleaned.startsWith('blob:') || cleaned.startsWith('javascript:')) return null;
  try {
    const url = new URL(cleaned, pageUrl);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
};

const collectHtmlImageCandidates = (html, pageUrl) => {
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
    byUrl.set(normalized, {
      assetUrl: normalized,
      assetHost: url.hostname.toLowerCase(),
      origins: [origin],
    });
  };

  const metaPatterns = [
    /<meta\b[^>]*(?:property|name)=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["'][^>]*>/gi,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::url)?["'][^>]*>/gi,
    /<meta\b[^>]*(?:property|name)=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["'][^>]*>/gi,
  ];
  for (const pattern of metaPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) add(match[1], 'meta_image');
  }

  const imgPattern = /<img\b[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgPattern.exec(html)) !== null) {
    const tag = imgMatch[0];
    const attrs = ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-image'];
    for (const attr of attrs) {
      const match = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
      if (match?.[1]) add(match[1], `img_${attr}`);
    }
    for (const attr of ['srcset', 'data-srcset']) {
      const match = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
      if (!match?.[1]) continue;
      for (const part of match[1].split(',')) add(part.trim().split(/\s+/)[0], `img_${attr}`);
    }
  }

  const sourcePattern = /<source\b[^>]*srcset=["']([^"']+)["'][^>]*>/gi;
  let sourceMatch;
  while ((sourceMatch = sourcePattern.exec(html)) !== null) {
    for (const part of sourceMatch[1].split(',')) add(part.trim().split(/\s+/)[0], 'source_srcset');
  }

  return [...byUrl.values()];
};

const sourceStats = [];
const candidateByUrl = new Map();

for (const source of automatedSources) {
  let pageCount = 0;
  let candidateCount = 0;
  const assetHosts = new Map();
  const errors = [];

  for (const seedPage of source.seedPages || []) {
    try {
      const { html, finalUrl } = await fetchPublicHtml(seedPage, source);
      pageCount += 1;
      const pageCandidates = collectHtmlImageCandidates(html, finalUrl);
      for (const candidate of pageCandidates) {
        assetHosts.set(candidate.assetHost, (assetHosts.get(candidate.assetHost) || 0) + 1);
        const existing = candidateByUrl.get(candidate.assetUrl);
        if (existing) {
          existing.sourceIds = Array.from(new Set([...existing.sourceIds, source.sourceId]));
          existing.seedPages = Array.from(new Set([...existing.seedPages, seedPage]));
          existing.targetHints = Array.from(new Set([...existing.targetHints, ...(source.targetHints || [])]));
          existing.origins = Array.from(new Set([...existing.origins, ...candidate.origins]));
          continue;
        }
        candidateByUrl.set(candidate.assetUrl, {
          assetUrl: candidate.assetUrl,
          assetHost: candidate.assetHost,
          sourceIds: [source.sourceId],
          seedPages: [seedPage],
          origins: candidate.origins,
          targetHints: source.targetHints || [],
          ageContext: source.ageContext || null,
          termsStatus: source.termsStatus || 'unverified_research_only',
          sourceIntentIsLabelAuthority: false,
          imageBytesDownloaded: false,
          humanVisualScreeningRequired: true,
          detectorLabel: null,
          researchOnly: true,
          trainingReady: false,
          productionEligible: false,
        });
        candidateCount += 1;
      }
    } catch (error) {
      errors.push({ seedPage, error: safeError(error) });
    }
  }

  sourceStats.push({
    sourceId: source.sourceId,
    seedPageCount: (source.seedPages || []).length,
    fetchedPageCount: pageCount,
    newAssetCandidateCount: candidateCount,
    assetHosts: Object.fromEntries([...assetHosts.entries()].sort((a, b) => b[1] - a[1])),
    errors,
  });
  process.stdout.write(`Professional adult source ${source.sourceId}: ${candidateCount} new asset candidates from ${pageCount}/${(source.seedPages || []).length} pages.\n`);
}

const candidates = [...candidateByUrl.values()];
const assetHostCounts = candidates.reduce((acc, candidate) => {
  acc[candidate.assetHost] = (acc[candidate.assetHost] || 0) + 1;
  return acc;
}, {});

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_professional_adult_public_preview_asset_candidates_only',
  generatedFrom: path.relative(REPO_ROOT, CONFIG_PATH),
  sourceCount: automatedSources.length,
  candidateCount: candidates.length,
  assetHostCounts,
  sourceStats,
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
  sourceCount: automatedSources.length,
  candidateCount: candidates.length,
  assetHostCounts,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  sourceIntentIsLabelAuthority: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
