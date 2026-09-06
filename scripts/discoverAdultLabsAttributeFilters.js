import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'adultlabs-attribute-filters.json');
const BASE_URL = 'https://adultlabs.com/content';
const USER_AGENT = 'ArtesModerationResearch/1.0';
const MAX_PAGES = 80;
const MAX_EXAMPLES_PER_ATTRIBUTE = 8;

const clean = (value) => String(value || '').trim();
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');
const stripTags = (value) => decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();

const TARGETS = {
  male_male: [/^BoyBoy$/i, /^Boys Hardcore$/i, /^Gay Sex$/i, /^Male Male$/i],
  male_female: [/^BoyGirl$/i, /^GirlBoy$/i, /^Straight Sex$/i],
  female_female: [/^GirlGirl$/i, /^Lesbo$/i, /^Lesbian$/i],
  solo_male: [/^Boys Solo$/i, /^Male Solo$/i],
  solo_female: [/^Girls Solo$/i, /^Female Solo$/i],
  group: [/^BoyGirlGirl$/i, /^GirlGirlBoy$/i, /^Threesome$/i, /^Group Sex$/i, /^Orgy$/i],
  hardcore: [/^Hardcore$/i],
};

const REQUIRED_FOR_STOP = ['male_male', 'male_female', 'solo_male'];

const assertAdultLabsUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !['adultlabs.com', 'www.adultlabs.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('adultlabs_attribute_url_not_allowed');
  }
  return url;
};

const fetchHtml = async (rawUrl) => {
  const requested = assertAdultLabsUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`adultlabs_attribute_http_${response.status}`);
  const finalUrl = assertAdultLabsUrl(response.url);
  return { html: await response.text(), finalUrl };
};

const extractPhotoProductIds = (html) => {
  const ids = new Set();
  for (const match of html.matchAll(/\/content\/set\/[^"'<>\s]*photo-set[^"'<>\s]*-(\d+)\/?/gi)) ids.add(match[1]);
  return [...ids];
};

const attributeIdFromHref = (rawHref, pageUrl) => {
  let url;
  try { url = new URL(decodeHtml(rawHref), pageUrl); } catch { return null; }
  if (!['adultlabs.com', 'www.adultlabs.com'].includes(url.hostname.toLowerCase())) return null;
  if (url.pathname !== '/content') return null;
  const ids = url.searchParams.getAll('n[]').map(clean).filter((value) => /^\d{1,5}$/.test(value));
  return ids.length === 1 ? ids[0] : null;
};

const collectProductAttributeAnchors = (html, pageUrl) => {
  const results = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) !== null) {
    const id = attributeIdFromHref(match[1], pageUrl);
    if (!id) continue;
    const label = stripTags(match[2]);
    if (!label || label.length > 80) continue;
    results.push({ id, label });
  }
  return results;
};

const collectPhotoProductCards = (html, pageUrl) => {
  const productPattern = /<a\b[^>]*href=["']([^"']*\/content\/set\/[^"']*photo-set[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const products = [];
  let match;
  while ((match = productPattern.exec(html)) !== null) {
    let productUrl;
    try { productUrl = new URL(decodeHtml(match[1]), pageUrl); } catch { continue; }
    if (!['adultlabs.com', 'www.adultlabs.com'].includes(productUrl.hostname.toLowerCase())) continue;
    const setId = productUrl.pathname.match(/-(\d+)\/?$/)?.[1];
    if (!setId) continue;
    products.push({ setId, productUrl: productUrl.toString(), title: stripTags(match[2]).slice(0, 240) || null });
  }
  return [...new Map(products.map((item) => [item.setId, item])).values()];
};

const targetsForLabel = (label) => Object.entries(TARGETS)
  .filter(([, patterns]) => patterns.some((pattern) => pattern.test(label)))
  .map(([target]) => target);

const attributeMap = new Map();
const facetIds = new Map(Object.keys(TARGETS).map((facet) => [facet, new Set()]));
const pageSummaries = [];
let scannedPages = 0;

for (let page = 1; page <= MAX_PAGES; page += 1) {
  const url = new URL(BASE_URL);
  url.searchParams.set('Product_page', String(page));
  const { html, finalUrl } = await fetchHtml(url);
  scannedPages += 1;
  const products = collectPhotoProductCards(html, finalUrl);
  const anchors = collectProductAttributeAnchors(html, finalUrl);

  for (const anchor of anchors) {
    const key = `${anchor.label.toLowerCase()}::${anchor.id}`;
    const record = attributeMap.get(key) || { label: anchor.label, id: anchor.id, occurrences: 0, pages: [], exampleProducts: [] };
    record.occurrences += 1;
    if (!record.pages.includes(page)) record.pages.push(page);
    for (const product of products.slice(0, 3)) {
      if (record.exampleProducts.length >= MAX_EXAMPLES_PER_ATTRIBUTE) break;
      if (!record.exampleProducts.some((item) => item.setId === product.setId)) record.exampleProducts.push(product);
    }
    attributeMap.set(key, record);
    for (const facet of targetsForLabel(anchor.label)) facetIds.get(facet)?.add(anchor.id);
  }

  pageSummaries.push({ page, productCount: products.length, attributeAnchorCount: anchors.length });

  const hasRequired = REQUIRED_FOR_STOP.every((facet) => (facetIds.get(facet)?.size || 0) > 0);
  if (page % 10 === 0 || hasRequired) {
    process.stdout.write(`AdultLabs attribute scan: ${page} pages; ${Object.fromEntries(REQUIRED_FOR_STOP.map((facet) => [facet, facetIds.get(facet)?.size || 0]))}\n`);
  }
  if (hasRequired) break;
}

const baseline = await fetchHtml(BASE_URL);
const baselineProductIds = extractPhotoProductIds(baseline.html);

const validateFacetCandidate = async (facet, id) => {
  const url = new URL(BASE_URL);
  url.searchParams.append('n[]', id);
  const { html, finalUrl } = await fetchHtml(url);
  const productIds = extractPhotoProductIds(html);
  const labels = collectProductAttributeAnchors(html, finalUrl).map((item) => item.label);
  const targetEvidence = labels.filter((label) => targetsForLabel(label).includes(facet));
  const sameProductSet = productIds.length === baselineProductIds.length
    && productIds.every((value, index) => value === baselineProductIds[index]);
  return {
    id,
    url: finalUrl.toString(),
    productCount: productIds.length,
    productIds,
    changedFromBaseline: !sameProductSet,
    targetAttributeEvidence: [...new Set(targetEvidence)],
    validated: productIds.length > 0 && !sameProductSet && targetEvidence.length > 0,
  };
};

const validatedByFacet = {};
for (const [facet, ids] of facetIds.entries()) {
  validatedByFacet[facet] = [];
  for (const id of ids) {
    try {
      validatedByFacet[facet].push(await validateFacetCandidate(facet, id));
    } catch (error) {
      validatedByFacet[facet].push({ id, validated: false, error: clean(error?.message || error).slice(0, 180) });
    }
  }
}

const shortages = Object.fromEntries(REQUIRED_FOR_STOP.map((facet) => [facet, validatedByFacet[facet]?.some((item) => item.validated) ? 0 : 1]));

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_adultlabs_product_attribute_filter_discovery_only',
  maxPages: MAX_PAGES,
  scannedPages,
  baselineProductIds,
  attributeCount: attributeMap.size,
  attributes: [...attributeMap.values()].sort((a, b) => b.occurrences - a.occurrences),
  facetCandidateIds: Object.fromEntries([...facetIds.entries()].map(([facet, ids]) => [facet, [...ids]])),
  validatedByFacet,
  shortages,
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  sourceIntentIsLabelAuthority: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  pageSummaries,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  scannedPages,
  attributeCount: attributeMap.size,
  facetCandidateIds: Object.fromEntries([...facetIds.entries()].map(([facet, ids]) => [facet, [...ids]])),
  validatedByFacet: Object.fromEntries(Object.entries(validatedByFacet).map(([facet, items]) => [facet, items.filter((item) => item.validated).map((item) => ({ id: item.id, productCount: item.productCount, url: item.url, targetAttributeEvidence: item.targetAttributeEvidence }))])),
  shortages,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
