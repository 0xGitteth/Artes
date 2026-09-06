import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'adultlabs-top-scene-facet-query-validation.json');
const BASE_URL = 'https://adultlabs.com/content';
const USER_AGENT = 'ArtesModerationResearch/1.0';
const ALLOWED_HOSTS = new Set(['adultlabs.com', 'www.adultlabs.com']);
const MAX_DETAIL_PROBES_PER_FACET = 6;

const TOP_SCENE_PARAMS = ['t_h', 't_g', 't_l', 't_b', 't_bh'];
const FACETS = [
  { label: 'Hardcore', parameter: 't_h', expectedDiscoveryFacet: 'male_female' },
  { label: 'Girls Solo', parameter: 't_g', expectedDiscoveryFacet: 'solo_female' },
  { label: 'Lesbo', parameter: 't_l', expectedDiscoveryFacet: 'female_female' },
  { label: 'Boys Solo', parameter: 't_b', expectedDiscoveryFacet: 'solo_male' },
  { label: 'Boys Hardcore', parameter: 't_bh', expectedDiscoveryFacet: 'male_male' },
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
    throw new Error('adultlabs_scene_query_url_not_allowed');
  }
  return url;
};

const fetchHtml = async (rawUrl) => {
  const requested = assertPublicAdultLabsUrl(rawUrl);
  const response = await fetch(requested, {
    headers: {
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      'User-Agent': USER_AGENT,
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`adultlabs_scene_query_http_${response.status}`);
  const finalUrl = assertPublicAdultLabsUrl(response.url);
  return { html: await response.text(), finalUrl };
};

const sceneUrl = (activeParameter) => {
  const url = new URL(BASE_URL);
  for (const parameter of TOP_SCENE_PARAMS) url.searchParams.set(parameter, parameter === activeParameter ? '1' : '');
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
    const anchorText = stripTags(match[2]).slice(0, 240) || null;
    if (!products.has(setId)) {
      products.set(setId, {
        setId,
        slug,
        productUrl: url.toString(),
        anchorText,
      });
    }
  }
  return [...products.values()];
};

const inferDiscoveryFacets = (text) => {
  const value = String(text || '');
  const facets = [];
  if (/boy\s*boy|boys?\s+hardcore|male\s*male|gay\s+sex|\bgay\b/i.test(value)) facets.push('male_male');
  if (/boy\s*girl|girl\s*boy|straight\s+sex|hetero/i.test(value)) facets.push('male_female');
  if (/girl\s*girl|lesbo|lesbian/i.test(value)) facets.push('female_female');
  if (/boys?\s+solo|male\s+solo|solo\s+male|male\s+masturbat/i.test(value)) facets.push('solo_male');
  if (/girls?\s+solo|female\s+solo|solo\s+female|female\s+masturbat/i.test(value)) facets.push('solo_female');
  if (/masturbat|self[- ]?play/i.test(value) && !facets.includes('solo_male') && !facets.includes('solo_female')) facets.push('solo_unspecified');
  return [...new Set(facets)];
};

const YOUTH_CODED = /\bteen(?:s|age|ager)?\b|school\s*girl|barely\s*legal/i;

const detailProbe = async (product) => {
  try {
    const { html, finalUrl } = await fetchHtml(product.productUrl);
    const text = stripTags(html);
    const evidenceText = `${product.slug.replaceAll('-', ' ')} ${product.anchorText || ''} ${text}`;
    return {
      setId: product.setId,
      productUrl: finalUrl.toString(),
      discoveryFacets: inferDiscoveryFacets(evidenceText),
      youthCodedMarketingContext: YOUTH_CODED.test(evidenceText),
      metadataTextPreview: text.slice(0, 500),
      sourceIntentIsLabelAuthority: false,
      detectorLabel: null,
    };
  } catch (error) {
    return {
      setId: product.setId,
      productUrl: product.productUrl,
      discoveryFacets: [],
      youthCodedMarketingContext: false,
      sourceIntentIsLabelAuthority: false,
      detectorLabel: null,
      error: safeError(error),
    };
  }
};

const jaccard = (leftValues, rightValues) => {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
};

const baselineResponse = await fetchHtml(BASE_URL);
const baselineProducts = collectPhotoProducts(baselineResponse.html, baselineResponse.finalUrl);
const baselineIds = baselineProducts.map((item) => item.setId);

const results = [];
for (const facet of FACETS) {
  const requestedUrl = sceneUrl(facet.parameter);
  try {
    const { html, finalUrl } = await fetchHtml(requestedUrl);
    const products = collectPhotoProducts(html, finalUrl);
    const productIds = products.map((item) => item.setId);
    const overlapWithBaseline = Number(jaccard(baselineIds, productIds).toFixed(4));
    const detailProbes = [];
    for (const product of products.slice(0, MAX_DETAIL_PROBES_PER_FACET)) {
      detailProbes.push(await detailProbe(product));
    }
    const expectedEvidenceCount = detailProbes.filter((probe) => probe.discoveryFacets.includes(facet.expectedDiscoveryFacet)).length;
    const activeParameterKept = finalUrl.searchParams.get(facet.parameter) === '1';
    const inactiveParametersKeptEmpty = TOP_SCENE_PARAMS
      .filter((parameter) => parameter !== facet.parameter)
      .every((parameter) => finalUrl.searchParams.has(parameter) && finalUrl.searchParams.get(parameter) === '');
    const changedFromBaseline = productIds.length > 0 && overlapWithBaseline < 0.95;

    results.push({
      label: facet.label,
      parameter: facet.parameter,
      expectedDiscoveryFacet: facet.expectedDiscoveryFacet,
      requestedUrl: requestedUrl.toString(),
      finalUrl: finalUrl.toString(),
      activeParameterKept,
      inactiveParametersKeptEmpty,
      productCount: products.length,
      productIds,
      overlapWithBaseline,
      changedFromBaseline,
      expectedEvidenceCount,
      metadataValidated: activeParameterKept && productIds.length > 0 && changedFromBaseline && expectedEvidenceCount > 0,
      products,
      detailProbes,
    });
  } catch (error) {
    results.push({
      label: facet.label,
      parameter: facet.parameter,
      expectedDiscoveryFacet: facet.expectedDiscoveryFacet,
      requestedUrl: requestedUrl.toString(),
      productCount: 0,
      productIds: [],
      overlapWithBaseline: 1,
      changedFromBaseline: false,
      expectedEvidenceCount: 0,
      metadataValidated: false,
      error: safeError(error),
    });
  }
}

const byLabel = Object.fromEntries(results.map((item) => [item.label, item]));
const boysSolo = byLabel['Boys Solo'];
const boysHardcore = byLabel['Boys Hardcore'];
const hardcore = byLabel.Hardcore;
const targetPairOverlap = Number(jaccard(boysSolo?.productIds || [], boysHardcore?.productIds || []).toFixed(4));

const routeValidation = {
  boysSoloValidated: boysSolo?.metadataValidated === true,
  boysHardcoreValidated: boysHardcore?.metadataValidated === true,
  hardcoreStraightControlValidated: hardcore?.metadataValidated === true,
  boysSoloAndHardcoreDiffer: (boysSolo?.productIds?.length || 0) > 0
    && (boysHardcore?.productIds?.length || 0) > 0
    && targetPairOverlap < 0.95,
  targetPairOverlap,
};

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_adultlabs_public_top_scene_facet_query_validation_only',
  routeDerivation: {
    sharedControlClass: 'self',
    activeEncoding: '<control-id>=1',
    inactiveEncoding: '<control-id>=',
    controlParameters: TOP_SCENE_PARAMS,
    yiiListViewId: 'ajaxListView',
    browserHistoryMirrorsQuery: true,
  },
  baselineUrl: baselineResponse.finalUrl.toString(),
  baselineProductCount: baselineProducts.length,
  baselineProductIds: baselineIds,
  routeValidation,
  facets: results,
  youthCodedMarketingIsNotAgeProof: true,
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  sourceIntentIsLabelAuthority: false,
  humanVisualScreeningRequired: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  baselineProductCount: baselineProducts.length,
  routeValidation,
  byFacet: Object.fromEntries(results.map((item) => [item.label, {
    parameter: item.parameter,
    expectedDiscoveryFacet: item.expectedDiscoveryFacet,
    productCount: item.productCount,
    overlapWithBaseline: item.overlapWithBaseline,
    changedFromBaseline: item.changedFromBaseline,
    expectedEvidenceCount: item.expectedEvidenceCount,
    metadataValidated: item.metadataValidated,
    sampleProductIds: (item.productIds || []).slice(0, 8),
    error: item.error || null,
  }])),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
