import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'adultlabs-facet-client-state.json');
const BASE_URL = 'https://adultlabs.com/content';
const USER_AGENT = 'ArtesModerationResearch/1.0';
const ALLOWED_HOSTS = new Set(['adultlabs.com', 'www.adultlabs.com']);
const TARGETS = ['Hardcore', 'Girls Solo', 'Lesbo', 'Boys Solo', 'Boys Hardcore'];
const SCRIPT_PATHS = new Set([
  '/themes/adultlabs/js/content.js',
  '/themes/adultlabs/js/adultlabs.js',
]);

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
    throw new Error('adultlabs_client_state_url_not_allowed');
  }
  return url;
};

const fetchText = async (rawUrl, accept) => {
  const requested = assertPublicAdultLabsUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: accept, 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`adultlabs_client_state_http_${response.status}`);
  const finalUrl = assertPublicAdultLabsUrl(response.url);
  return { text: await response.text(), finalUrl };
};

const parseAttributes = (tag) => {
  const attributes = {};
  const pattern = /\b([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/g;
  let match;
  while ((match = pattern.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? '');
  }
  return attributes;
};

const collectTargetControls = (html) => {
  const results = [];
  const pattern = /<(button|label|option|a)\b[^>]*>[\s\S]*?<\/\1>|<input\b[^>]*\/?>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const raw = match[0];
    const openTag = raw.match(/^<[^>]+>/)?.[0] || raw;
    const attributes = parseAttributes(openTag);
    const values = [stripTags(raw), attributes.value, attributes['aria-label'], attributes.title].map(clean);
    const label = TARGETS.find((candidate) => values.some((value) => value.toLowerCase() === candidate.toLowerCase()));
    if (!label) continue;
    const classes = clean(attributes.class).split(/\s+/).filter(Boolean);
    results.push({
      label,
      tag: (match[1] || 'input').toLowerCase(),
      id: clean(attributes.id) || null,
      classes,
      attributes,
      rawHtml: raw.slice(0, 1800),
    });
  }
  return results;
};

const collectScriptUrls = (html, pageUrl) => {
  const urls = [];
  const pattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const url = new URL(decodeHtml(match[1]), pageUrl);
      if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) continue;
      if (SCRIPT_PATHS.has(url.pathname) && !urls.includes(url.toString())) urls.push(url.toString());
    } catch {
      // Ignore malformed public script references.
    }
  }
  return urls;
};

const collectInlineScripts = (html) => {
  const results = [];
  const pattern = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const body = match[1];
    if (/(t_(?:h|g|l|b|bh)\b|\.self\b|this\.id|attr\s*\(\s*["']id|\.bbq|pushState|getState|yiiListView|Product_page)/i.test(body)) {
      results.push(body);
    }
  }
  return results;
};

const windowsAround = (text, needle, radius = 1400, maxHits = 8) => {
  const source = String(text || '');
  const lower = source.toLowerCase();
  const target = String(needle || '').toLowerCase();
  if (!target) return [];
  const results = [];
  let cursor = 0;
  while (results.length < maxHits) {
    const index = lower.indexOf(target, cursor);
    if (index < 0) break;
    const snippet = normalizeWhitespace(source.slice(Math.max(0, index - radius), Math.min(source.length, index + target.length + radius)));
    if (snippet && !results.includes(snippet)) results.push(snippet.slice(0, radius * 2 + 800));
    cursor = index + target.length;
  }
  return results;
};

const hasRuntimeHandlerSignal = (snippet) => /(\.click\s*\(|\.on\s*\(|\.bind\s*\(|\.live\s*\(|addEventListener|this\.id|attr\s*\(\s*["']id|event\.target\.id|e\.target\.id)/i.test(snippet);
const hasStateSignal = (snippet) => /(\$\.bbq|bbq\.|pushState|getState|removeState|hashchange|location\.hash|yiiListView|Product_page|\.update\s*\(|ajax\s*\()/i.test(snippet);

const extractQueryKeys = (snippet) => {
  const keys = new Set();
  for (const match of snippet.matchAll(/[?&]([A-Za-z_][A-Za-z0-9_\[\]-]{0,50})=/g)) keys.add(match[1]);
  for (const match of snippet.matchAll(/(?:getState|removeState)\s*\(\s*["']([^"']+)["']/g)) keys.add(match[1]);
  for (const match of snippet.matchAll(/pushState\s*\(\s*\{([\s\S]{0,1000}?)\}\s*[,)]/g)) {
    for (const keyMatch of match[1].matchAll(/(?:^|[,\s])([A-Za-z_][A-Za-z0-9_\[\]-]{0,50})\s*:/g)) keys.add(keyMatch[1]);
  }
  return [...keys].sort();
};

const extractStringLiterals = (snippet) => {
  const values = new Set();
  for (const match of snippet.matchAll(/["']([^"'\n]{1,80})["']/g)) {
    const value = clean(match[1]);
    if (/^(?:#?t_(?:h|g|l|b|bh)|\.?self|[A-Za-z_][A-Za-z0-9_\[\]-]{1,50}|\/content[^\s]*)$/i.test(value)) values.add(value);
  }
  return [...values].slice(0, 40);
};

const buildEvidence = (sourceName, text, controls) => {
  const exactIdEvidence = [];
  for (const control of controls) {
    if (!control.id) continue;
    const selectors = [`#${control.id}`, control.id];
    const snippets = [];
    for (const selector of selectors) {
      for (const snippet of windowsAround(text, selector)) {
        if (!snippets.includes(snippet)) snippets.push(snippet);
      }
    }
    if (snippets.length > 0) {
      exactIdEvidence.push({
        label: control.label,
        id: control.id,
        snippets: snippets.slice(0, 6).map((snippet) => ({
          handlerSignal: hasRuntimeHandlerSignal(snippet),
          stateSignal: hasStateSignal(snippet),
          queryKeys: extractQueryKeys(snippet),
          stringLiterals: extractStringLiterals(snippet),
          snippet,
        })),
      });
    }
  }

  const sharedClasses = [...new Set(controls.flatMap((control) => control.classes))]
    .filter((value) => value && !/^btn(?:-|$)/i.test(value));
  const classEvidence = [];
  for (const className of sharedClasses) {
    const snippets = windowsAround(text, `.${className}`);
    const useful = snippets.filter((snippet) => hasRuntimeHandlerSignal(snippet) || hasStateSignal(snippet));
    if (useful.length > 0) {
      classEvidence.push({
        className,
        snippets: useful.slice(0, 6).map((snippet) => ({
          handlerSignal: hasRuntimeHandlerSignal(snippet),
          stateSignal: hasStateSignal(snippet),
          queryKeys: extractQueryKeys(snippet),
          stringLiterals: extractStringLiterals(snippet),
          snippet,
        })),
      });
    }
  }

  const genericNeedles = ['this.id', '.attr("id")', ".attr('id')", '$.bbq', 'pushState', 'getState', 'yiiListView', 'Product_page'];
  const genericEvidence = [];
  for (const needle of genericNeedles) {
    const snippets = windowsAround(text, needle, 1200, 6);
    for (const snippet of snippets) {
      if (!genericEvidence.some((item) => item.snippet === snippet)) {
        genericEvidence.push({
          needle,
          handlerSignal: hasRuntimeHandlerSignal(snippet),
          stateSignal: hasStateSignal(snippet),
          queryKeys: extractQueryKeys(snippet),
          stringLiterals: extractStringLiterals(snippet),
          snippet,
        });
      }
    }
  }

  return { sourceName, exactIdEvidence, classEvidence, genericEvidence: genericEvidence.slice(0, 20) };
};

const { text: html, finalUrl } = await fetchText(BASE_URL, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
const controls = collectTargetControls(html);
const scriptUrls = collectScriptUrls(html, finalUrl);
const sources = [];

for (const scriptUrl of scriptUrls) {
  try {
    const { text, finalUrl: scriptFinal } = await fetchText(scriptUrl, 'text/javascript,application/javascript,*/*;q=0.5');
    sources.push({ name: scriptFinal.toString(), text });
  } catch (error) {
    sources.push({ name: scriptUrl, text: '', error: safeError(error) });
  }
}

for (const [index, text] of collectInlineScripts(html).entries()) {
  sources.push({ name: `inline-script-${index + 1}`, text });
}

const evidence = sources.map((source) => source.error
  ? { sourceName: source.name, exactIdEvidence: [], classEvidence: [], genericEvidence: [], error: source.error }
  : buildEvidence(source.name, source.text, controls));

const conciseBindings = Object.fromEntries(TARGETS.map((label) => {
  const ids = [...new Set(controls.filter((control) => control.label === label).map((control) => control.id).filter(Boolean))];
  const matches = evidence.flatMap((source) => source.exactIdEvidence
    .filter((item) => item.label === label)
    .map((item) => ({
      source: source.sourceName,
      id: item.id,
      hitCount: item.snippets.length,
      handlerSignal: item.snippets.some((snippet) => snippet.handlerSignal),
      stateSignal: item.snippets.some((snippet) => snippet.stateSignal),
      queryKeys: [...new Set(item.snippets.flatMap((snippet) => snippet.queryKeys))],
      snippets: item.snippets.map((snippet) => snippet.snippet),
    })));
  return [label, { ids, matches }];
}));

const classBindings = evidence.flatMap((source) => source.classEvidence.map((item) => ({
  source: source.sourceName,
  className: item.className,
  hitCount: item.snippets.length,
  handlerSignal: item.snippets.some((snippet) => snippet.handlerSignal),
  stateSignal: item.snippets.some((snippet) => snippet.stateSignal),
  queryKeys: [...new Set(item.snippets.flatMap((snippet) => snippet.queryKeys))],
  snippets: item.snippets.map((snippet) => snippet.snippet),
})));

const genericRouteEvidence = evidence.flatMap((source) => source.genericEvidence.map((item) => ({
  source: source.sourceName,
  needle: item.needle,
  handlerSignal: item.handlerSignal,
  stateSignal: item.stateSignal,
  queryKeys: item.queryKeys,
  stringLiterals: item.stringLiterals,
  snippet: item.snippet,
})));

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_adultlabs_public_facet_client_state_resolution_only',
  baseUrl: finalUrl.toString(),
  controls,
  scriptUrls,
  conciseBindings,
  classBindings,
  genericRouteEvidence,
  evidence,
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
  controls: Object.fromEntries(TARGETS.map((label) => [label, controls.filter((control) => control.label === label).map((control) => ({ id: control.id, classes: control.classes, attributes: control.attributes }))])),
  conciseBindings,
  classBindings,
  genericRouteEvidence,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
