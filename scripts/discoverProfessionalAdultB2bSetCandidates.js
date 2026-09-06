import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const INPUT_PATH = path.join(ROOT, 'catalog-probe.json');
const OUTPUT_PATH = path.join(ROOT, 'set-candidates.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const MAX_ADULTLABS_SETS = 80;
const MAX_PHOTORAMA_PRODUCTS = 50;
const MAX_PREVIEW_REFS_PER_SET = 8;

const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 220);
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');

const input = JSON.parse(await readFile(INPUT_PATH, 'utf8'));
if (
  input?.status !== 'research_professional_adult_b2b_public_catalog_probe_only'
  || input?.imageBytesDownloaded !== false
  || input?.authenticationUsed !== false
  || input?.purchasePerformed !== false
  || input?.sourceIntentIsLabelAuthority !== false
  || input?.youthCodedMarketingIsNotAgeProof !== true
  || input?.researchOnly !== true
  || input?.trainingReady !== false
  || input?.productionEligible !== false
) throw new Error('b2b_catalog_probe_not_ready_for_set_discovery');

const sourceById = new Map((input.sources || []).map((source) => [source.sourceId, source]));
const adultLabs = sourceById.get('adultlabs_public_catalog');
const photorama = sourceById.get('photorama_public_catalog');
if (!adultLabs || !photorama) throw new Error('required_b2b_sources_missing');

const allowedHosts = new Map([
  ['adultlabs_public_catalog', new Set(['adultlabs.com', 'www.adultlabs.com'])],
  ['photorama_public_catalog', new Set(['photorama.nl', 'www.photorama.nl', 'secure.photorama.nl'])],
]);

const assertAllowedUrl = (rawUrl, sourceId) => {
  const url = new URL(rawUrl);
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') throw new Error('b2b_set_url_not_https');
  if (!allowedHosts.get(sourceId)?.has(url.hostname.toLowerCase())) throw new Error('b2b_set_url_host_not_allowed');
  return url;
};

const fetchHtml = async (rawUrl, sourceId) => {
  const requested = assertAllowedUrl(rawUrl, sourceId);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`b2b_set_http_${response.status}`);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:' || !allowedHosts.get(sourceId)?.has(finalUrl.hostname.toLowerCase())) {
    throw new Error('b2b_set_redirect_not_allowed');
  }
  return { html: await response.text(), finalUrl };
};

const stripTags = (html) => decodeHtml(String(html || '')
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' '));

const YOUTH_CODED = /\bteen(?:s|age|ager)?\b|school\s*girl|barely\s*legal/i;
const EXPLICIT_ACT = /\bhardcore\b|\banal\b|\boral\b|penetrat|cum\s*shot|cumshot|masturbat|fisting|\btoys?\b|\bsex\b/i;

const inferSceneFacets = (text) => {
  const value = String(text || '');
  const facets = [];
  if (/boy\s*boy|male\s*male|gay\s+sex|boys?\s+hardcore/i.test(value)) facets.push('male_male');
  if (/girl\s*girl|lesbo|lesbian/i.test(value)) facets.push('female_female');
  if (/boy\s*girl|girl\s*boy|straight\s+sex/i.test(value)) facets.push('male_female');
  if (/boygirlgirl|girlgirlboy|threesome|three\s*some|group\s+sex|orgy/i.test(value)) facets.push('group');
  if (/boys?\s+solo|male\s+solo|girls?\s+solo|female\s+solo|masturbat|self[- ]?play/i.test(value)) facets.push('solo');
  if (EXPLICIT_ACT.test(value)) facets.push('explicit_act_discovery');
  return [...new Set(facets)];
};

const collectImageRefs = (html, pageUrl) => {
  const byUrl = new Map();
  const add = (raw, origin) => {
    const value = decodeHtml(clean(raw));
    if (!value || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('javascript:')) return;
    let url;
    try { url = new URL(value, pageUrl); } catch { return; }
    if (!['https:', 'http:'].includes(url.protocol)) return;
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (!/\.(?:jpe?g|png|webp)(?:$|\?)/i.test(url.pathname + url.search)) return;
    if (/logo|icon|sprite|banner|button|payment|flag/i.test(url.pathname)) return;
    const key = url.toString();
    if (!byUrl.has(key)) byUrl.set(key, { url: key, host: url.hostname.toLowerCase(), origins: [origin] });
    else byUrl.get(key).origins = Array.from(new Set([...byUrl.get(key).origins, origin]));
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
  return [...byUrl.values()];
};

const adultLabsProductPattern = /^https:\/\/(?:www\.)?adultlabs\.com\/content\/set\/(.+)-(\d+)\/?$/i;
const adultLabsScreensPattern = /^https:\/\/(?:www\.)?adultlabs\.com\/content\/screenshots\/(\d+)\/?$/i;
const screenshotById = new Map();
for (const link of adultLabs.screenshotOrPreviewLinks || []) {
  const match = clean(link.url).match(adultLabsScreensPattern);
  if (match) screenshotById.set(match[1], link.url);
}

const adultLabsProducts = [];
for (const link of adultLabs.strongProductLinks || []) {
  const url = clean(link.url);
  const match = url.match(adultLabsProductPattern);
  if (!match) continue;
  const slug = match[1];
  const setId = match[2];
  if (!/photo[- ]?set/i.test(slug.replaceAll('-', ' '))) continue;
  const screenshotUrl = screenshotById.get(setId);
  if (!screenshotUrl) continue;
  adultLabsProducts.push({ setId, slug, productUrl: url, screenshotUrl, anchorText: link.anchorText || null });
}

const dedupAdultLabs = [...new Map(adultLabsProducts.map((item) => [item.setId, item])).values()].slice(0, MAX_ADULTLABS_SETS);
const records = [];
const failures = [];

for (const item of dedupAdultLabs) {
  try {
    const [{ html: productHtml }, { html: screenshotHtml, finalUrl: screenshotFinal }] = await Promise.all([
      fetchHtml(item.productUrl, 'adultlabs_public_catalog'),
      fetchHtml(item.screenshotUrl, 'adultlabs_public_catalog'),
    ]);
    const productText = stripTags(productHtml);
    const evidence = `${item.slug.replaceAll('-', ' ')} ${item.anchorText || ''} ${productText}`;
    const previewRefs = collectImageRefs(screenshotHtml, screenshotFinal).slice(0, MAX_PREVIEW_REFS_PER_SET);
    records.push({
      sourceId: 'adultlabs_public_catalog',
      sourcePoolId: `adultlabs-set-${item.setId}`,
      setId: item.setId,
      productUrl: item.productUrl,
      previewPageUrl: screenshotFinal.toString(),
      discoveryFacets: inferSceneFacets(evidence),
      youthCodedMarketingContext: YOUTH_CODED.test(evidence),
      sourceAdultAgeContext: adultLabs.ageContext || null,
      rightsContext: adultLabs.rightsContext || null,
      previewReferences: previewRefs,
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      humanAgeSafetyReviewRequired: true,
      detectorLabel: null,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    });
  } catch (error) {
    failures.push({ sourceId: 'adultlabs_public_catalog', setId: item.setId, productUrl: item.productUrl, error: safeError(error) });
  }
}

const photoramaProducts = [...new Map((photorama.strongProductLinks || []).map((item) => [item.url, item])).values()]
  .filter((item) => /^https:\/\/(?:www\.|secure\.)?photorama\.nl\//i.test(clean(item.url)))
  .slice(0, MAX_PHOTORAMA_PRODUCTS);

for (let index = 0; index < photoramaProducts.length; index += 1) {
  const item = photoramaProducts[index];
  try {
    const { html, finalUrl } = await fetchHtml(item.url, 'photorama_public_catalog');
    const text = stripTags(html);
    const previewRefs = collectImageRefs(html, finalUrl).slice(0, MAX_PREVIEW_REFS_PER_SET);
    if (previewRefs.length === 0) continue;
    records.push({
      sourceId: 'photorama_public_catalog',
      sourcePoolId: `photorama-product-${String(index + 1).padStart(3, '0')}`,
      setId: null,
      productUrl: finalUrl.toString(),
      previewPageUrl: finalUrl.toString(),
      discoveryFacets: inferSceneFacets(`${item.anchorText || ''} ${text}`),
      youthCodedMarketingContext: YOUTH_CODED.test(text),
      sourceAdultAgeContext: photorama.ageContext || null,
      rightsContext: photorama.rightsContext || null,
      previewReferences: previewRefs,
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      humanAgeSafetyReviewRequired: true,
      detectorLabel: null,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    });
  } catch (error) {
    failures.push({ sourceId: 'photorama_public_catalog', productUrl: item.url, error: safeError(error) });
  }
}

const facetCounts = records.reduce((acc, record) => {
  for (const facet of record.discoveryFacets || []) acc[facet] = (acc[facet] || 0) + 1;
  return acc;
}, {});
const sourcePoolCount = new Set(records.map((record) => record.sourcePoolId)).size;
const previewReferenceCount = records.reduce((sum, record) => sum + (record.previewReferences?.length || 0), 0);
const youthCodedPoolCount = records.filter((record) => record.youthCodedMarketingContext).length;
const preferredFacetFloor = { male_male: 6, male_female: 10, female_female: 8, group: 6, solo: 6 };
const facetShortages = Object.fromEntries(Object.entries(preferredFacetFloor).map(([facet, floor]) => [facet, Math.max(0, floor - (facetCounts[facet] || 0))]));

await mkdir(ROOT, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_professional_adult_b2b_set_candidates_only',
  generatedFrom: path.relative(REPO_ROOT, INPUT_PATH),
  setCount: records.length,
  sourcePoolCount,
  previewReferenceCount,
  facetCounts,
  facetShortages,
  youthCodedPoolCount,
  youthCodedMarketingIsNotAgeProof: true,
  imageBytesDownloaded: false,
  sourceIntentIsLabelAuthority: false,
  humanVisualScreeningRequired: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  records,
  failures,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  setCount: records.length,
  sourcePoolCount,
  previewReferenceCount,
  facetCounts,
  facetShortages,
  youthCodedPoolCount,
  failedSetCount: failures.length,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
