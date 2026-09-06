import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'adultlabs-facet-runtime-route.json');
const BASE_URL = 'https://adultlabs.com/content';
const USER_AGENT = 'ArtesModerationResearch/1.0';
const TARGETS = ['Hardcore', 'Girls Solo', 'Lesbo', 'Boys Solo', 'Boys Hardcore'];
const ALLOWED_HOSTS = new Set(['adultlabs.com', 'www.adultlabs.com']);
const PRIORITY_SCRIPT_PATHS = [
  '/themes/adultlabs/js/content.js',
  '/themes/adultlabs/js/adultlabs.js',
  '/assets/8b51e0cf/jquery.ba-bbq.js',
  '/assets/6c630656/listview/jquery.yiilistview.js',
];
const GENERIC_TOKENS = new Set(['button', 'btn', 'active', 'default', 'content', 'filter', 'filters', 'all']);

const clean = (value) => String(value || '').trim();
const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');
const stripTags = (value) => normalizeWhitespace(decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ')));
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 240);

const assertPublicAdultLabsUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('adultlabs_runtime_route_url_not_allowed');
  }
  return url;
};

const fetchText = async (rawUrl, accept) => {
  const requested = assertPublicAdultLabsUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: accept, 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`adultlabs_runtime_route_http_${response.status}`);
  const finalUrl = assertPublicAdultLabsUrl(response.url);
  return { text: await response.text(), finalUrl };
};

const parseAttributes = (tag) => {
  const attributes = {};
  const attrPattern = /\b([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/g;
  let match;
  while ((match = attrPattern.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? '');
  }
  return attributes;
};

const exactTargetForControl = (raw, attributes) => {
  const text = stripTags(raw);
  return TARGETS.find((label) => {
    const values = [text, attributes.value, attributes['aria-label'], attributes.title].map(clean);
    return values.some((value) => value.toLowerCase() === label.toLowerCase());
  }) || null;
};

const controlTokens = (attributes) => {
  const tokens = new Set();
  for (const [key, value] of Object.entries(attributes)) {
    if (['id', 'name', 'value', 'onclick'].includes(key) || key.startsWith('data-')) {
      if (clean(value).length >= 2) tokens.add(clean(value));
      tokens.add(key);
    }
    if (key === 'class') {
      for (const token of clean(value).split(/\s+/)) {
        if (token.length >= 3 && !GENERIC_TOKENS.has(token.toLowerCase())) tokens.add(token);
      }
    }
  }
  return [...tokens].filter((token) => token.length >= 2).slice(0, 30);
};

const collectTargetControls = (html) => {
  const byTarget = Object.fromEntries(TARGETS.map((label) => [label, []]));
  const pattern = /<(button|label|option|a)\b[^>]*>[\s\S]*?<\/\1>|<input\b[^>]*\/?>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const raw = match[0];
    const openTag = raw.match(/^<[^>]+>/)?.[0] || raw;
    const attributes = parseAttributes(openTag);
    const target = exactTargetForControl(raw, attributes);
    if (!target) continue;
    byTarget[target].push({
      tag: (match[1] || 'input').toLowerCase(),
      text: stripTags(raw) || null,
      attributes,
      tokens: controlTokens(attributes),
      rawHtml: raw.slice(0, 3000),
    });
  }
  return byTarget;
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
  return urls;
};

const windowsAround = (text, needle, radius = 900, maxHits = 8) => {
  const lower = text.toLowerCase();
  const target = String(needle).toLowerCase();
  if (!target) return [];
  const hits = [];
  let cursor = 0;
  while (hits.length < maxHits) {
    const index = lower.indexOf(target, cursor);
    if (index < 0) break;
    hits.push(normalizeWhitespace(text.slice(Math.max(0, index - radius), Math.min(text.length, index + target.length + radius))).slice(0, radius * 2 + 600));
    cursor = index + target.length;
  }
  return [...new Set(hits)];
};

const collectGenericStateHits = (text) => {
  const signatures = [
    '$.bbq', 'bbq.', 'pushState', 'getState', 'hashchange', 'location.hash',
    'yiiListView', 'Product_page', '.update(', 'ajax', 'serialize', 'data-',
  ];
  const results = [];
  for (const signature of signatures) {
    for (const snippet of windowsAround(text, signature, 1000, 10)) {
      results.push({ signature, snippet });
    }
  }
  const seen = new Set();
  return results.filter((item) => {
    const key = `${item.signature}::${item.snippet}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
};

const collectCandidateStateKeys = (snippets) => {
  const keys = new Set();
  for (const snippet of snippets) {
    for (const match of snippet.matchAll(/[?&]([A-Za-z_][A-Za-z0-9_\[\]-]{0,50})=/g)) keys.add(match[1]);
    for (const match of snippet.matchAll(/(?:getState|removeState)\s*\(\s*["']([^"']+)["']/g)) keys.add(match[1]);
    for (const match of snippet.matchAll(/pushState\s*\(\s*\{([\s\S]{0,1200}?)\}\s*[,)]/g)) {
      for (const keyMatch of match[1].matchAll(/(?:^|[,\s])([A-Za-z_][A-Za-z0-9_\[\]-]{0,50})\s*:/g)) keys.add(keyMatch[1]);
    }
    for (const match of snippet.matchAll(/\b(?:name|data-[A-Za-z0-9_-]+)\s*[=:]\s*["']([A-Za-z_][A-Za-z0-9_\[\]-]{1,50})["']/g)) keys.add(match[1]);
  }
  return [...keys].sort();
};

const { text: html, finalUrl } = await fetchText(BASE_URL, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
const controlsByTarget = collectTargetControls(html);
const allControlTokens = [...new Set(Object.values(controlsByTarget).flatMap((controls) => controls.flatMap((control) => control.tokens)))];
const scriptUrls = collectScriptUrls(html, finalUrl);
const priorityUrls = PRIORITY_SCRIPT_PATHS
  .map((pathname) => scriptUrls.find((rawUrl) => new URL(rawUrl).pathname === pathname))
  .filter(Boolean);

const scripts = [];
for (const scriptUrl of priorityUrls) {
  try {
    const { text, finalUrl: scriptFinal } = await fetchText(scriptUrl, 'text/javascript,application/javascript,*/*;q=0.5');
    const tokenHits = [];
    for (const token of allControlTokens) {
      const hits = windowsAround(text, token, 900, 6);
      if (hits.length > 0) tokenHits.push({ token, hits });
    }
    const stateHits = collectGenericStateHits(text);
    scripts.push({
      url: scriptFinal.toString(),
      byteLength: Buffer.byteLength(text, 'utf8'),
      tokenHits,
      stateHits,
      candidateStateKeys: collectCandidateStateKeys([
        ...tokenHits.flatMap((item) => item.hits),
        ...stateHits.map((item) => item.snippet),
      ]),
    });
  } catch (error) {
    scripts.push({ url: scriptUrl, byteLength: 0, tokenHits: [], stateHits: [], candidateStateKeys: [], error: safeError(error) });
  }
}

const targetEvidence = Object.fromEntries(TARGETS.map((label) => {
  const controls = controlsByTarget[label] || [];
  const tokens = [...new Set(controls.flatMap((control) => control.tokens))];
  const scriptMatches = scripts.map((script) => ({
    url: script.url,
    tokenHits: script.tokenHits.filter((item) => tokens.includes(item.token)),
    relevantStateHits: script.stateHits.filter((item) => /bbq|pushState|getState|hashchange|yiiListView|Product_page|\.update\(|ajax|serialize/i.test(item.signature)),
    candidateStateKeys: script.candidateStateKeys,
  })).filter((script) => script.tokenHits.length > 0 || script.relevantStateHits.length > 0);
  return [label, { controls, tokens, scriptMatches }];
}));

const routeSignals = {
  jqueryBbqLoaded: scriptUrls.some((url) => /jquery\.ba-bbq\.js(?:$|\?)/i.test(url)),
  yiiListViewLoaded: scriptUrls.some((url) => /jquery\.yiilistview\.js(?:$|\?)/i.test(url)),
  contentJsLoaded: scriptUrls.some((url) => /\/themes\/adultlabs\/js\/content\.js(?:$|\?)/i.test(url)),
  hasBbqStateEvidence: scripts.some((script) => script.stateHits.some((item) => /\$\.bbq|bbq\.|pushState|getState|hashchange/i.test(item.signature))),
  hasYiiUpdateEvidence: scripts.some((script) => script.stateHits.some((item) => /yiiListView|\.update\(|Product_page/i.test(item.signature))),
};

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_adultlabs_public_facet_runtime_route_only',
  baseUrl: finalUrl.toString(),
  targets: TARGETS,
  controlsByTarget,
  scriptUrls,
  priorityScriptUrls: priorityUrls,
  routeSignals,
  targetEvidence,
  scripts,
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
  controlCounts: Object.fromEntries(TARGETS.map((label) => [label, controlsByTarget[label]?.length || 0])),
  controlTokens: Object.fromEntries(TARGETS.map((label) => [label, [...new Set((controlsByTarget[label] || []).flatMap((control) => control.tokens))]])),
  priorityScriptUrls: priorityUrls,
  routeSignals,
  byScript: scripts.map((script) => ({
    url: script.url,
    byteLength: script.byteLength,
    tokenHitCount: script.tokenHits.length,
    stateHitCount: script.stateHits.length,
    candidateStateKeys: script.candidateStateKeys,
    error: script.error || null,
  })),
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
