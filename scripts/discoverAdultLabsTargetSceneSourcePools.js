import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'adultlabs-target-scene-source-pools.json');
const BASE_URL = 'https://adultlabs.com/content';
const USER_AGENT = 'ArtesModerationResearch/1.0';
const ALLOWED_HOSTS = new Set(['adultlabs.com', 'www.adultlabs.com']);
const TOP_SCENE_PARAMS = ['t_h', 't_g', 't_l', 't_b', 't_bh'];
const MAX_PAGES_PER_ROUTE = 20;
const MAX_DETAIL_PROBES = 80;

const TARGETS = [
  { routeLabel: 'Boys Hardcore', parameter: 't_bh', targetFacet: 'male_male', targetPoolCount: 10 },
  { routeLabel: 'Boys Solo', parameter: 't_b', targetFacet: 'solo_male', targetPoolCount: 6 },
  { routeLabel: 'Hardcore', parameter: 't_h', targetFacet: 'male_female', targetPoolCount: 10 },
];

const clean = (value) => String(value || '').trim();
const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');
const stripTags = (value) => normalizeWhitespace(decodeHtml(String(value || '')
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')));
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 220);

const assertPublicAdultLabsUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('adultlabs_target_scene_url_not_allowed');
  }
  return url;
};

const fetchHtml = async (rawUrl) => {
  const requested = assertPublicAdultLabsUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`adultlabs_target_scene_http_${response.status}`);
  const finalUrl = assertPublicAdultLabsUrl(response.url);
  return { html: await response.text(), finalUrl };
};

const scenePageUrl = (activeParameter, page) => {
  const url = new URL(BASE_URL);
  for (const parameter of TOP_SCENE_PARAMS) url.searchParams.set(parameter, parameter === activeParameter ? '1' : '');
  if (page > 1) url.searchParams.set('Product_page', String(page));
  return url;
};

const collectPhotoProducts = (html, pageUrl) => {
  const products = new Map();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) !== null) {
    let url;
    try { url = new URL(decodeHtml(match[1]), pageUrl); } catch { continue; }
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) continue;
    const pathMatch = url.pathname.match(/^\/content\/set\/(.+)-(\d+)\/?$/i);
    if (!pathMatch) continue;
    const slug = pathMatch[1];
    const setId = pathMatch[2];
    if (!/photo[- ]?set/i.test(slug.replaceAll('-', ' '))) continue;
    if (!products.has(setId)) {
      products.set(setId, {
        setId,
        slug,
        productUrl: url.toString(),
        anchorText: stripTags(match[2]).slice(0, 300) || null,
      });
    }
  }
  return [...products.values()];
};

const inferDiscoveryFacets = (text) => {
  const value = String(text || '');
  const facets = [];
  if (/boy\s*boy|boys?\s+hardcore|male\s*male|gay\s+sex|\bgay\b/i.test(value)) facets.push('male_male');
  if (/boy\s*girl|girl\s*boy|straight\s+sex|hetero|man\s+(?:and|with)\s+woman|male\s+female/i.test(value)) facets.push('male_female');
  if (/girl\s*girl|lesbo|lesbian/i.test(value)) facets.push('female_female');
  if (/boys?\s+solo|male\s+solo|solo\s+male|male\s+masturbat|man\s+masturbat/i.test(value)) facets.push('solo_male');
  if (/girls?\s+solo|female\s+solo|solo\s+female|female\s+masturbat|woman\s+masturbat/i.test(value)) facets.push('solo_female');
  if (/masturbat|self[- ]?play/i.test(value) && !facets.some((facet) => facet.startsWith('solo_'))) facets.push('solo_unspecified');
  if (/hardcore|anal|oral|penetrat|masturbat|fisting|\btoys?\b|\bsex\b/i.test(value)) facets.push('explicit_act_discovery');
  return [...new Set(facets)];
};

const YOUTH_CODED = /\bteen(?:s|age|ager)?\b|school\s*girl|barely\s*legal/i;

const detailProbe = async (product, routeLabel, targetFacet, page) => {
  try {
    const { html, finalUrl } = await fetchHtml(product.productUrl);
    const text = stripTags(html);
    const evidenceText = `${product.slug.replaceAll('-', ' ')} ${product.anchorText || ''} ${text}`;
    const discoveryFacets = inferDiscoveryFacets(evidenceText);
    return {
      sourceId: 'adultlabs_public_catalog',
      sourcePoolId: `adultlabs-set-${product.setId}`,
      setId: product.setId,
      productUrl: finalUrl.toString(),
      discoveredVia: routeLabel,
      discoveredOnPage: page,
      targetFacet,
      discoveryFacets,
      targetFacetSupportedByMetadata: discoveryFacets.includes(targetFacet),
      youthCodedMarketingContext: YOUTH_CODED.test(evidenceText),
      youthCodedMarketingIsNotAgeProof: true,
      metadataTextPreview: text.slice(0, 700),
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      humanAgeSafetyReviewRequired: true,
      detectorLabel: null,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    };
  } catch (error) {
    return {
      sourceId: 'adultlabs_public_catalog',
      sourcePoolId: `adultlabs-set-${product.setId}`,
      setId: product.setId,
      productUrl: product.productUrl,
      discoveredVia: routeLabel,
      discoveredOnPage: page,
      targetFacet,
      discoveryFacets: [],
      targetFacetSupportedByMetadata: false,
      youthCodedMarketingContext: false,
      youthCodedMarketingIsNotAgeProof: true,
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      humanAgeSafetyReviewRequired: true,
      detectorLabel: null,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
      error: safeError(error),
    };
  }
};

const routeResults = [];
let totalDetailProbes = 0;

for (const target of TARGETS) {
  const seenSetIds = new Set();
  const candidates = [];
  const rejected = [];
  const pageSummaries = [];
  let consecutiveEmptyPages = 0;

  for (let page = 1; page <= MAX_PAGES_PER_ROUTE; page += 1) {
    if (candidates.length >= target.targetPoolCount || totalDetailProbes >= MAX_DETAIL_PROBES) break;
    const requestedUrl = scenePageUrl(target.parameter, page);
    try {
      const { html, finalUrl } = await fetchHtml(requestedUrl);
      const products = collectPhotoProducts(html, finalUrl);
      const newProducts = products.filter((product) => !seenSetIds.has(product.setId));
      for (const product of newProducts) seenSetIds.add(product.setId);
      pageSummaries.push({
        page,
        requestedUrl: requestedUrl.toString(),
        finalUrl: finalUrl.toString(),
        productCount: products.length,
        newProductCount: newProducts.length,
      });

      if (newProducts.length === 0) consecutiveEmptyPages += 1;
      else consecutiveEmptyPages = 0;
      if (consecutiveEmptyPages >= 2) break;

      for (const product of newProducts) {
        if (candidates.length >= target.targetPoolCount || totalDetailProbes >= MAX_DETAIL_PROBES) break;
        totalDetailProbes += 1;
        const probe = await detailProbe(product, target.routeLabel, target.targetFacet, page);
        if (probe.targetFacetSupportedByMetadata) candidates.push(probe);
        else rejected.push(probe);
      }
    } catch (error) {
      pageSummaries.push({ page, requestedUrl: requestedUrl.toString(), productCount: 0, newProductCount: 0, error: safeError(error) });
      consecutiveEmptyPages += 1;
      if (consecutiveEmptyPages >= 2) break;
    }
  }

  routeResults.push({
    routeLabel: target.routeLabel,
    parameter: target.parameter,
    targetFacet: target.targetFacet,
    targetPoolCount: target.targetPoolCount,
    discoveredUniqueSetCount: seenSetIds.size,
    candidatePoolCount: candidates.length,
    shortage: Math.max(0, target.targetPoolCount - candidates.length),
    candidates,
    rejected,
    pageSummaries,
  });
}

const acceptedRecords = routeResults.flatMap((route) => route.candidates);
const uniqueAccepted = [...new Map(acceptedRecords.map((record) => [record.sourcePoolId, record])).values()];
const targetCounts = Object.fromEntries(TARGETS.map((target) => {
  const count = uniqueAccepted.filter((record) => record.targetFacet === target.targetFacet).length;
  return [target.targetFacet, count];
}));
const shortages = Object.fromEntries(TARGETS.map((target) => [target.targetFacet, Math.max(0, target.targetPoolCount - (targetCounts[target.targetFacet] || 0))]));
const youthCodedPoolCount = uniqueAccepted.filter((record) => record.youthCodedMarketingContext).length;

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_adultlabs_target_scene_source_pool_discovery_only',
  routeDerivation: {
    activeEncoding: '<control-id>=1',
    inactiveEncoding: '<control-id>=',
    topSceneParameters: TOP_SCENE_PARAMS,
    boysHardcoreParameter: 't_bh',
    boysSoloParameter: 't_b',
    hardcoreParameter: 't_h',
  },
  targets: TARGETS,
  maxPagesPerRoute: MAX_PAGES_PER_ROUTE,
  maxDetailProbes: MAX_DETAIL_PROBES,
  totalDetailProbes,
  acceptedSourcePoolCount: uniqueAccepted.length,
  targetCounts,
  shortages,
  youthCodedPoolCount,
  youthCodedMarketingIsNotAgeProof: true,
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  sourceIntentIsLabelAuthority: false,
  humanVisualScreeningRequired: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  routeResults,
  acceptedRecords: uniqueAccepted,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  totalDetailProbes,
  acceptedSourcePoolCount: uniqueAccepted.length,
  targetCounts,
  shortages,
  youthCodedPoolCount,
  byRoute: Object.fromEntries(routeResults.map((route) => [route.routeLabel, {
    parameter: route.parameter,
    targetFacet: route.targetFacet,
    discoveredUniqueSetCount: route.discoveredUniqueSetCount,
    candidatePoolCount: route.candidatePoolCount,
    shortage: route.shortage,
    sampleSetIds: route.candidates.slice(0, 12).map((record) => record.setId),
  }])),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
