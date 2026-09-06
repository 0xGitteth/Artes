import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'adultlabs-facet-filters.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const BASE_URL = 'https://adultlabs.com/content';
const FACETS = ['Hardcore', 'Girls Solo', 'Lesbo', 'Boys Solo', 'Boys Hardcore'];

const clean = (value) => String(value || '').trim();
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');
const stripTags = (html) => decodeHtml(String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();

const fetchHtml = async (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !['adultlabs.com', 'www.adultlabs.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('adultlabs_facet_url_not_allowed');
  }
  const response = await fetch(url, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`adultlabs_facet_http_${response.status}`);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:' || !['adultlabs.com', 'www.adultlabs.com'].includes(finalUrl.hostname.toLowerCase())) {
    throw new Error('adultlabs_facet_redirect_not_allowed');
  }
  return { html: await response.text(), finalUrl };
};

const collectFacetEvidence = (html, label) => {
  const lower = html.toLowerCase();
  const needle = label.toLowerCase();
  const evidence = [];
  let cursor = 0;
  while (cursor < lower.length) {
    const index = lower.indexOf(needle, cursor);
    if (index < 0) break;
    const start = Math.max(0, index - 900);
    const end = Math.min(html.length, index + needle.length + 900);
    const snippet = html.slice(start, end);
    const numericCandidates = new Set();
    const queryCandidates = new Set();

    for (const match of snippet.matchAll(/(?:n(?:%5B%5D|\[\])|category|cat|filter|facet|type)[^0-9]{0,24}(\d{1,5})/gi)) numericCandidates.add(match[1]);
    for (const match of snippet.matchAll(/(?:value|data-(?:id|value|filter|category|facet))=["'](\d{1,5})["']/gi)) numericCandidates.add(match[1]);
    for (const match of snippet.matchAll(/(?:href|data-href|data-url|onclick)=["']([^"']+)["']/gi)) {
      const value = decodeHtml(match[1]);
      if (/content|n\[\]|n%5B%5D|category|filter|facet/i.test(value)) queryCandidates.add(value.slice(0, 500));
    }

    evidence.push({
      textPreview: stripTags(snippet).slice(0, 700),
      numericCandidates: [...numericCandidates],
      queryCandidates: [...queryCandidates],
    });
    cursor = index + needle.length;
    if (evidence.length >= 8) break;
  }
  return evidence;
};

const productCount = (html) => {
  const ids = new Set();
  for (const match of html.matchAll(/\/content\/set\/[^"'<>\s]+-(\d+)\/?/gi)) ids.add(match[1]);
  return ids.size;
};

const pageContainsFacet = (html, label) => {
  const text = stripTags(html);
  if (label === 'Boys Hardcore') return /\bBoys Hardcore\b/i.test(text) || /\bBoyBoy\b/i.test(text) || /\bgay\s+sex\b/i.test(text);
  if (label === 'Boys Solo') return /\bBoys Solo\b/i.test(text) || /\bmale\s+solo\b/i.test(text);
  if (label === 'Girls Solo') return /\bGirls Solo\b/i.test(text) || /\bfemale\s+solo\b/i.test(text);
  if (label === 'Lesbo') return /\bLesbo\b/i.test(text) || /\blesbian\b/i.test(text) || /\bGirlGirl\b/i.test(text);
  return /\bHardcore\b/i.test(text);
};

const { html } = await fetchHtml(BASE_URL);
const facetResults = [];

for (const label of FACETS) {
  const evidence = collectFacetEvidence(html, label);
  const candidateIds = [...new Set(evidence.flatMap((item) => item.numericCandidates))].slice(0, 30);
  const probes = [];

  for (const id of candidateIds) {
    const url = new URL(BASE_URL);
    url.searchParams.append('n[]', id);
    try {
      const result = await fetchHtml(url);
      probes.push({
        id,
        url: result.finalUrl.toString(),
        productCount: productCount(result.html),
        containsFacetEvidence: pageContainsFacet(result.html, label),
      });
    } catch (error) {
      probes.push({ id, url: url.toString(), productCount: 0, containsFacetEvidence: false, error: clean(error?.message || error).slice(0, 180) });
    }
  }

  const ranked = probes
    .filter((probe) => probe.containsFacetEvidence && probe.productCount > 0)
    .sort((a, b) => b.productCount - a.productCount);

  facetResults.push({
    label,
    occurrenceCount: evidence.length,
    candidateIds,
    resolvedCandidates: ranked.slice(0, 8),
    evidence,
  });

  process.stdout.write(`AdultLabs facet ${label}: ${evidence.length} occurrences, ${candidateIds.length} candidate ids, ${ranked.length} plausible public filters.\n`);
}

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_adultlabs_public_facet_filter_resolution_only',
  baseUrl: BASE_URL,
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  sourceIntentIsLabelAuthority: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  facets: facetResults,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  byFacet: Object.fromEntries(facetResults.map((facet) => [facet.label, {
    occurrenceCount: facet.occurrenceCount,
    candidateIds: facet.candidateIds,
    resolvedCandidates: facet.resolvedCandidates.map((candidate) => ({ id: candidate.id, productCount: candidate.productCount, url: candidate.url })),
  }])),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
