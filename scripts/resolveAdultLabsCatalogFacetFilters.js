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
const stripTags = (html) => decodeHtml(String(html || '')
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' '))
  .trim();
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const productIds = (html) => {
  const ids = new Set();
  for (const match of html.matchAll(/\/content\/set\/[^"'<>\s]+-(\d+)\/?/gi)) ids.add(match[1]);
  return ids;
};

const extractNumericFilterId = (raw) => {
  const value = decodeHtml(clean(raw));
  if (!value) return null;
  const direct = value.match(/^(\d{1,5})$/);
  if (direct) return direct[1];
  try {
    const url = new URL(value, BASE_URL);
    const ids = url.searchParams.getAll('n[]');
    if (ids.length === 1 && /^\d{1,5}$/.test(ids[0])) return ids[0];
  } catch {
    // Not a URL; continue with encoded-query fallback.
  }
  const query = value.match(/(?:n(?:%5B%5D|\[\]))=(\d{1,5})/i);
  return query?.[1] || null;
};

const collectExactFacetControls = (html, label) => {
  const controls = new Map();
  const add = (id, origin, snippet) => {
    if (!id || !/^\d{1,5}$/.test(id)) return;
    const existing = controls.get(id);
    if (existing) {
      existing.origins = Array.from(new Set([...existing.origins, origin]));
      return;
    }
    controls.set(id, {
      id,
      origins: [origin],
      textPreview: stripTags(snippet).slice(0, 500),
    });
  };

  const needle = escapeRegExp(label);

  // Common form: <label ...><input ... value="123">Boys Hardcore</label>
  const wrappedLabel = new RegExp(`<label\\b[^>]*>([\\s\\S]{0,900}?${needle}[\\s\\S]{0,900}?)<\\/label>`, 'gi');
  for (const match of html.matchAll(wrappedLabel)) {
    const body = match[1];
    for (const input of body.matchAll(/<input\b[^>]*>/gi)) {
      const value = input[0].match(/\bvalue=["']([^"']+)["']/i)?.[1];
      add(extractNumericFilterId(value), 'label_wrapped_input', match[0]);
    }
    for (const href of body.matchAll(/\bhref=["']([^"']+)["']/gi)) {
      add(extractNumericFilterId(href[1]), 'label_wrapped_link', match[0]);
    }
  }

  // Common form: <input id="foo" value="123"><label for="foo">Boys Hardcore</label>
  const forLabel = new RegExp(`<label\\b[^>]*\\bfor=["']([^"']+)["'][^>]*>[\\s\\S]{0,500}?${needle}[\\s\\S]{0,500}?<\\/label>`, 'gi');
  for (const match of html.matchAll(forLabel)) {
    const inputId = escapeRegExp(match[1]);
    const inputPattern = new RegExp(`<input\\b(?=[^>]*\\bid=["']${inputId}["'])[^>]*>`, 'i');
    const input = html.match(inputPattern)?.[0];
    const value = input?.match(/\bvalue=["']([^"']+)["']/i)?.[1];
    add(extractNumericFilterId(value), 'for_label_input', `${input || ''} ${match[0]}`);
  }

  // Link-style filters where the visible anchor itself is the facet name.
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const text = stripTags(match[2]);
    if (new RegExp(`^\\s*${needle}\\s*$`, 'i').test(text)) {
      add(extractNumericFilterId(match[1]), 'exact_anchor_text', match[0]);
    }
  }

  // Data-driven controls with the facet label and one explicit numeric data/value field.
  const tagPattern = /<(?:button|option|li|div|span)\b[^>]*>[\s\S]*?<\/(?:button|option|li|div|span)>/gi;
  for (const match of html.matchAll(tagPattern)) {
    if (!new RegExp(`\\b${needle}\\b`, 'i').test(stripTags(match[0]))) continue;
    const values = [];
    for (const attr of match[0].matchAll(/\b(?:value|data-(?:id|value|filter|category|facet|url|href))=["']([^"']+)["']/gi)) {
      const id = extractNumericFilterId(attr[1]);
      if (id) values.push(id);
    }
    if (new Set(values).size === 1) add(values[0], 'data_control_exact_label', match[0]);
  }

  return [...controls.values()];
};

const jaccard = (a, b) => {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / union.size;
};

const base = await fetchHtml(BASE_URL);
const baseProducts = productIds(base.html);
const facetResults = [];

for (const label of FACETS) {
  const controls = collectExactFacetControls(base.html, label);
  const candidateIds = controls.map((item) => item.id);
  const probes = [];

  for (const id of candidateIds) {
    const url = new URL(BASE_URL);
    url.searchParams.append('n[]', id);
    try {
      const result = await fetchHtml(url);
      const filteredProducts = productIds(result.html);
      const overlapWithBase = Number(jaccard(baseProducts, filteredProducts).toFixed(4));
      const matchingControls = collectExactFacetControls(result.html, label).filter((control) => control.id === id);
      const queryKeepsId = result.finalUrl.searchParams.getAll('n[]').includes(id);
      const changedProductSet = filteredProducts.size > 0 && overlapWithBase < 0.95;
      probes.push({
        id,
        url: result.finalUrl.toString(),
        productCount: filteredProducts.size,
        overlapWithBase,
        exactFacetControlStillPresent: matchingControls.length > 0,
        queryKeepsId,
        changedProductSet,
      });
    } catch (error) {
      probes.push({
        id,
        url: url.toString(),
        productCount: 0,
        overlapWithBase: 1,
        exactFacetControlStillPresent: false,
        queryKeepsId: false,
        changedProductSet: false,
        error: clean(error?.message || error).slice(0, 180),
      });
    }
  }

  const ranked = probes
    .filter((probe) => probe.productCount > 0 && probe.exactFacetControlStillPresent && probe.changedProductSet)
    .sort((a, b) => a.overlapWithBase - b.overlapWithBase || b.productCount - a.productCount);

  facetResults.push({
    label,
    exactControlCount: controls.length,
    controls,
    candidateIds,
    resolvedCandidates: ranked.slice(0, 4),
    rejectedCandidates: probes.filter((probe) => !ranked.some((candidate) => candidate.id === probe.id)),
  });

  process.stdout.write(`AdultLabs facet ${label}: ${controls.length} exact controls, ${candidateIds.length} candidate ids, ${ranked.length} validated public filters.\n`);
}

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 2,
  status: 'research_adultlabs_public_facet_filter_resolution_only',
  baseUrl: BASE_URL,
  baselineProductCount: baseProducts.size,
  resolverRule: 'facet_id_must_be_bound_to_exact_ui_control_and_filtered_product_set_must_change',
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
  baselineProductCount: baseProducts.size,
  byFacet: Object.fromEntries(facetResults.map((facet) => [facet.label, {
    exactControlCount: facet.exactControlCount,
    candidateIds: facet.candidateIds,
    resolvedCandidates: facet.resolvedCandidates.map((candidate) => ({
      id: candidate.id,
      productCount: candidate.productCount,
      overlapWithBase: candidate.overlapWithBase,
      url: candidate.url,
    })),
  }])),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
