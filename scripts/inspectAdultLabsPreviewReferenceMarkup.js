import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const OUTPUT_PATH = path.join(ROOT, 'adultlabs-preview-reference-markup-diagnostic.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const ALLOWED_HOSTS = new Set(['adultlabs.com', 'www.adultlabs.com']);

const SAMPLE_SET_IDS = ['1233407700', '1236628938', '1326651498'];
const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 220);
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');

const assertPublicUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('adultlabs_preview_diagnostic_url_not_allowed');
  }
  return url;
};

const fetchHtml = async (rawUrl) => {
  const requested = assertPublicUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`adultlabs_preview_diagnostic_http_${response.status}`);
  const finalUrl = assertPublicUrl(response.url);
  return { html: await response.text(), finalUrl };
};

const normalizeReference = (raw, pageUrl) => {
  let value = decodeHtml(clean(raw)).replace(/^['"]|['"]$/g, '');
  if (!value || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('javascript:')) return null;
  value = value.replace(/\\\//g, '/').replace(/\\u002F/gi, '/');
  try {
    const url = new URL(value, pageUrl);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

const collectReferences = (html, pageUrl) => {
  const refs = new Map();
  const add = (raw, origin, context = '') => {
    const url = normalizeReference(raw, pageUrl);
    if (!url) return;
    const key = url;
    const existing = refs.get(key);
    if (existing) {
      existing.origins = [...new Set([...existing.origins, origin])];
      return;
    }
    refs.set(key, {
      url,
      host: new URL(url).hostname.toLowerCase(),
      pathname: new URL(url).pathname,
      query: new URL(url).search || null,
      origins: [origin],
      context: clean(context).replace(/\s+/g, ' ').slice(0, 220) || null,
      imageExtension: /\.(?:jpe?g|png|webp)(?:$|\?)/i.test(url),
      looksPreviewRelated: /screenshot|preview|sample|gallery|photo|image|thumb|large|full|highres|hires|set|content/i.test(`${url} ${context}`),
    });
  };

  for (const tag of html.matchAll(/<(?:img|source|a|link)\b[^>]*>/gi)) {
    const rawTag = tag[0];
    const tagName = rawTag.match(/^<([a-z]+)/i)?.[1]?.toLowerCase() || 'tag';
    const context = `${rawTag.match(/\balt=["']([^"']*)["']/i)?.[1] || ''} ${rawTag.match(/\btitle=["']([^"']*)["']/i)?.[1] || ''}`;
    for (const attr of ['src', 'href', 'data-src', 'data-lazy-src', 'data-original', 'data-image', 'data-url', 'data-href']) {
      const match = rawTag.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i'));
      if (match?.[1]) add(match[1], `${tagName}_${attr}`, context);
    }
    for (const attr of ['srcset', 'data-srcset']) {
      const match = rawTag.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i'));
      if (!match?.[1]) continue;
      for (const part of match[1].split(',')) add(part.trim().split(/\s+/)[0], `${tagName}_${attr}`, context);
    }
  }

  for (const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(match[1], 'css_url');
  for (const match of html.matchAll(/["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)) add(match[1], 'quoted_image_string');
  for (const match of html.matchAll(/["']([^"']*(?:screenshots?|gallery|preview|samples?)[^"']*)["']/gi)) add(match[1], 'quoted_preview_string');

  return [...refs.values()];
};

const collectInlineScriptSnippets = (html) => {
  const snippets = [];
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = clean(match[1]);
    if (!body) continue;
    if (!/screenshot|preview|gallery|image|photo|jpe?g|png|webp|ajax|fancybox|lightbox/i.test(body)) continue;
    snippets.push(body.replace(/\s+/g, ' ').slice(0, 900));
    if (snippets.length >= 8) break;
  }
  return snippets;
};

const results = [];
for (const setId of SAMPLE_SET_IDS) {
  const requestedUrl = `https://adultlabs.com/content/screenshots/${setId}`;
  try {
    const { html, finalUrl } = await fetchHtml(requestedUrl);
    const refs = collectReferences(html, finalUrl);
    const imageRefs = refs.filter((ref) => ref.imageExtension);
    const previewRefs = refs.filter((ref) => ref.looksPreviewRelated);
    const originCounts = refs.reduce((acc, ref) => {
      for (const origin of ref.origins) acc[origin] = (acc[origin] || 0) + 1;
      return acc;
    }, {});
    const hostCounts = refs.reduce((acc, ref) => {
      acc[ref.host] = (acc[ref.host] || 0) + 1;
      return acc;
    }, {});
    results.push({
      setId,
      requestedUrl,
      finalUrl: finalUrl.toString(),
      htmlByteLength: Buffer.byteLength(html, 'utf8'),
      totalReferenceCount: refs.length,
      imageExtensionReferenceCount: imageRefs.length,
      previewRelatedReferenceCount: previewRefs.length,
      originCounts,
      hostCounts,
      sampleImageRefs: imageRefs.slice(0, 20),
      samplePreviewRefs: previewRefs.slice(0, 20),
      inlineScriptSnippets: collectInlineScriptSnippets(html),
      markupMarkers: {
        hasImg: /<img\b/i.test(html),
        hasIframe: /<iframe\b/i.test(html),
        hasFancybox: /fancybox/i.test(html),
        hasLightbox: /lightbox/i.test(html),
        hasAjax: /ajax/i.test(html),
        hasScreenshotText: /screenshot/i.test(html),
        hasJpegText: /\.jpe?g/i.test(html),
        hasDataSrc: /data-src/i.test(html),
        hasBackgroundImage: /background-image/i.test(html),
      },
      error: null,
    });
  } catch (error) {
    results.push({ setId, requestedUrl, error: safeError(error) });
  }
}

await mkdir(ROOT, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_adultlabs_preview_reference_markup_diagnostic_only',
  sampleSetIds: SAMPLE_SET_IDS,
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  sourceIntentIsLabelAuthority: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  results,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  sampleCount: results.length,
  bySet: Object.fromEntries(results.map((result) => [result.setId, {
    finalUrl: result.finalUrl || null,
    htmlByteLength: result.htmlByteLength || 0,
    totalReferenceCount: result.totalReferenceCount || 0,
    imageExtensionReferenceCount: result.imageExtensionReferenceCount || 0,
    previewRelatedReferenceCount: result.previewRelatedReferenceCount || 0,
    originCounts: result.originCounts || {},
    hostCounts: result.hostCounts || {},
    sampleImageRefs: result.sampleImageRefs || [],
    samplePreviewRefs: result.samplePreviewRefs || [],
    inlineScriptSnippets: result.inlineScriptSnippets || [],
    markupMarkers: result.markupMarkers || {},
    error: result.error || null,
  }])),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
