import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const CATALOG_PATH = path.join(ROOT, 'catalog-probe.json');
const ADULTLABS_PATH = path.join(ROOT, 'adultlabs-target-scene-source-pools.json');
const OUTPUT_PATH = path.join(ROOT, 'photorama-male-female-source-pools.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const ALLOWED_HOSTS = new Set(['photorama.nl', 'www.photorama.nl', 'secure.photorama.nl']);
const TARGET_TOTAL_MALE_FEMALE_POOLS = 10;
const MAX_PRODUCT_PROBES = 72;

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

const assertPublicPhotoramaUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('photorama_male_female_url_not_allowed');
  }
  return url;
};

const fetchHtml = async (rawUrl) => {
  const requested = assertPublicPhotoramaUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`photorama_male_female_http_${response.status}`);
  const finalUrl = assertPublicPhotoramaUrl(response.url);
  return { html: await response.text(), finalUrl };
};

const MALE_FEMALE = /\b(?:boy\s*girl|girl\s*boy|male\s*female|man\s+(?:and|with)\s+woman|woman\s+(?:and|with)\s+man|straight\s+sex|hetero(?:sexual)?)\b/i;
const EXPLICIT_ACT = /\b(?:hardcore|anal|oral|blow\s*job|blowjob|hand\s*job|handjob|penetrat(?:e|es|ed|ing|ion)|intercourse|cum\s*shot|cumshot|fisting|masturbat(?:e|es|ed|ing|ion)|sex)\b/i;
const YOUTH_CODED = /\bteen(?:s|age|ager)?\b|school\s*girl|barely\s*legal/i;

const extractTitle = (html) => stripTags(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 300) || null;
const extractMetaDescription = (html) => decodeHtml(html.match(/<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=["']([^"']*)["'][^>]*>/i)?.[1]
  || html.match(/<meta\b[^>]*\bcontent=["']([^"']*)["'][^>]*\bname=["']description["'][^>]*>/i)?.[1]
  || '').slice(0, 500) || null;

const collectProducerHints = (text) => {
  const hints = new Set();
  const patterns = [
    /(?:photographer|producer|studio|production)\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9 ._&'’-]{1,80})/gi,
    /(?:by|from)\s+([A-Za-z0-9][A-Za-z0-9 ._&'’-]{2,60})\s+(?:studio|productions?)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const hint = normalizeWhitespace(match[1]).replace(/[|•].*$/, '').trim();
      if (hint.length >= 2 && hint.length <= 80) hints.add(hint);
      if (hints.size >= 6) break;
    }
  }
  return [...hints];
};

const stablePoolId = (rawUrl) => {
  const url = assertPublicPhotoramaUrl(rawUrl);
  url.hash = '';
  const digest = createHash('sha256').update(url.toString()).digest('hex').slice(0, 16);
  return `photorama-product-${digest}`;
};

const catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
if (
  catalog?.status !== 'research_professional_adult_b2b_public_catalog_probe_only'
  || catalog?.imageBytesDownloaded !== false
  || catalog?.authenticationUsed !== false
  || catalog?.purchasePerformed !== false
  || catalog?.sourceIntentIsLabelAuthority !== false
  || catalog?.researchOnly !== true
  || catalog?.trainingReady !== false
  || catalog?.productionEligible !== false
) throw new Error('photorama_catalog_probe_not_research_safe');

const adultLabs = JSON.parse(await readFile(ADULTLABS_PATH, 'utf8'));
if (
  adultLabs?.status !== 'research_adultlabs_target_scene_source_pool_discovery_only'
  || adultLabs?.imageBytesDownloaded !== false
  || adultLabs?.authenticationUsed !== false
  || adultLabs?.purchasePerformed !== false
  || adultLabs?.sourceIntentIsLabelAuthority !== false
  || adultLabs?.researchOnly !== true
  || adultLabs?.trainingReady !== false
  || adultLabs?.productionEligible !== false
) throw new Error('adultlabs_target_scene_input_not_research_safe');

const existingAdultLabsMaleFemale = (adultLabs.acceptedRecords || [])
  .filter((record) => record.targetFacet === 'male_female' && record.targetFacetSupportedByMetadata === true);
const neededFromPhotorama = Math.max(0, TARGET_TOTAL_MALE_FEMALE_POOLS - existingAdultLabsMaleFemale.length);

const photorama = (catalog.sources || []).find((source) => source.sourceId === 'photorama_public_catalog');
if (!photorama) throw new Error('photorama_public_catalog_missing');

const productLinks = [...new Map((photorama.strongProductLinks || [])
  .map((item) => {
    try {
      const url = assertPublicPhotoramaUrl(item.url);
      url.hash = '';
      return [url.toString(), { url: url.toString(), anchorText: item.anchorText || null }];
    } catch {
      return null;
    }
  })
  .filter(Boolean)).values()]
  .slice(0, MAX_PRODUCT_PROBES);

const accepted = [];
const rejected = [];
let probedProductCount = 0;

for (const product of productLinks) {
  if (accepted.length >= neededFromPhotorama) break;
  probedProductCount += 1;
  try {
    const { html, finalUrl } = await fetchHtml(product.url);
    const title = extractTitle(html);
    const description = extractMetaDescription(html);
    const bodyText = stripTags(html);
    const evidenceText = normalizeWhitespace(`${product.anchorText || ''} ${title || ''} ${description || ''} ${bodyText}`);
    const maleFemaleSupportedByMetadata = MALE_FEMALE.test(evidenceText);
    const explicitActSupportedByMetadata = EXPLICIT_ACT.test(evidenceText);
    const record = {
      sourceId: 'photorama_public_catalog',
      sourcePoolId: stablePoolId(finalUrl),
      productUrl: finalUrl.toString(),
      anchorText: product.anchorText,
      title,
      metaDescription: description,
      targetFacet: 'male_female',
      discoveryFacets: [
        ...(maleFemaleSupportedByMetadata ? ['male_female'] : []),
        ...(explicitActSupportedByMetadata ? ['explicit_act_discovery'] : []),
      ],
      maleFemaleSupportedByMetadata,
      explicitActSupportedByMetadata,
      acceptedForMaleFemaleDiscovery: maleFemaleSupportedByMetadata && explicitActSupportedByMetadata,
      producerHints: collectProducerHints(evidenceText),
      youthCodedMarketingContext: YOUTH_CODED.test(evidenceText),
      youthCodedMarketingIsNotAgeProof: true,
      metadataTextPreview: bodyText.slice(0, 900),
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      humanAgeSafetyReviewRequired: true,
      detectorLabel: null,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    };
    if (record.acceptedForMaleFemaleDiscovery) accepted.push(record);
    else rejected.push(record);
  } catch (error) {
    rejected.push({
      sourceId: 'photorama_public_catalog',
      sourcePoolId: stablePoolId(product.url),
      productUrl: product.url,
      targetFacet: 'male_female',
      maleFemaleSupportedByMetadata: false,
      explicitActSupportedByMetadata: false,
      acceptedForMaleFemaleDiscovery: false,
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      detectorLabel: null,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
      error: safeError(error),
    });
  }
}

const combinedMaleFemaleCount = existingAdultLabsMaleFemale.length + accepted.length;
const remainingShortage = Math.max(0, TARGET_TOTAL_MALE_FEMALE_POOLS - combinedMaleFemaleCount);
const youthCodedPoolCount = accepted.filter((record) => record.youthCodedMarketingContext).length;
const producerHintCount = new Set(accepted.flatMap((record) => record.producerHints || []).map((value) => value.toLowerCase())).size;

await mkdir(ROOT, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_photorama_male_female_source_pool_discovery_only',
  targetTotalMaleFemalePools: TARGET_TOTAL_MALE_FEMALE_POOLS,
  existingAdultLabsMaleFemaleCount: existingAdultLabsMaleFemale.length,
  neededFromPhotorama,
  availablePublicProductLinks: productLinks.length,
  probedProductCount,
  acceptedPhotoramaPoolCount: accepted.length,
  combinedMaleFemaleCount,
  remainingShortage,
  producerHintCount,
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
  acceptedRecords: accepted,
  rejectedRecords: rejected,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  existingAdultLabsMaleFemaleCount: existingAdultLabsMaleFemale.length,
  neededFromPhotorama,
  availablePublicProductLinks: productLinks.length,
  probedProductCount,
  acceptedPhotoramaPoolCount: accepted.length,
  combinedMaleFemaleCount,
  remainingShortage,
  producerHintCount,
  youthCodedPoolCount,
  sampleAccepted: accepted.slice(0, 10).map((record) => ({
    sourcePoolId: record.sourcePoolId,
    productUrl: record.productUrl,
    title: record.title,
    producerHints: record.producerHints,
  })),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
