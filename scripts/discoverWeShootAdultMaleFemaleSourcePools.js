import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const CATALOG_PATH = path.join(ROOT, 'catalog-probe.json');
const ADULTLABS_PATH = path.join(ROOT, 'adultlabs-target-scene-source-pools.json');
const PHOTORAMA_PATH = path.join(ROOT, 'photorama-male-female-source-pools.json');
const OUTPUT_PATH = path.join(ROOT, 'weshootadult-male-female-source-pools.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const ALLOWED_HOSTS = new Set(['weshootadult.com', 'www.weshootadult.com']);
const TARGET_TOTAL_MALE_FEMALE_POOLS = 10;
const MAX_PRODUCT_PROBES = 120;

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

const assertPublicWeShootAdultUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('weshootadult_male_female_url_not_allowed');
  }
  return url;
};

const fetchHtml = async (rawUrl) => {
  const requested = assertPublicWeShootAdultUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`weshootadult_male_female_http_${response.status}`);
  const finalUrl = assertPublicWeShootAdultUrl(response.url);
  return { html: await response.text(), finalUrl };
};

const MALE_FEMALE = /\b(?:boy\s*girl|girl\s*boy|male\s*female|man\s+(?:and|with)\s+woman|woman\s+(?:and|with)\s+man|straight\s+sex|straight\s+(?:hardcore|couple|scene)|hetero(?:sexual)?|m\s*\/\s*f)\b/i;
const EXPLICIT_ACT = /\b(?:hardcore|anal|oral|blow\s*job|blowjob|hand\s*job|handjob|penetrat(?:e|es|ed|ing|ion)|intercourse|cum\s*shot|cumshot|fisting|masturbat(?:e|es|ed|ing|ion)|sex)\b/i;
const YOUTH_CODED = /\bteen(?:s|age|ager)?\b|school\s*girl|barely\s*legal/i;

const extractTitle = (html) => stripTags(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 300) || null;
const extractMetaDescription = (html) => decodeHtml(html.match(/<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=["']([^"']*)["'][^>]*>/i)?.[1]
  || html.match(/<meta\b[^>]*\bcontent=["']([^"']*)["'][^>]*\bname=["']description["'][^>]*>/i)?.[1]
  || '').slice(0, 500) || null;
const extractHeadings = (html) => {
  const headings = [];
  for (const match of html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)) {
    const value = stripTags(match[1]);
    if (value && !headings.includes(value)) headings.push(value);
    if (headings.length >= 12) break;
  }
  return headings;
};

const stablePoolId = (rawUrl) => {
  const url = assertPublicWeShootAdultUrl(rawUrl);
  url.hash = '';
  const digest = createHash('sha256').update(url.toString()).digest('hex').slice(0, 16);
  return `weshootadult-product-${digest}`;
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
) throw new Error('weshootadult_catalog_probe_not_research_safe');

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
) throw new Error('weshootadult_adultlabs_input_not_research_safe');

let photorama = null;
try {
  photorama = JSON.parse(await readFile(PHOTORAMA_PATH, 'utf8'));
} catch {
  photorama = null;
}
if (photorama && (
  photorama?.status !== 'research_photorama_male_female_source_pool_discovery_only'
  || photorama?.imageBytesDownloaded !== false
  || photorama?.authenticationUsed !== false
  || photorama?.purchasePerformed !== false
  || photorama?.sourceIntentIsLabelAuthority !== false
  || photorama?.researchOnly !== true
  || photorama?.trainingReady !== false
  || photorama?.productionEligible !== false
)) throw new Error('weshootadult_photorama_input_not_research_safe');

const existingAdultLabsMaleFemale = (adultLabs.acceptedRecords || [])
  .filter((record) => record.targetFacet === 'male_female' && record.targetFacetSupportedByMetadata === true);
const existingPhotoramaMaleFemale = (photorama?.acceptedRecords || [])
  .filter((record) => record.targetFacet === 'male_female' && record.acceptedForMaleFemaleDiscovery === true);
const existingMaleFemaleCount = existingAdultLabsMaleFemale.length + existingPhotoramaMaleFemale.length;
const neededFromWeShootAdult = Math.max(0, TARGET_TOTAL_MALE_FEMALE_POOLS - existingMaleFemaleCount);

const source = (catalog.sources || []).find((item) => item.sourceId === 'weshootadult_public_catalog');
if (!source) throw new Error('weshootadult_public_catalog_missing');

const productLinks = [...new Map((source.strongProductLinks || [])
  .map((item) => {
    try {
      const url = assertPublicWeShootAdultUrl(item.url);
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
  if (accepted.length >= neededFromWeShootAdult) break;
  probedProductCount += 1;
  try {
    const { html, finalUrl } = await fetchHtml(product.url);
    const title = extractTitle(html);
    const metaDescription = extractMetaDescription(html);
    const headings = extractHeadings(html);
    const metadataEvidence = normalizeWhitespace(`${product.anchorText || ''} ${title || ''} ${metaDescription || ''} ${headings.join(' ')}`);
    const maleFemaleSupportedByMetadata = MALE_FEMALE.test(metadataEvidence);
    const explicitActSupportedByMetadata = EXPLICIT_ACT.test(metadataEvidence);
    const acceptedForMaleFemaleDiscovery = maleFemaleSupportedByMetadata && explicitActSupportedByMetadata;
    const record = {
      sourceId: 'weshootadult_public_catalog',
      sourcePoolId: stablePoolId(finalUrl),
      productUrl: finalUrl.toString(),
      anchorText: product.anchorText,
      title,
      metaDescription,
      headings,
      metadataEvidenceScope: 'anchor_title_meta_headings_only',
      targetFacet: 'male_female',
      discoveryFacets: [
        ...(maleFemaleSupportedByMetadata ? ['male_female'] : []),
        ...(explicitActSupportedByMetadata ? ['explicit_act_discovery'] : []),
      ],
      maleFemaleSupportedByMetadata,
      explicitActSupportedByMetadata,
      acceptedForMaleFemaleDiscovery,
      youthCodedMarketingContext: YOUTH_CODED.test(metadataEvidence),
      youthCodedMarketingIsNotAgeProof: true,
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      humanAgeSafetyReviewRequired: true,
      detectorLabel: null,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    };
    if (acceptedForMaleFemaleDiscovery) accepted.push(record);
    else rejected.push(record);
  } catch (error) {
    rejected.push({
      sourceId: 'weshootadult_public_catalog',
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

const combinedMaleFemaleCount = existingMaleFemaleCount + accepted.length;
const remainingShortage = Math.max(0, TARGET_TOTAL_MALE_FEMALE_POOLS - combinedMaleFemaleCount);
const youthCodedPoolCount = accepted.filter((record) => record.youthCodedMarketingContext).length;

await mkdir(ROOT, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_weshootadult_male_female_source_pool_discovery_only',
  targetTotalMaleFemalePools: TARGET_TOTAL_MALE_FEMALE_POOLS,
  existingAdultLabsMaleFemaleCount: existingAdultLabsMaleFemale.length,
  existingPhotoramaMaleFemaleCount: existingPhotoramaMaleFemale.length,
  existingMaleFemaleCount,
  neededFromWeShootAdult,
  availablePublicProductLinks: productLinks.length,
  probedProductCount,
  acceptedWeShootAdultPoolCount: accepted.length,
  combinedMaleFemaleCount,
  remainingShortage,
  metadataEvidenceScope: 'anchor_title_meta_headings_only',
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
  existingPhotoramaMaleFemaleCount: existingPhotoramaMaleFemale.length,
  neededFromWeShootAdult,
  availablePublicProductLinks: productLinks.length,
  probedProductCount,
  acceptedWeShootAdultPoolCount: accepted.length,
  combinedMaleFemaleCount,
  remainingShortage,
  youthCodedPoolCount,
  metadataEvidenceScope: 'anchor_title_meta_headings_only',
  sampleAccepted: accepted.slice(0, 10).map((record) => ({
    sourcePoolId: record.sourcePoolId,
    productUrl: record.productUrl,
    title: record.title,
    headings: record.headings,
  })),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
