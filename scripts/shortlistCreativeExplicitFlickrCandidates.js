import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'docs', 'moderation-creative-explicit-discovery-v1.json');
const DISCOVERY_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'creative-explicit-v1');
const INPUT_PATH = path.join(DISCOVERY_DIR, 'flickr-candidates.json');
const OUTPUT_PATH = path.join(DISCOVERY_DIR, 'flickr-metadata-shortlist.json');

const clean = (value) => String(value || '').trim();
const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
const discovery = JSON.parse(await readFile(INPUT_PATH, 'utf8'));

if (
  config?.status !== 'research_discovery_only'
  || discovery?.status !== 'research_discovery_only'
  || discovery?.discoveryIsLabelAuthority !== false
  || discovery?.imageBytesDownloaded !== false
  || !Array.isArray(discovery?.candidates)
  || discovery.candidates.length < Number(config.minimumDiscoveryTarget || 0)
) {
  throw new Error('creative_explicit_discovery_not_ready_for_metadata_shortlist');
}

const target = Number(config.metadataShortlistTarget || 180);
const maxPerOwner = Number(config.maxMetadataShortlistPerOwner || 3);
const minOwners = Number(config.minimumMetadataShortlistOwners || 60);
const bucketTargets = config.bucketTargets || {};
const bucketTagSets = Object.fromEntries(
  Object.entries(config.bucketTags || {}).map(([bucket, tags]) => [bucket, new Set((tags || []).map(clean).filter(Boolean))]),
);
const bucketOrder = ['explicit_act', 'full_frontal_genitalia', 'bdsm_kink', 'art_nude'];

if (target < 120 || maxPerOwner < 1 || maxPerOwner > 5 || minOwners < 30) {
  throw new Error('invalid_creative_explicit_metadata_shortlist_config');
}

const ownerUniverseCounts = discovery.ownerCounts || discovery.candidates.reduce((acc, item) => {
  const owner = clean(item.ownerSlug);
  if (owner) acc[owner] = (acc[owner] || 0) + 1;
  return acc;
}, {});

const candidateBuckets = (candidate) => {
  const tags = new Set((candidate.discoveryTags || []).map(clean).filter(Boolean));
  return bucketOrder.filter((bucket) => {
    const allowed = bucketTagSets[bucket] || new Set();
    return [...tags].some((tag) => allowed.has(tag));
  });
};

const scoreForBucket = (candidate, bucket) => {
  const allowed = bucketTagSets[bucket] || new Set();
  const tags = (candidate.discoveryTags || []).map(clean).filter(Boolean);
  const exactHits = tags.filter((tag) => allowed.has(tag)).length;
  const multiBucket = candidateBuckets(candidate).length;
  const ownerCount = Number(ownerUniverseCounts[clean(candidate.ownerSlug)] || 9999);
  const photoId = Number(candidate.photoId || 0);
  return { exactHits, tagCount: tags.length, multiBucket, ownerCount, photoId };
};

const compareForBucket = (bucket) => (a, b) => {
  const sa = scoreForBucket(a, bucket);
  const sb = scoreForBucket(b, bucket);
  if (sb.exactHits !== sa.exactHits) return sb.exactHits - sa.exactHits;
  if (sb.tagCount !== sa.tagCount) return sb.tagCount - sa.tagCount;
  if (sa.multiBucket !== sb.multiBucket) return sa.multiBucket - sb.multiBucket;
  if (sa.ownerCount !== sb.ownerCount) return sa.ownerCount - sb.ownerCount;
  if (sb.photoId !== sa.photoId) return sb.photoId - sa.photoId;
  return clean(a.sourcePageUrl).localeCompare(clean(b.sourcePageUrl));
};

const selected = [];
const selectedUrls = new Set();
const ownerSelectedCounts = new Map();
const bucketSelectedCounts = Object.fromEntries(bucketOrder.map((bucket) => [bucket, 0]));

const canSelect = (candidate) => {
  const owner = clean(candidate.ownerSlug);
  if (!owner || selectedUrls.has(candidate.sourcePageUrl)) return false;
  return Number(ownerSelectedCounts.get(owner) || 0) < maxPerOwner;
};

const addSelected = (candidate, bucket) => {
  const owner = clean(candidate.ownerSlug);
  selectedUrls.add(candidate.sourcePageUrl);
  ownerSelectedCounts.set(owner, Number(ownerSelectedCounts.get(owner) || 0) + 1);
  bucketSelectedCounts[bucket] = Number(bucketSelectedCounts[bucket] || 0) + 1;
  selected.push({
    ...candidate,
    metadataShortlistBucket: bucket,
    metadataShortlistOnly: true,
    humanVisualScreeningRequired: true,
    humanAgeSafetyReviewRequired: true,
    detectorLabel: null,
    researchOnly: true,
    trainingReady: false,
    productionEligible: false,
  });
};

for (const bucket of bucketOrder) {
  const bucketTarget = Number(bucketTargets[bucket] || 0);
  if (bucketTarget <= 0) continue;
  const pool = discovery.candidates
    .filter((candidate) => candidateBuckets(candidate).includes(bucket))
    .sort(compareForBucket(bucket));
  for (const candidate of pool) {
    if (bucketSelectedCounts[bucket] >= bucketTarget) break;
    if (!canSelect(candidate)) continue;
    addSelected(candidate, bucket);
  }
}

if (selected.length < target) {
  const remainder = discovery.candidates
    .filter((candidate) => !selectedUrls.has(candidate.sourcePageUrl))
    .sort((a, b) => {
      const ownerA = clean(a.ownerSlug);
      const ownerB = clean(b.ownerSlug);
      const selectedA = Number(ownerSelectedCounts.get(ownerA) || 0);
      const selectedB = Number(ownerSelectedCounts.get(ownerB) || 0);
      if (selectedA !== selectedB) return selectedA - selectedB;
      const bucketsA = candidateBuckets(a).length;
      const bucketsB = candidateBuckets(b).length;
      if (bucketsB !== bucketsA) return bucketsB - bucketsA;
      const tagsA = (a.discoveryTags || []).length;
      const tagsB = (b.discoveryTags || []).length;
      if (tagsB !== tagsA) return tagsB - tagsA;
      return Number(b.photoId || 0) - Number(a.photoId || 0);
    });
  for (const candidate of remainder) {
    if (selected.length >= target) break;
    if (!canSelect(candidate)) continue;
    const buckets = candidateBuckets(candidate);
    const bucket = buckets[0] || 'mixed_or_unassigned';
    addSelected(candidate, bucket);
  }
}

const shortlistOwnerCount = ownerSelectedCounts.size;
const largestShortlistOwnerCount = Math.max(0, ...ownerSelectedCounts.values());
const bucketShortages = Object.fromEntries(
  bucketOrder.map((bucket) => [bucket, Math.max(0, Number(bucketTargets[bucket] || 0) - Number(bucketSelectedCounts[bucket] || 0))]),
);
const bucketTargetsReached = Object.values(bucketShortages).every((value) => value === 0);
const targetReached = selected.length >= target;
const sourceDiversityReached = shortlistOwnerCount >= minOwners && largestShortlistOwnerCount <= maxPerOwner;
const readyForPreviewScreening = targetReached && sourceDiversityReached && bucketTargetsReached;

await mkdir(DISCOVERY_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_metadata_shortlist_only',
  generatedFrom: path.relative(REPO_ROOT, INPUT_PATH),
  requestedShortlistCount: target,
  shortlistCount: selected.length,
  shortlistOwnerCount,
  largestShortlistOwnerCount,
  maxPerOwner,
  minimumOwnerTarget: minOwners,
  bucketTargets,
  bucketCounts: bucketSelectedCounts,
  bucketShortages,
  bucketTargetsReached,
  targetReached,
  sourceDiversityReached,
  readyForPreviewScreening,
  discoveryIsLabelAuthority: false,
  humanVisualScreeningRequired: true,
  imageBytesDownloaded: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  candidates: selected,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  inputCandidateCount: discovery.candidates.length,
  shortlistCount: selected.length,
  shortlistOwnerCount,
  largestShortlistOwnerCount,
  maxPerOwner,
  bucketCounts: bucketSelectedCounts,
  bucketShortages,
  targetReached,
  sourceDiversityReached,
  bucketTargetsReached,
  readyForPreviewScreening,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false
}, null, 2)}\n`);
