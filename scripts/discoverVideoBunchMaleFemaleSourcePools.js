import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const ADULTLABS_PATH = path.join(ROOT, 'adultlabs-target-scene-source-pools.json');
const OUTPUT_PATH = path.join(ROOT, 'videobunch-male-female-source-pools.json');
const BASE_URL = 'https://www.videobunch.com/';
const USER_AGENT = 'ArtesModerationResearch/1.0';
const ALLOWED_HOSTS = new Set(['videobunch.com', 'www.videobunch.com']);
const TARGET_TOTAL_MALE_FEMALE_POOLS = 10;
const MAX_VIEW_ALL_PAGES = 8;
const MAX_PRODUCT_PROBES = 100;
const MAX_ACCEPTED_PER_STUDIO = 1;

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

const assertPublicVideoBunchUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('videobunch_male_female_url_not_allowed');
  }
  return url;
};

const fetchHtml = async (rawUrl) => {
  const requested = assertPublicVideoBunchUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`videobunch_male_female_http_${response.status}`);
  const finalUrl = assertPublicVideoBunchUrl(response.url);
  return { html: await response.text(), finalUrl };
};

const EXPLICIT_ACT = /\b(?:anal|oral|blow\s*job|blowjob|hand\s*job|handjob|penetrat(?:e|es|ed|ing|ion)|intercourse|cum\s*shot|cumshot|cream\s*pie|creampie|deep\s*throat|double\s*penetration|vaginal\s*sex|sex)\b/i;
const YOUTH_CODED = /\bteen(?:s|age|ager)?\b|school\s*girl|barely\s*legal|performers?\s+age\s*:\s*18\s*[-–]\s*19/i;
const STRAIGHT = /\b(?:niche|main\s+genre)\s*:\s*straight\b/i;
const HIGHRES_HARDCORE = /images\s*-\s*highres\s*:\s*[^.]{0,100}\bhardcore\b/i;
const COMPLIANT_2257 = /\b2257\s*:\s*compliant\b/i;

const stablePoolId = (rawUrl) => {
  const url = assertPublicVideoBunchUrl(rawUrl);
  url.hash = '';
  const digest = createHash('sha256').update(url.toString()).digest('hex').slice(0, 16);
  return `videobunch-product-${digest}`;
};

const collectLinks = (html, pageUrl) => {
  const productLinks = new Map();
  const viewAllLinks = new Map();
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    let url;
    try { url = new URL(decodeHtml(match[1]), pageUrl); } catch { continue; }
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) continue;
    url.protocol = 'https:';
    url.hash = '';
    const anchorText = stripTags(match[2]).slice(0, 240) || null;
    if (/^\/product\/[A-Za-z0-9][A-Za-z0-9_-]*\/?$/i.test(url.pathname)) {
      productLinks.set(url.toString(), { url: url.toString(), anchorText });
      continue;
    }
    if (/^view\s+all$/i.test(anchorText || '') && url.pathname !== '/') {
      viewAllLinks.set(url.toString(), { url: url.toString(), anchorText });
    }
  }
  return { productLinks: [...productLinks.values()], viewAllLinks: [...viewAllLinks.values()] };
};

const extractTitle = (html) => {
  const h1 = stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  if (h1) return h1.slice(0, 300);
  return stripTags(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 300) || null;
};

const extractContentInfo = (html) => {
  const text = stripTags(html);
  const lower = text.toLowerCase();
  const start = lower.indexOf('content info:');
  if (start < 0) return '';
  const maxEnd = Math.min(text.length, start + 7000);
  const candidates = [
    lower.indexOf(' license ', start + 20),
    lower.indexOf(' attributes:', start + 20),
    lower.indexOf(' information ', start + 20),
    lower.indexOf(' related products', start + 20),
  ].filter((index) => index > start + 40 && index < maxEnd);
  const end = candidates.length > 0 ? Math.min(...candidates) : maxEnd;
  return text.slice(start, end);
};

const extractStudio = (contentInfo) => {
  const match = contentInfo.match(/\bstudio\s*:\s*(.+?)(?=\s+sub\s+studio\s*:|\s+size\s*:|\s+resolution\s*:|\s+original\s+format\s*:|$)/i);
  return normalizeWhitespace(match?.[1] || '').slice(0, 160) || null;
};

const extractSubStudio = (contentInfo) => {
  const match = contentInfo.match(/\bsub\s+studio\s*:\s*(.+?)(?=\s+size\s*:|\s+resolution\s*:|\s+original\s+format\s*:|$)/i);
  return normalizeWhitespace(match?.[1] || '').slice(0, 160) || null;
};

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
) throw new Error('videobunch_adultlabs_input_not_research_safe');

const existingAdultLabsMaleFemale = (adultLabs.acceptedRecords || [])
  .filter((record) => record.targetFacet === 'male_female' && record.targetFacetSupportedByMetadata === true);
const existingMaleFemaleCount = existingAdultLabsMaleFemale.length;
const neededFromVideoBunch = Math.max(0, TARGET_TOTAL_MALE_FEMALE_POOLS - existingMaleFemaleCount);

const homepage = await fetchHtml(BASE_URL);
const homepageLinks = collectLinks(homepage.html, homepage.finalUrl);
const productMap = new Map(homepageLinks.productLinks.map((item) => [item.url, item]));
const listingPageSummaries = [];

for (const listing of homepageLinks.viewAllLinks.slice(0, MAX_VIEW_ALL_PAGES)) {
  try {
    const { html, finalUrl } = await fetchHtml(listing.url);
    const links = collectLinks(html, finalUrl);
    for (const product of links.productLinks) productMap.set(product.url, product);
    listingPageSummaries.push({ url: finalUrl.toString(), productLinkCount: links.productLinks.length, error: null });
  } catch (error) {
    listingPageSummaries.push({ url: listing.url, productLinkCount: 0, error: safeError(error) });
  }
}

const productLinks = [...productMap.values()].slice(0, MAX_PRODUCT_PROBES);
const accepted = [];
const rejected = [];
const acceptedPerStudio = new Map();
let probedProductCount = 0;

for (const product of productLinks) {
  if (accepted.length >= neededFromVideoBunch) break;
  probedProductCount += 1;
  try {
    const { html, finalUrl } = await fetchHtml(product.url);
    const title = extractTitle(html);
    const contentInfo = extractContentInfo(html);
    const straightSupportedByMetadata = STRAIGHT.test(contentInfo);
    const explicitActSupportedByMetadata = EXPLICIT_ACT.test(contentInfo);
    const highResHardcoreStillsAvailable = HIGHRES_HARDCORE.test(contentInfo);
    const compliant2257 = COMPLIANT_2257.test(contentInfo);
    const youthCodedMarketingContext = YOUTH_CODED.test(`${title || ''} ${contentInfo}`);
    const studio = extractStudio(contentInfo);
    const subStudio = extractSubStudio(contentInfo);
    const studioKey = clean(studio || subStudio || 'unknown').toLowerCase();
    const studioAcceptedCount = acceptedPerStudio.get(studioKey) || 0;
    const metadataQualified = straightSupportedByMetadata
      && explicitActSupportedByMetadata
      && highResHardcoreStillsAvailable
      && compliant2257
      && !youthCodedMarketingContext;
    const studioDiversityQualified = studioKey !== 'unknown' && studioAcceptedCount < MAX_ACCEPTED_PER_STUDIO;
    const acceptedForMaleFemaleDiscovery = metadataQualified && studioDiversityQualified;

    const record = {
      sourceId: 'videobunch_public_catalog',
      sourcePoolId: stablePoolId(finalUrl),
      productUrl: finalUrl.toString(),
      discoveredFrom: 'public_homepage_or_view_all_listing',
      anchorText: product.anchorText,
      title,
      targetFacet: 'male_female',
      discoveryFacets: [
        ...(straightSupportedByMetadata ? ['male_female'] : []),
        ...(explicitActSupportedByMetadata ? ['explicit_act_discovery'] : []),
      ],
      metadataEvidenceScope: 'product_content_info_only',
      straightSupportedByMetadata,
      explicitActSupportedByMetadata,
      highResHardcoreStillsAvailable,
      compliant2257,
      studio,
      subStudio,
      studioDiversityQualified,
      acceptedForMaleFemaleDiscovery,
      youthCodedMarketingContext,
      youthCodedMarketingIsNotAgeProof: true,
      youthCodedCandidatesExcludedFromPreferredShortlist: true,
      contentInfoPreview: contentInfo.slice(0, 1400),
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      humanAgeSafetyReviewRequired: true,
      detectorLabel: null,
      imageBytesDownloaded: false,
      authenticationUsed: false,
      purchasePerformed: false,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    };

    if (acceptedForMaleFemaleDiscovery) {
      accepted.push(record);
      acceptedPerStudio.set(studioKey, studioAcceptedCount + 1);
    } else {
      rejected.push(record);
    }
  } catch (error) {
    rejected.push({
      sourceId: 'videobunch_public_catalog',
      sourcePoolId: stablePoolId(product.url),
      productUrl: product.url,
      targetFacet: 'male_female',
      acceptedForMaleFemaleDiscovery: false,
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      detectorLabel: null,
      imageBytesDownloaded: false,
      authenticationUsed: false,
      purchasePerformed: false,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
      error: safeError(error),
    });
  }
}

const combinedMaleFemaleCount = existingMaleFemaleCount + accepted.length;
const remainingShortage = Math.max(0, TARGET_TOTAL_MALE_FEMALE_POOLS - combinedMaleFemaleCount);
const distinctStudioCount = new Set(accepted.map((record) => clean(record.studio || record.subStudio).toLowerCase()).filter(Boolean)).size;

await mkdir(ROOT, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_videobunch_male_female_source_pool_discovery_only',
  targetTotalMaleFemalePools: TARGET_TOTAL_MALE_FEMALE_POOLS,
  existingAdultLabsMaleFemaleCount: existingAdultLabsMaleFemale.length,
  existingMaleFemaleCount,
  neededFromVideoBunch,
  homepageProductLinkCount: homepageLinks.productLinks.length,
  viewAllLinkCount: homepageLinks.viewAllLinks.length,
  availablePublicProductLinks: productLinks.length,
  probedProductCount,
  acceptedVideoBunchPoolCount: accepted.length,
  distinctStudioCount,
  combinedMaleFemaleCount,
  remainingShortage,
  metadataEvidenceScope: 'product_content_info_only',
  acceptanceRequires: ['straight', 'explicit_act_metadata', 'highres_hardcore_stills', '2257_compliant', 'not_youth_coded', 'studio_diversity'],
  youthCodedMarketingIsNotAgeProof: true,
  youthCodedCandidatesExcludedFromPreferredShortlist: true,
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  sourceIntentIsLabelAuthority: false,
  humanVisualScreeningRequired: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  listingPageSummaries,
  acceptedRecords: accepted,
  rejectedRecords: rejected,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  existingAdultLabsMaleFemaleCount: existingAdultLabsMaleFemale.length,
  neededFromVideoBunch,
  homepageProductLinkCount: homepageLinks.productLinks.length,
  viewAllLinkCount: homepageLinks.viewAllLinks.length,
  availablePublicProductLinks: productLinks.length,
  probedProductCount,
  acceptedVideoBunchPoolCount: accepted.length,
  distinctStudioCount,
  combinedMaleFemaleCount,
  remainingShortage,
  metadataEvidenceScope: 'product_content_info_only',
  acceptanceRequires: ['straight', 'explicit_act_metadata', 'highres_hardcore_stills', '2257_compliant', 'not_youth_coded', 'studio_diversity'],
  sampleAccepted: accepted.slice(0, 10).map((record) => ({
    sourcePoolId: record.sourcePoolId,
    productUrl: record.productUrl,
    title: record.title,
    studio: record.studio,
    subStudio: record.subStudio,
  })),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
