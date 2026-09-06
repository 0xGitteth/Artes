import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'docs', 'moderation-professional-explicit-diversity-leads-v1.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-explicit-diversity-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'public-gallery-lead-probe.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const STRONG_GALLERY_HINT = /(fhg|free[-_ ]?hosted[-_ ]?galler|hosted[-_ ]?galler|\bgaller(?:y|ies)\b)/i;
const WEAK_MARKETING_HINT = /(promo|promotional|scene|tour|content|marketing)/i;

const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 220);
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('\\/', '/');

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

const normalizeUrl = (raw, pageUrl) => {
  const decoded = decodeHtml(clean(raw)).replace(/^['"]|['"]$/g, '');
  if (!decoded || decoded.startsWith('#') || decoded.startsWith('mailto:') || decoded.startsWith('data:') || decoded.startsWith('blob:')) return null;
  try {
    const url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded, pageUrl);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
};

const extractUrlishFragments = (value) => {
  const text = decodeHtml(value);
  const out = [];
  const absolute = /https?:\/\/[^\s"'<>\\)]+/gi;
  let match;
  while ((match = absolute.exec(text)) !== null) out.push(match[0]);
  const protocolRelative = /\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s"'<>\\)]*/g;
  while ((match = protocolRelative.exec(text)) !== null) out.push(match[0]);
  const jsQuotedRelative = /(?:window\.open|location(?:\.href)?|open|url)\s*\(\s*["']([^"']+)["']/gi;
  while ((match = jsQuotedRelative.exec(text)) !== null) out.push(match[1]);
  return out;
};

const classifyEvidence = (url, evidence) => {
  const combined = `${url.hostname} ${url.pathname} ${url.search} ${evidence}`;
  if (STRONG_GALLERY_HINT.test(combined)) return 'strong_gallery';
  if (WEAK_MARKETING_HINT.test(combined)) return 'weak_marketing';
  return null;
};

const collectLinks = (html, pageUrl) => {
  const found = new Map();
  const add = (rawUrl, evidence, origin) => {
    const url = normalizeUrl(rawUrl, pageUrl);
    if (!url) return;
    const strength = classifyEvidence(url, evidence);
    if (!strength) return;
    const key = url.toString();
    const existing = found.get(key);
    if (existing) {
      existing.origins = Array.from(new Set([...existing.origins, origin]));
      if (strength === 'strong_gallery') existing.strength = 'strong_gallery';
      return;
    }
    found.set(key, {
      url: key,
      strength,
      evidence: clean(evidence).slice(0, 220) || null,
      origins: [origin],
    });
  };

  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) !== null) {
    const attrs = match[1];
    const anchorText = decodeHtml(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim().slice(0, 180);
    const attrPattern = /([:\w-]+)=["']([^"']+)["']/gi;
    let attrMatch;
    while ((attrMatch = attrPattern.exec(attrs)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      const attrValue = attrMatch[2];
      if (['href', 'data-href', 'data-url', 'data-link', 'data-gallery', 'data-target'].includes(attrName)) {
        add(attrValue, `${anchorText} ${attrName}`, `anchor_${attrName}`);
      }
      if (attrName === 'onclick') {
        for (const fragment of extractUrlishFragments(attrValue)) add(fragment, `${anchorText} onclick`, 'anchor_onclick');
      }
    }
  }

  const genericAttributePattern = /(?:data-href|data-url|data-link|data-gallery|data-target|onclick)=["']([^"']+)["']/gi;
  while ((match = genericAttributePattern.exec(html)) !== null) {
    for (const fragment of extractUrlishFragments(match[1])) add(fragment, match[0], 'generic_attribute');
    add(match[1], match[0], 'generic_attribute_direct');
  }

  const absolutePattern = /https?:\/\/[^\s"'<>\\)]+/gi;
  while ((match = absolutePattern.exec(decodeHtml(html))) !== null) {
    const start = Math.max(0, match.index - 140);
    const end = Math.min(html.length, match.index + match[0].length + 140);
    const context = decodeHtml(html.slice(start, end)).replace(/<[^>]+>/g, ' ');
    if (STRONG_GALLERY_HINT.test(context) || WEAK_MARKETING_HINT.test(context)) add(match[0], context, 'plain_html_url');
  }

  const strongGalleryLinks = [...found.values()].filter((item) => item.strength === 'strong_gallery');
  const weakMarketingLinks = [...found.values()].filter((item) => item.strength === 'weak_marketing');
  return {
    strongGalleryLinks,
    weakMarketingLinks,
    exampleMarkerCount: (html.match(/Example\s*[1-4]/gi) || []).length,
  };
};

const activeLeads = (config.leads || []).filter((lead) => lead.publicProbeEligible !== false);
const deferredLeads = (config.leads || []).filter((lead) => lead.publicProbeEligible === false).map((lead) => ({
  sourceId: lead.sourceId,
  publicResolutionStatus: lead.publicResolutionStatus || null,
}));

const results = [];
for (const lead of activeLeads) {
  const pages = [...new Set((lead.urls || []).map(clean).filter(Boolean))];
  const pageResults = [];
  for (const page of pages) {
    try {
      const { html, finalUrl } = await fetchPublicHtml(page);
      const collected = collectLinks(html, finalUrl);
      pageResults.push({
        requestedUrl: page,
        finalUrl: finalUrl.toString(),
        strongGalleryLinks: collected.strongGalleryLinks,
        weakMarketingLinks: collected.weakMarketingLinks,
        exampleMarkerCount: collected.exampleMarkerCount,
        error: null,
      });
    } catch (error) {
      pageResults.push({ requestedUrl: page, finalUrl: null, strongGalleryLinks: [], weakMarketingLinks: [], exampleMarkerCount: 0, error: safeError(error) });
    }
  }
  const strongGalleryLinkCount = pageResults.reduce((sum, item) => sum + item.strongGalleryLinks.length, 0);
  const weakMarketingLinkCount = pageResults.reduce((sum, item) => sum + item.weakMarketingLinks.length, 0);
  const exampleMarkerCount = pageResults.reduce((sum, item) => sum + item.exampleMarkerCount, 0);
  results.push({
    sourceId: lead.sourceId,
    priority: lead.priority || null,
    publicResolutionStatus: lead.publicResolutionStatus || null,
    strongGalleryLinkCount,
    weakMarketingLinkCount,
    exampleMarkerCount,
    pages: pageResults,
  });
  process.stdout.write(`Explicit diversity lead ${lead.sourceId}: ${strongGalleryLinkCount} strong gallery links, ${weakMarketingLinkCount} weak marketing links, ${exampleMarkerCount} example markers from ${pages.length} seed pages.\n`);
}

const uniqueStrongLinks = new Map();
const uniqueWeakLinks = new Map();
for (const result of results) {
  for (const page of result.pages) {
    for (const link of page.strongGalleryLinks) {
      const existing = uniqueStrongLinks.get(link.url);
      if (existing) existing.sourceIds = Array.from(new Set([...existing.sourceIds, result.sourceId]));
      else uniqueStrongLinks.set(link.url, { ...link, sourceIds: [result.sourceId] });
    }
    for (const link of page.weakMarketingLinks) {
      if (uniqueStrongLinks.has(link.url)) continue;
      const existing = uniqueWeakLinks.get(link.url);
      if (existing) existing.sourceIds = Array.from(new Set([...existing.sourceIds, result.sourceId]));
      else uniqueWeakLinks.set(link.url, { ...link, sourceIds: [result.sourceId] });
    }
  }
}

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 2,
  status: 'research_professional_explicit_diversity_public_link_probe_only',
  generatedFrom: path.relative(REPO_ROOT, CONFIG_PATH),
  activeLeadCount: results.length,
  deferredLeadCount: deferredLeads.length,
  uniqueStrongGalleryLinkCount: uniqueStrongLinks.size,
  uniqueWeakMarketingLinkCount: uniqueWeakLinks.size,
  imageBytesDownloaded: false,
  authenticationUsed: false,
  memberAreasEntered: false,
  sourceIntentIsLabelAuthority: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  deferredLeads,
  results,
  strongGalleryLinks: [...uniqueStrongLinks.values()],
  weakMarketingLinks: [...uniqueWeakLinks.values()],
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  activeLeadCount: results.length,
  deferredLeadCount: deferredLeads.length,
  uniqueStrongGalleryLinkCount: uniqueStrongLinks.size,
  uniqueWeakMarketingLinkCount: uniqueWeakLinks.size,
  bySource: Object.fromEntries(results.map((result) => [result.sourceId, {
    strongGalleryLinks: result.strongGalleryLinkCount,
    weakMarketingLinks: result.weakMarketingLinkCount,
    exampleMarkers: result.exampleMarkerCount,
  }])),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
