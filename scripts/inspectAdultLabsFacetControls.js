import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'adultlabs-facet-control-diagnostic.json');
const BASE_URL = 'https://adultlabs.com/content';
const USER_AGENT = 'ArtesModerationResearch/1.0';
const TARGETS = ['Hardcore', 'Girls Solo', 'Lesbo', 'Boys Solo', 'Boys Hardcore'];
const ALLOWED_HOSTS = new Set(['adultlabs.com', 'www.adultlabs.com']);

const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 240);
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');

const assertPublicAdultLabsUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('adultlabs_control_url_not_allowed');
  }
  return url;
};

const fetchText = async (rawUrl, accept) => {
  const requested = assertPublicAdultLabsUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: accept, 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`adultlabs_control_http_${response.status}`);
  const finalUrl = assertPublicAdultLabsUrl(response.url);
  return { text: await response.text(), finalUrl };
};

const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const extractContext = (html, label) => {
  const lower = html.toLowerCase();
  const needle = label.toLowerCase();
  const contexts = [];
  let cursor = 0;
  while (contexts.length < 8) {
    const index = lower.indexOf(needle, cursor);
    if (index < 0) break;
    const start = Math.max(0, index - 1400);
    const end = Math.min(html.length, index + needle.length + 1400);
    const raw = html.slice(start, end);
    contexts.push({
      rawHtml: raw,
      flattened: normalizeWhitespace(decodeHtml(raw)).slice(0, 4000),
    });
    cursor = index + needle.length;
  }
  return contexts;
};

const collectControls = (html) => {
  const controls = [];
  const tagPattern = /<(button|input|label|option|select)\b[^>]*>[\s\S]*?<\/\1>|<(input)\b[^>]*\/?>/gi;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    const raw = match[0];
    const text = normalizeWhitespace(decodeHtml(raw.replace(/<[^>]+>/g, ' ')));
    const evidence = `${raw} ${text}`;
    if (!TARGETS.some((label) => evidence.toLowerCase().includes(label.toLowerCase()))) continue;
    controls.push({
      tag: (match[1] || match[2] || '').toLowerCase(),
      text: text || null,
      rawHtml: raw.slice(0, 3000),
    });
  }
  return controls;
};

const collectForms = (html) => {
  const forms = [];
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let match;
  while ((match = formPattern.exec(html)) !== null) {
    const raw = match[0];
    if (!TARGETS.some((label) => raw.toLowerCase().includes(label.toLowerCase()))) continue;
    forms.push({
      attributes: normalizeWhitespace(match[1]),
      rawHtml: raw.slice(0, 12000),
    });
  }
  return forms;
};

const collectInlineScripts = (html) => {
  const results = [];
  const scriptPattern = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptPattern.exec(html)) !== null) {
    const body = match[1];
    if (!TARGETS.some((label) => body.toLowerCase().includes(label.toLowerCase())) && !/(ajax|fetch\s*\(|XMLHttpRequest|Product_page|n\[\]|category|filter)/i.test(body)) continue;
    results.push(normalizeWhitespace(body).slice(0, 12000));
  }
  return results.slice(0, 20);
};

const collectScriptUrls = (html, pageUrl) => {
  const urls = [];
  const pattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    let url;
    try { url = new URL(decodeHtml(match[1]), pageUrl); } catch { continue; }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) continue;
    if (!urls.includes(url.toString())) urls.push(url.toString());
  }
  return urls.slice(0, 20);
};

const searchScript = (text) => {
  const hits = [];
  const patterns = [
    /.{0,500}Boys Hardcore.{0,1000}/gi,
    /.{0,500}Boys Solo.{0,1000}/gi,
    /.{0,500}Girls Solo.{0,1000}/gi,
    /.{0,500}Lesbo.{0,1000}/gi,
    /.{0,500}(?:ajax|fetch\s*\(|XMLHttpRequest).{0,1200}/gi,
    /.{0,500}(?:Product_page|n\[\]|category|filter).{0,1200}/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null && hits.length < 30) {
      hits.push(normalizeWhitespace(match[0]).slice(0, 2200));
    }
  }
  return [...new Set(hits)];
};

const { text: html, finalUrl } = await fetchText(BASE_URL, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
const scriptUrls = collectScriptUrls(html, finalUrl);
const externalScripts = [];
for (const scriptUrl of scriptUrls) {
  try {
    const { text, finalUrl: scriptFinal } = await fetchText(scriptUrl, 'text/javascript,application/javascript,*/*;q=0.5');
    const hits = searchScript(text);
    if (hits.length > 0) externalScripts.push({ url: scriptFinal.toString(), byteLength: Buffer.byteLength(text, 'utf8'), hits });
  } catch (error) {
    externalScripts.push({ url: scriptUrl, byteLength: 0, hits: [], error: safeError(error) });
  }
}

const targetContexts = Object.fromEntries(TARGETS.map((label) => [label, extractContext(html, label)]));
const controls = collectControls(html);
const forms = collectForms(html);
const inlineScripts = collectInlineScripts(html);

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_adultlabs_public_facet_control_diagnostic_only',
  baseUrl: finalUrl.toString(),
  targets: TARGETS,
  controlCount: controls.length,
  formCount: forms.length,
  inlineScriptCount: inlineScripts.length,
  externalScriptCount: externalScripts.length,
  targetContexts,
  controls,
  forms,
  inlineScripts,
  externalScripts,
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  sourceIntentIsLabelAuthority: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  controlCount: controls.length,
  formCount: forms.length,
  inlineScriptCount: inlineScripts.length,
  externalScriptCount: externalScripts.length,
  byTargetContextCount: Object.fromEntries(TARGETS.map((label) => [label, targetContexts[label].length])),
  externalScriptsWithHits: externalScripts.filter((item) => item.hits?.length > 0).map((item) => ({ url: item.url, hitCount: item.hits.length })),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
