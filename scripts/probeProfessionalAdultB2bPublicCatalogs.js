import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'docs', 'moderation-professional-adult-b2b-public-catalog-sources-v1.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'catalog-probe.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const YOUTH_CODED = /\bteen(?:s|age|ager)?\b|school\s*girl|barely\s*legal/gi;
const EXPLICIT_MARKER = /\bhardcore\b|\banal\b|\boral\b|penetrat|cum\s*shot|cumshot|masturbat|fisting|\btoys?\b|\bsex\b/gi;

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
  config?.status !== 'research_professional_adult_b2b_public_catalog_sources'
  || config?.rules?.publicCatalogPagesOnly !== true
  || config?.rules?.noLogin !== true
  || config?.rules?.noPurchase !== true
  || config?.rules?.noPaywallBypass !== true
  || config?.rules?.noSessionCookieReuse !== true
  || config?.rules?.metadataDiscoveryOnly !== true
  || config?.rules?.downloadImageBytes !== false
  || config?.rules?.sourceIntentIsLabelAuthority !== false
  || config?.rules?.youthCodedMarketingIsNotAgeProof !== true
  || config?.rules?.researchOnly !== true
  || config?.rules?.trainingReady !== false
  || config?.rules?.productionEligible !== false
) throw new Error('invalid_b2b_public_catalog_config');

const allowedHostsFor = (source) => new Set((source.allowedHosts || []).map((host) => clean(host).toLowerCase()).filter(Boolean));
const assertSeed = (rawUrl, source) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('b2b_catalog_seed_not_https');
  if (!allowedHostsFor(source).has(url.hostname.toLowerCase())) throw new Error('b2b_catalog_seed_host_not_allowed');
  return url;
};

const fetchPublicHtml = async (rawUrl, source) => {
  const requested = assertSeed(rawUrl, source);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`b2b_catalog_http_${response.status}`);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:') throw new Error('b2b_catalog_redirect_not_https');
  if (!allowedHostsFor(source).has(finalUrl.hostname.toLowerCase())) throw new Error('b2b_catalog_redirect_host_not_allowed');
  return { html: await response.text(), finalUrl };
};

const stripTags = (html) => decodeHtml(String(html || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
const countMatches = (text, regex) => (text.match(regex) || []).length;

const collectLinks = (html, pageUrl, source) => {
  const patterns = (source.productEvidencePatterns || []).map((pattern) => new RegExp(pattern, 'i'));
  const strong = new Map();
  const screenshots = new Map();
  const sameHost = new Map();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) !== null) {
    let url;
    try { url = new URL(decodeHtml(match[1]), pageUrl); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol)) continue;
    if (url.protocol === 'http:') url.protocol = 'https:';
    url.hash = '';
    const anchorText = decodeHtml(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim().slice(0, 240);
    const evidence = `${url.hostname} ${url.pathname} ${url.search} ${anchorText}`;
    if (allowedHostsFor(source).has(url.hostname.toLowerCase())) sameHost.set(url.toString(), { url: url.toString(), anchorText: anchorText || null });
    if (patterns.some((pattern) => pattern.test(evidence))) strong.set(url.toString(), { url: url.toString(), anchorText: anchorText || null });
    if (/screenshots?|preview|sample/i.test(evidence)) screenshots.set(url.toString(), { url: url.toString(), anchorText: anchorText || null });
  }
  return { strong: [...strong.values()], screenshots: [...screenshots.values()], sameHost: [...sameHost.values()] };
};

const collectImageReferences = (html, pageUrl) => {
  const found = new Map();
  const add = (raw, origin) => {
    const value = decodeHtml(clean(raw));
    if (!value || value.startsWith('data:') || value.startsWith('blob:')) return;
    let url;
    try { url = new URL(value, pageUrl); } catch { return; }
    if (!['https:', 'http:'].includes(url.protocol)) return;
    if (url.protocol === 'http:') url.protocol = 'https:';
    const key = url.toString();
    if (!found.has(key)) found.set(key, { url: key, host: url.hostname.toLowerCase(), origins: [origin] });
    else found.get(key).origins = Array.from(new Set([...found.get(key).origins, origin]));
  };

  const imgPattern = /<img\b[^>]*>/gi;
  let match;
  while ((match = imgPattern.exec(html)) !== null) {
    const tag = match[0];
    for (const attr of ['src', 'data-src', 'data-lazy-src', 'data-original']) {
      const attrMatch = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
      if (attrMatch?.[1]) add(attrMatch[1], `img_${attr}`);
    }
    for (const attr of ['srcset', 'data-srcset']) {
      const attrMatch = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
      if (!attrMatch?.[1]) continue;
      for (const part of attrMatch[1].split(',')) add(part.trim().split(/\s+/)[0], `img_${attr}`);
    }
  }
  return [...found.values()];
};

const sourceResults = [];
for (const source of config.sources || []) {
  const pageResults = [];
  for (const page of source.seedPages || []) {
    try {
      const { html, finalUrl } = await fetchPublicHtml(page, source);
      const text = stripTags(html);
      const links = collectLinks(html, finalUrl, source);
      const images = collectImageReferences(html, finalUrl);
      pageResults.push({
        requestedUrl: page,
        finalUrl: finalUrl.toString(),
        htmlByteLength: Buffer.byteLength(html, 'utf8'),
        strongProductLinks: links.strong,
        screenshotOrPreviewLinks: links.screenshots,
        sameHostLinkCount: links.sameHost.length,
        imageReferences: images,
        explicitMarkerCount: countMatches(text, EXPLICIT_MARKER),
        youthCodedMarketingMarkerCount: countMatches(text, YOUTH_CODED),
        error: null,
      });
    } catch (error) {
      pageResults.push({ requestedUrl: page, finalUrl: null, strongProductLinks: [], screenshotOrPreviewLinks: [], imageReferences: [], explicitMarkerCount: 0, youthCodedMarketingMarkerCount: 0, error: safeError(error) });
    }
  }

  const uniqueStrong = new Map();
  const uniqueScreenshots = new Map();
  const uniqueImages = new Map();
  for (const page of pageResults) {
    for (const item of page.strongProductLinks || []) uniqueStrong.set(item.url, item);
    for (const item of page.screenshotOrPreviewLinks || []) uniqueScreenshots.set(item.url, item);
    for (const item of page.imageReferences || []) uniqueImages.set(item.url, item);
  }
  const assetHostCounts = [...uniqueImages.values()].reduce((acc, item) => {
    acc[item.host] = (acc[item.host] || 0) + 1;
    return acc;
  }, {});
  const result = {
    sourceId: source.sourceId,
    priority: source.priority,
    pageCount: pageResults.length,
    successfulPageCount: pageResults.filter((page) => !page.error).length,
    strongProductLinkCount: uniqueStrong.size,
    screenshotOrPreviewLinkCount: uniqueScreenshots.size,
    imageReferenceCount: uniqueImages.size,
    assetHostCounts,
    explicitMarkerCount: pageResults.reduce((sum, page) => sum + page.explicitMarkerCount, 0),
    youthCodedMarketingMarkerCount: pageResults.reduce((sum, page) => sum + page.youthCodedMarketingMarkerCount, 0),
    ageContext: source.ageContext,
    rightsContext: source.rightsContext,
    sourceDiversityContext: source.sourceDiversityContext,
    targetHints: source.targetHints,
    pages: pageResults,
    strongProductLinks: [...uniqueStrong.values()],
    screenshotOrPreviewLinks: [...uniqueScreenshots.values()],
    imageReferences: [...uniqueImages.values()],
  };
  sourceResults.push(result);
  process.stdout.write(`B2B catalog ${source.sourceId}: ${result.successfulPageCount}/${result.pageCount} pages, ${result.strongProductLinkCount} strong product links, ${result.screenshotOrPreviewLinkCount} preview links, ${result.imageReferenceCount} image refs, ${result.explicitMarkerCount} explicit markers, ${result.youthCodedMarketingMarkerCount} youth-coded marketing markers.\n`);
}

const totalStrongProductLinks = new Set(sourceResults.flatMap((result) => result.strongProductLinks.map((item) => item.url))).size;
const totalPreviewLinks = new Set(sourceResults.flatMap((result) => result.screenshotOrPreviewLinks.map((item) => item.url))).size;
const totalImageReferences = new Set(sourceResults.flatMap((result) => result.imageReferences.map((item) => item.url))).size;

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_professional_adult_b2b_public_catalog_probe_only',
  generatedFrom: path.relative(REPO_ROOT, CONFIG_PATH),
  sourceCount: sourceResults.length,
  totalStrongProductLinks,
  totalPreviewLinks,
  totalImageReferences,
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  sourceIntentIsLabelAuthority: false,
  humanVisualScreeningRequired: true,
  youthCodedMarketingIsNotAgeProof: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  sources: sourceResults,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  sourceCount: sourceResults.length,
  totalStrongProductLinks,
  totalPreviewLinks,
  totalImageReferences,
  bySource: Object.fromEntries(sourceResults.map((result) => [result.sourceId, {
    successfulPages: result.successfulPageCount,
    strongProductLinks: result.strongProductLinkCount,
    previewLinks: result.screenshotOrPreviewLinkCount,
    imageReferences: result.imageReferenceCount,
    explicitMarkers: result.explicitMarkerCount,
    youthCodedMarketingMarkers: result.youthCodedMarketingMarkerCount,
  }])),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
