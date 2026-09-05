import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'docs', 'moderation-professional-adult-public-preview-sources-v1.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-promo-leads-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'public-link-probe.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const LINK_HINT = /(fhg|gallery|galleries|promo|promotional|marketing|content|free[-_ ]?(?:site|photo|picture|gallery)|hosted)/i;

const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 220);
const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));

if (
  config?.status !== 'research_professional_adult_public_preview_sources'
  || config?.rules?.publicPreviewOnly !== true
  || config?.rules?.noMemberArea !== true
  || config?.rules?.noPaywallBypass !== true
  || config?.rules?.noLoginBypass !== true
  || config?.rules?.noAgeGateBypass !== true
  || config?.rules?.noSessionCookieReuse !== true
) throw new Error('invalid_professional_adult_promo_probe_config');

const leads = [
  ...(config.rightsConfirmedPromotionalLeads || []),
  ...(config.affiliateGalleryLeads || []),
].filter((lead) => lead.automatedDiscoveryEligible === false);

const pagesForLead = (lead) => {
  const raw = [...(lead.urls || []), ...(lead.url ? [lead.url] : [])];
  return [...new Set(raw.map(clean).filter(Boolean))];
};

const assertSeedUrl = (raw) => {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('promo_probe_seed_must_be_https');
  return url;
};

const fetchPublicHtml = async (rawUrl) => {
  const requested = assertSeedUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`promo_probe_http_${response.status}`);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:') throw new Error('promo_probe_redirect_not_https');
  return { html: await response.text(), finalUrl };
};

const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');

const collectLinks = (html, pageUrl) => {
  const found = new Map();
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    let url;
    try {
      url = new URL(decodeHtml(match[1]), pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    url.hash = '';
    const anchorText = decodeHtml(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim().slice(0, 180);
    const evidence = `${url.pathname} ${url.search} ${anchorText}`;
    if (!LINK_HINT.test(evidence)) continue;
    const key = url.toString();
    if (!found.has(key)) found.set(key, { url: key, anchorText: anchorText || null });
  }
  return [...found.values()];
};

const results = [];
for (const lead of leads) {
  const pages = pagesForLead(lead);
  const pageResults = [];
  for (const page of pages) {
    try {
      const { html, finalUrl } = await fetchPublicHtml(page);
      pageResults.push({
        requestedUrl: page,
        finalUrl: finalUrl.toString(),
        matchingLinks: collectLinks(html, finalUrl),
        error: null,
      });
    } catch (error) {
      pageResults.push({ requestedUrl: page, finalUrl: null, matchingLinks: [], error: safeError(error) });
    }
  }
  const matchingLinkCount = pageResults.reduce((sum, item) => sum + item.matchingLinks.length, 0);
  results.push({
    sourceId: lead.sourceId,
    sourceType: lead.sourceType || null,
    priority: lead.priority || null,
    termsStatus: lead.termsStatus || null,
    matchingLinkCount,
    pages: pageResults,
  });
  process.stdout.write(`Adult promo lead ${lead.sourceId}: ${matchingLinkCount} matching public links from ${pages.length} seed pages.\n`);
}

const allLinks = results.flatMap((lead) => lead.pages.flatMap((page) => page.matchingLinks.map((link) => ({
  sourceId: lead.sourceId,
  requestedUrl: page.requestedUrl,
  ...link,
}))));

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_professional_adult_public_promo_link_probe_only',
  generatedFrom: path.relative(REPO_ROOT, CONFIG_PATH),
  leadCount: leads.length,
  matchingLinkCount: allLinks.length,
  imageBytesDownloaded: false,
  authenticationUsed: false,
  memberAreasEntered: false,
  sourceIntentIsLabelAuthority: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  results,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  leadCount: leads.length,
  matchingLinkCount: allLinks.length,
  bySource: Object.fromEntries(results.map((result) => [result.sourceId, result.matchingLinkCount])),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
