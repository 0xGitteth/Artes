import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'docs', 'moderation-professional-explicit-diversity-leads-v1.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-explicit-diversity-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'public-gallery-lead-probe.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const LINK_HINT = /(fhg|free[-_ ]?hosted|hosted[-_ ]?galler|galler(?:y|ies)|promo|scene|tour)/i;

const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 220);
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
if (
  config?.status !== 'research_professional_explicit_source_diversity_leads'
  || config?.rules?.noAffiliateLoginBypass !== true
  || config?.rules?.noMemberArea !== true
  || config?.rules?.noPaywallBypass !== true
  || config?.rules?.noAgeGateBypass !== true
  || config?.rules?.sourceIntentIsLabelAuthority !== false
  || config?.researchOnly !== true
  || config?.trainingReady !== false
  || config?.productionEligible !== false
) throw new Error('invalid_explicit_diversity_lead_config');

const assertSeedUrl = (raw) => {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('explicit_diversity_seed_not_https');
  return url;
};

const fetchPublicHtml = async (rawUrl) => {
  const requested = assertSeedUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`explicit_diversity_http_${response.status}`);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:') throw new Error('explicit_diversity_redirect_not_https');
  return { html: await response.text(), finalUrl };
};

const collectLinks = (html, pageUrl) => {
  const found = new Map();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) !== null) {
    let url;
    try { url = new URL(decodeHtml(match[1]), pageUrl); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol)) continue;
    const anchorText = decodeHtml(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim().slice(0, 180);
    const evidence = `${url.hostname} ${url.pathname} ${url.search} ${anchorText}`;
    if (!LINK_HINT.test(evidence)) continue;
    if (url.protocol === 'http:') url.protocol = 'https:';
    url.hash = '';
    const key = url.toString();
    if (!found.has(key)) found.set(key, { url: key, anchorText: anchorText || null });
  }
  return [...found.values()];
};

const results = [];
for (const lead of config.leads || []) {
  const pages = [...new Set((lead.urls || []).map(clean).filter(Boolean))];
  const pageResults = [];
  for (const page of pages) {
    try {
      const { html, finalUrl } = await fetchPublicHtml(page);
      pageResults.push({ requestedUrl: page, finalUrl: finalUrl.toString(), matchingLinks: collectLinks(html, finalUrl), error: null });
    } catch (error) {
      pageResults.push({ requestedUrl: page, finalUrl: null, matchingLinks: [], error: safeError(error) });
    }
  }
  const matchingLinkCount = pageResults.reduce((sum, item) => sum + item.matchingLinks.length, 0);
  results.push({ sourceId: lead.sourceId, priority: lead.priority || null, matchingLinkCount, pages: pageResults });
  process.stdout.write(`Explicit diversity lead ${lead.sourceId}: ${matchingLinkCount} matching public links from ${pages.length} seed pages.\n`);
}

const uniqueLinks = new Map();
for (const result of results) {
  for (const page of result.pages) {
    for (const link of page.matchingLinks) {
      const existing = uniqueLinks.get(link.url);
      if (existing) {
        existing.sourceIds = Array.from(new Set([...existing.sourceIds, result.sourceId]));
      } else {
        uniqueLinks.set(link.url, { ...link, sourceIds: [result.sourceId] });
      }
    }
  }
}

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_professional_explicit_diversity_public_link_probe_only',
  generatedFrom: path.relative(REPO_ROOT, CONFIG_PATH),
  leadCount: results.length,
  uniqueMatchingLinkCount: uniqueLinks.size,
  imageBytesDownloaded: false,
  authenticationUsed: false,
  memberAreasEntered: false,
  sourceIntentIsLabelAuthority: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  results,
  links: [...uniqueLinks.values()],
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  leadCount: results.length,
  uniqueMatchingLinkCount: uniqueLinks.size,
  bySource: Object.fromEntries(results.map((result) => [result.sourceId, result.matchingLinkCount])),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
