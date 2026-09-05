import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'docs', 'moderation-creative-explicit-discovery-v1.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'creative-explicit-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'flickr-candidates.json');
const FLICKR_HOSTS = new Set(['www.flickr.com', 'flickr.com']);
const EXACT_PHOTO_PATH = /^\/photos\/([^/]+)\/(\d+)\/?$/;
const USER_AGENT = 'ArtesModerationResearch/1.0';

const clean = (value) => String(value || '').trim();
const normalizeText = (value) => clean(value).replace(/\s+/g, ' ').toLowerCase();
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
if (
  config?.status !== 'research_discovery_only'
  || !Array.isArray(config?.tags)
  || config.tags.length < 8
  || config?.rules?.metadataDiscoveryOnly !== true
  || config?.rules?.downloadImageBytes !== false
  || config?.rules?.discoveryIsLabelAuthority !== false
  || config?.rules?.trainingReady !== false
  || config?.rules?.productionEligible !== false
) {
  throw new Error('invalid_creative_explicit_discovery_config');
}

const blockedSignals = (config.obviousNonPhotoTextSignals || []).map(normalizeText).filter(Boolean);
const candidatesByUrl = new Map();
const tagStats = [];

const fetchTagPage = async (tag) => {
  const url = new URL(`https://www.flickr.com/photos/tags/${encodeURIComponent(tag)}/`);
  const response = await fetch(url, {
    headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`flickr_tag_http_${response.status}`);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:' || !FLICKR_HOSTS.has(finalUrl.hostname.toLowerCase())) {
    throw new Error('flickr_tag_redirect_host_not_allowed');
  }
  return response.text();
};

const stripTags = (html) => html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

const collectPhotoLinks = (html, tag) => {
  const linkPattern = /href=["'](https:\/\/(?:www\.)?flickr\.com\/photos\/[^"'#?]+\/\d+\/?|\/photos\/[^"'#?]+\/\d+\/?)["'][^>]*>([\s\S]{0,500}?)<\/a>/gi;
  const matches = [];
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const href = match[1].startsWith('http') ? match[1] : `https://www.flickr.com${match[1]}`;
    const url = new URL(href);
    const pathMatch = url.pathname.match(EXACT_PHOTO_PATH);
    if (!pathMatch) continue;
    const contextStart = Math.max(0, match.index - 350);
    const contextEnd = Math.min(html.length, linkPattern.lastIndex + 900);
    const context = stripTags(html.slice(contextStart, contextEnd));
    const normalized = normalizeText(context);
    const blocked = blockedSignals.find((signal) => normalized.includes(signal)) || null;
    matches.push({
      sourcePageUrl: `https://www.flickr.com/photos/${pathMatch[1]}/${pathMatch[2]}`,
      ownerSlug: pathMatch[1],
      photoId: pathMatch[2],
      anchorText: stripTags(match[2]) || null,
      discoveryTag: tag,
      context: context.slice(0, 1200),
      obviousNonPhotoSignal: blocked,
    });
  }
  return matches;
};

for (const rawTag of config.tags) {
  const tag = clean(rawTag);
  if (!tag) continue;
  try {
    const html = await fetchTagPage(tag);
    const found = collectPhotoLinks(html, tag);
    let acceptedFromTag = 0;
    let blockedFromTag = 0;
    for (const item of found) {
      if (item.obviousNonPhotoSignal) {
        blockedFromTag += 1;
        continue;
      }
      const existing = candidatesByUrl.get(item.sourcePageUrl);
      if (existing) {
        if (!existing.discoveryTags.includes(tag)) existing.discoveryTags.push(tag);
        continue;
      }
      candidatesByUrl.set(item.sourcePageUrl, {
        sourceType: 'flickr_public_photo_page',
        sourcePageUrl: item.sourcePageUrl,
        ownerSlug: item.ownerSlug,
        photoId: item.photoId,
        titleHint: item.anchorText,
        discoveryTags: [tag],
        discoveryContext: item.context,
        discoveryOnly: true,
        humanVisualScreeningRequired: true,
        detectorLabel: null,
        researchOnly: true,
        trainingReady: false,
        productionEligible: false,
      });
      acceptedFromTag += 1;
    }
    tagStats.push({ tag, rawLinkCount: found.length, newCandidateCount: acceptedFromTag, blockedObviousNonPhotoCount: blockedFromTag, error: null });
    process.stdout.write(`Discovered ${acceptedFromTag} new candidates for tag ${tag}; blocked ${blockedFromTag} obvious non-photo candidates.\n`);
  } catch (error) {
    tagStats.push({ tag, rawLinkCount: 0, newCandidateCount: 0, blockedObviousNonPhotoCount: 0, error: clean(error?.message || error).slice(0, 180) });
    process.stdout.write(`Skipped discovery tag ${tag}: ${clean(error?.message || error).slice(0, 180)}\n`);
  }
}

const candidates = [...candidatesByUrl.values()];
const ownerCounts = candidates.reduce((acc, item) => {
  acc[item.ownerSlug] = (acc[item.ownerSlug] || 0) + 1;
  return acc;
}, {});
const ownerCount = Object.keys(ownerCounts).length;
const largestOwnerCount = Math.max(0, ...Object.values(ownerCounts));

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_discovery_only',
  generatedFrom: path.relative(REPO_ROOT, CONFIG_PATH),
  candidateCount: candidates.length,
  ownerCount,
  largestOwnerCount,
  minimumDiscoveryTarget: config.minimumDiscoveryTarget,
  desiredShortlistTarget: config.desiredShortlistTarget,
  targetReached: candidates.length >= Number(config.minimumDiscoveryTarget || 0),
  discoveryIsLabelAuthority: false,
  humanVisualScreeningRequired: true,
  imageBytesDownloaded: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  tagStats,
  ownerCounts,
  candidates,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  candidateCount: candidates.length,
  ownerCount,
  largestOwnerCount,
  minimumDiscoveryTarget: config.minimumDiscoveryTarget,
  desiredShortlistTarget: config.desiredShortlistTarget,
  targetReached: candidates.length >= Number(config.minimumDiscoveryTarget || 0),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  discoveryIsLabelAuthority: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false
}, null, 2)}\n`);
