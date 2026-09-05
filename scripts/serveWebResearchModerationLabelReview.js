import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeArtesDetectorLabel, validateArtesDetectorLabel } from '../functions/moderationLearningDataset.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.ARTES_WEB_RESEARCH_REVIEW_PORT || 8793);
const DATASET_SUBDIR = 'web-research-v1';
const IMAGE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-images', DATASET_SUBDIR);
const TEST_SET_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', DATASET_SUBDIR);
const INTAKE_PATH = path.join(TEST_SET_DIR, 'intake.json');
const SOURCES_PATH = path.join(IMAGE_DIR, 'sources.json');
const OUTPUT_PATH = path.join(TEST_SET_DIR, 'labels.reviewed.json');
const PREFILL_PATH = path.join(REPO_ROOT, 'docs', 'moderation-web-research-assistant-prefill-v1.json');

const ALLOWED_NUDITY = ['none', 'underwear_swimwear', 'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia', 'male_topless'];
const ALLOWED_SEXUAL_CONTEXT = ['none', 'suggestive', 'bdsm_kink', 'explicit_act'];
const ALLOWED_GRAPHIC_INJURY = ['none', 'mild', 'graphic'];
const SENSITIVE_SIGNALS = ['bloodInjury', 'selfHarm', 'suicide', 'eatingDisorder', 'substanceDistress', 'violence', 'horrorScare'];
const AGE_SAFETY_DECISIONS = ['adult_clear', 'skip_minor_or_age_uncertain'];
const MIME_BY_EXT = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const optionHtml = (values, selected) => ['<option value="">Kies…</option>', ...values.map((value) => (
  `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`
))].join('');

const readOptionalJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
};

const validateResearchInputs = (intake, sources) => {
  if (intake?.researchOnly !== true || intake?.trainingReady !== false || intake?.productionEligible !== false) {
    throw new Error('invalid_web_research_intake_contract');
  }
  if (sources?.researchOnly !== true || sources?.trainingReady !== false || sources?.productionEligible !== false) {
    throw new Error('invalid_web_research_sources_contract');
  }
  if (!Array.isArray(intake?.items) || intake.items.length === 0) throw new Error('web_research_intake_empty');
  if (!Array.isArray(sources?.records) || sources.records.length === 0) throw new Error('web_research_sources_empty');
};

const validateAssistantPrefill = (prefill) => {
  if (!prefill || typeof prefill !== 'object') throw new Error('invalid_web_research_assistant_prefill');
  if (prefill.datasetSubdir !== DATASET_SUBDIR) throw new Error('assistant_prefill_dataset_mismatch');
  if (prefill.suggestionSource !== 'assistant_visual_review') throw new Error('invalid_assistant_prefill_source');
  if (prefill.authoritative !== false || prefill.humanConfirmationRequired !== true) {
    throw new Error('assistant_prefill_must_be_non_authoritative');
  }
  if (prefill.discoveryMetadataUsedAsLabelAuthority !== false) {
    throw new Error('assistant_prefill_discovery_metadata_must_not_be_authority');
  }
  if (!Array.isArray(prefill.items)) throw new Error('invalid_assistant_prefill_items');

  const seen = new Set();
  for (const suggestion of prefill.items) {
    const sourceUrl = String(suggestion?.sourceUrl || '').trim();
    if (!sourceUrl || seen.has(sourceUrl)) throw new Error('duplicate_or_missing_assistant_prefill_source');
    seen.add(sourceUrl);
    if (!AGE_SAFETY_DECISIONS.includes(suggestion?.ageSafetyDecision)) {
      throw new Error(`invalid_assistant_prefill_age_decision:${sourceUrl}`);
    }
    if (suggestion.ageSafetyDecision === 'adult_clear') {
      const validation = validateArtesDetectorLabel(suggestion.detectorLabel);
      if (!validation.valid) throw new Error(`invalid_assistant_prefill_label:${sourceUrl}:${validation.errors.join(',')}`);
      if (suggestion.detectorLabel.possibleMinorConcern !== false) {
        throw new Error(`assistant_prefill_possible_minor_must_be_skipped:${sourceUrl}`);
      }
    } else if (suggestion.detectorLabel !== null) {
      throw new Error(`assistant_prefill_age_exclusion_must_not_have_label:${sourceUrl}`);
    }
  }
};

const loadState = async () => {
  const [intake, sources, prefill] = await Promise.all([
    readFile(INTAKE_PATH, 'utf8').then(JSON.parse),
    readFile(SOURCES_PATH, 'utf8').then(JSON.parse),
    readOptionalJson(PREFILL_PATH, {
      datasetSubdir: DATASET_SUBDIR,
      suggestionSource: 'assistant_visual_review',
      authoritative: false,
      humanConfirmationRequired: true,
      discoveryMetadataUsedAsLabelAuthority: false,
      prefillVersion: null,
      items: [],
    }),
  ]);
  validateResearchInputs(intake, sources);
  validateAssistantPrefill(prefill);

  const reviewed = await readOptionalJson(OUTPUT_PATH, { items: [] });
  const sourceByFile = new Map(sources.records.map((record) => [record.fileName, record]));
  const reviewedByFile = new Map((reviewed.items || []).map((item) => [item.fileName, item]));
  const suggestionBySourceUrl = new Map(prefill.items.map((item) => [item.sourceUrl, item]));
  const knownSourceUrls = new Set(sources.records.map((record) => record.sourceUrl));
  for (const sourceUrl of suggestionBySourceUrl.keys()) {
    if (!knownSourceUrls.has(sourceUrl)) throw new Error(`assistant_prefill_unknown_source:${sourceUrl}`);
  }

  return intake.items.map((item) => {
    const fileName = String(item?.fileName || '').trim();
    if (!fileName || path.basename(fileName) !== fileName) throw new Error('invalid_web_research_filename');
    const source = sourceByFile.get(fileName);
    if (!source) throw new Error(`missing_web_research_source:${fileName}`);
    if (source.sha256 !== item.sha256) throw new Error(`web_research_source_sha_mismatch:${fileName}`);
    if (!source.sourcePoolId || source.sourcePoolId !== item.sourcePoolId) throw new Error(`web_research_source_pool_mismatch:${fileName}`);
    if (source.humanAgeSafetyReviewRequired !== true) throw new Error(`web_research_age_review_not_required:${fileName}`);
    return {
      fileName,
      sha256: item.sha256,
      sourcePoolId: item.sourcePoolId,
      source,
      reviewed: reviewedByFile.get(fileName) || null,
      assistantSuggestion: suggestionBySourceUrl.get(source.sourceUrl) || null,
      assistantPrefillVersion: prefill.prefillVersion || null,
    };
  });
};

const isHumanReviewed = (item) => item.reviewed?.labelStatus === 'human_confirmed'
  || item.reviewed?.labelStatus === 'excluded_age_safety';

const renderPage = async () => {
  const items = await loadState();
  const reviewedCount = items.filter(isHumanReviewed).length;
  const includedCount = items.filter((item) => item.reviewed?.labelStatus === 'human_confirmed').length;
  const excludedCount = items.filter((item) => item.reviewed?.labelStatus === 'excluded_age_safety').length;
  const prefilledCount = items.filter((item) => item.assistantSuggestion).length;
  const acceptedAsIsCount = items.filter((item) => item.reviewed?.assistantSuggestionAcceptedAsIs === true).length;
  const correctedCount = items.filter((item) => item.reviewed?.assistantSuggestionPresent === true && item.reviewed?.assistantSuggestionAcceptedAsIs === false).length;

  const cards = items.map((item, index) => {
    const suggestion = item.assistantSuggestion;
    const base = item.reviewed?.detectorLabel || suggestion?.detectorLabel || {
      nudity: null,
      sexualContext: null,
      graphicInjury: 'none',
      sensitiveSignals: [],
      possibleMinorConcern: false,
      confidence: null,
      uncertaintyFlags: [],
    };
    const ageDecision = item.reviewed?.ageSafetyDecision || suggestion?.ageSafetyDecision || '';
    const confirmed = item.reviewed?.labelStatus === 'human_confirmed';
    const excluded = item.reviewed?.labelStatus === 'excluded_age_safety';
    const suggested = Boolean(suggestion);
    const signalChecks = SENSITIVE_SIGNALS.map((signal) => (
      `<label><input type="checkbox" name="sensitiveSignals" value="${signal}" ${(base.sensitiveSignals || []).includes(signal) ? 'checked' : ''}> ${signal}</label>`
    )).join(' ');
    const statusText = excluded
      ? '↷ overgeslagen wegens leeftijdsveiligheid'
      : confirmed
        ? '✓ menselijk bevestigd'
        : suggested
          ? 'Vooringevuld door assistent · nog bevestigen'
          : 'Nog geen assistentvoorstel';
    const buttonText = excluded
      ? 'Overslaan opnieuw opslaan'
      : confirmed
        ? 'Label opnieuw bevestigen'
        : suggested
          ? 'Bevestig of corrigeer'
          : 'Review opslaan';

    return `
      <article class="card${excluded ? ' excluded' : ''}${suggested && !isHumanReviewed(item) ? ' suggested' : ''}" data-file="${escapeHtml(item.fileName)}">
        <img src="/image/${encodeURIComponent(item.fileName)}" alt="Researchbeeld ${index + 1}">
        <div class="body">
          <h2>${index + 1}. ${escapeHtml(item.fileName)}</h2>
          <p><strong>Source pool:</strong> ${escapeHtml(item.sourcePoolId)}</p>
          <p><strong>Maker:</strong> ${escapeHtml(item.source.creator || 'onbekend')}</p>
          ${suggested && !isHumanReviewed(item) ? '<p class="assistant-note"><strong>Assistentvoorstel:</strong> velden hieronder zijn al ingevuld. Corrigeer alleen wat niet klopt en bevestig daarna.</p>' : ''}
          <p class="hint">Bij een vermoedelijke minderjarige of echte leeftijdstwijfel: kies skip_minor_or_age_uncertain. Jouw bevestiging is het authoritative label.</p>

          <label>Age safety decision
            <select name="ageSafetyDecision" onchange="syncAgeDecision(this)">${optionHtml(AGE_SAFETY_DECISIONS, ageDecision)}</select>
          </label>

          <div class="detector-fields">
            <label>Nudity <select name="nudity">${optionHtml(ALLOWED_NUDITY, base.nudity)}</select></label>
            <label>Sexual context <select name="sexualContext">${optionHtml(ALLOWED_SEXUAL_CONTEXT, base.sexualContext)}</select></label>
            <label>Graphic injury <select name="graphicInjury">${optionHtml(ALLOWED_GRAPHIC_INJURY, base.graphicInjury)}</select></label>
            <fieldset><legend>Sensitive signals</legend>${signalChecks}</fieldset>
            <label>Possible minor concern
              <select name="possibleMinorConcern">
                <option value="">Kies…</option>
                <option value="false"${base.possibleMinorConcern === false ? ' selected' : ''}>false</option>
                <option value="true"${base.possibleMinorConcern === true ? ' selected' : ''}>true</option>
              </select>
            </label>
            <label>Confidence <input name="confidence" type="number" min="0" max="1" step="0.01" value="${escapeHtml(base.confidence ?? '')}" placeholder="bijv. 0.99"></label>
            <label>Uncertainty flags <input name="uncertaintyFlags" value="${escapeHtml((base.uncertaintyFlags || []).join(', '))}" placeholder="optioneel, komma-gescheiden"></label>
          </div>

          <button type="button" onclick="saveCard(this)">${buttonText}</button>
          <span class="status">${statusText}</span>
        </div>
      </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Artes web research label review</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f4f4f4;color:#171717}.wrap{max-width:1180px;margin:auto;padding:24px}.summary{position:sticky;top:0;z-index:5;background:#fff;padding:12px 16px;border:1px solid #ddd;border-radius:10px}.card{display:grid;grid-template-columns:minmax(300px,48%) 1fr;background:white;margin:20px 0;border-radius:12px;overflow:hidden;box-shadow:0 1px 8px #0002}.card.suggested{outline:2px solid #ddd}.card.excluded{opacity:.72}.card img{width:100%;height:100%;max-height:760px;object-fit:contain;background:#111}.body{padding:20px}.body label{display:block;margin:12px 0}.body select,.body input{width:100%;padding:8px;margin-top:4px}.body fieldset label{display:inline-block;margin:4px 12px 4px 0}.body fieldset input{width:auto}.hint{font-size:.92rem;opacity:.72}.assistant-note{padding:10px 12px;background:#f3f3f3;border-radius:8px}.status{display:inline-block;margin-left:12px}.detector-fields.disabled{opacity:.45;pointer-events:none}button{padding:10px 16px;cursor:pointer}@media(max-width:780px){.card{grid-template-columns:1fr}.card img{max-height:600px}}
</style></head><body><div class="wrap">
<h1>Artes web research detectorlabels</h1>
<div class="summary"><strong>${reviewedCount}/${items.length} menselijk beoordeeld</strong> · ${prefilledCount} vooringevuld · ${includedCount} gelabeld · ${excludedCount} leeftijdsveiligheid uitgesloten · ${acceptedAsIsCount} assistentvoorstellen ongewijzigd bevestigd · ${correctedCount} aangepast. Research only.</div>
<p>Waar een assistentvoorstel beschikbaar is, zijn de velden al ingevuld op basis van visuele beoordeling. Discovery metadata wordt niet getoond en is geen labelbron. Corrigeer alleen wat niet klopt en bevestig daarna.</p>
${cards}
</div>
<script>
function syncAgeDecision(select){
  const card=select.closest('.card');
  const fields=card.querySelector('.detector-fields');
  fields.classList.toggle('disabled',select.value==='skip_minor_or_age_uncertain');
}
for(const select of document.querySelectorAll('[name="ageSafetyDecision"]')) syncAgeDecision(select);
async function saveCard(button){
  const card=button.closest('.card');
  const pick=(name)=>card.querySelector('[name="'+name+'"]');
  const ageSafetyDecision=pick('ageSafetyDecision').value;
  const confidenceRaw=pick('confidence').value.trim();
  const detectorLabel=ageSafetyDecision==='adult_clear'?{
    nudity:pick('nudity').value,
    sexualContext:pick('sexualContext').value,
    graphicInjury:pick('graphicInjury').value,
    sensitiveSignals:[...card.querySelectorAll('[name="sensitiveSignals"]:checked')].map(x=>x.value),
    possibleMinorConcern:pick('possibleMinorConcern').value==='true'?true:pick('possibleMinorConcern').value==='false'?false:null,
    confidence:confidenceRaw===''?null:Number(confidenceRaw),
    uncertaintyFlags:pick('uncertaintyFlags').value.split(',').map(x=>x.trim()).filter(Boolean)
  }:null;
  const response=await fetch('/api/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fileName:card.dataset.file,ageSafetyDecision,detectorLabel})});
  const result=await response.json();
  const status=card.querySelector('.status');
  if(!response.ok){status.textContent='Fout: '+(result.error||'ongeldige review');return;}
  card.classList.remove('suggested');
  if(result.labelStatus==='excluded_age_safety'){
    card.classList.add('excluded');status.textContent='↷ overgeslagen wegens leeftijdsveiligheid';button.textContent='Overslaan opnieuw opslaan';
  }else{
    card.classList.remove('excluded');status.textContent='✓ menselijk bevestigd';button.textContent='Label opnieuw bevestigen';
  }
  document.querySelector('.summary').innerHTML='<strong>'+result.reviewedCount+'/'+result.totalCount+' menselijk beoordeeld</strong> · '+result.prefilledCount+' vooringevuld · '+result.includedLabelCount+' gelabeld · '+result.ageSafetyExcludedCount+' leeftijdsveiligheid uitgesloten · '+result.assistantAcceptedAsIsCount+' assistentvoorstellen ongewijzigd bevestigd · '+result.assistantCorrectedCount+' aangepast. Research only.';
}
</script></body></html>`;
};

const readJsonBody = (request) => new Promise((resolve, reject) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
    if (body.length > 64 * 1024) reject(new Error('request_too_large'));
  });
  request.on('end', () => {
    try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('invalid_json')); }
  });
  request.on('error', reject);
});

const sameNormalizedLabel = (left, right) => JSON.stringify(left || null) === JSON.stringify(right || null);

const saveHumanReview = async (payload) => {
  const states = await loadState();
  const state = states.find((item) => item.fileName === payload?.fileName);
  if (!state) throw new Error('unknown_web_research_image');
  if (!AGE_SAFETY_DECISIONS.includes(payload?.ageSafetyDecision)) throw new Error('invalid_age_safety_decision');

  let detectorLabel = null;
  let labelStatus = 'excluded_age_safety';
  if (payload.ageSafetyDecision === 'adult_clear') {
    const validation = validateArtesDetectorLabel(payload?.detectorLabel);
    if (!validation.valid) throw new Error(`invalid_detector_label:${validation.errors.join(',')}`);
    detectorLabel = normalizeArtesDetectorLabel(payload.detectorLabel);
    if (detectorLabel.possibleMinorConcern !== false) {
      throw new Error('web_research_possible_minor_must_be_skipped');
    }
    labelStatus = 'human_confirmed';
  }

  const assistantSuggestionPresent = Boolean(state.assistantSuggestion);
  let assistantSuggestionAcceptedAsIs = null;
  if (assistantSuggestionPresent) {
    const suggestion = state.assistantSuggestion;
    const suggestedLabel = suggestion.ageSafetyDecision === 'adult_clear'
      ? normalizeArtesDetectorLabel(suggestion.detectorLabel)
      : null;
    assistantSuggestionAcceptedAsIs = suggestion.ageSafetyDecision === payload.ageSafetyDecision
      && sameNormalizedLabel(suggestedLabel, detectorLabel);
  }

  const existing = await readOptionalJson(OUTPUT_PATH, { items: [] });
  const items = Array.isArray(existing.items) ? existing.items.filter((item) => item.fileName !== state.fileName) : [];
  items.push({
    fileName: state.fileName,
    sha256: state.sha256,
    sourcePoolId: state.sourcePoolId,
    sourceUrl: state.source.sourceUrl,
    discoveryFacet: state.source.visualFacet || null,
    ageSafetyDecision: payload.ageSafetyDecision,
    detectorLabel,
    labelStatus,
    labelSource: 'local_human_review',
    assistantSuggestionPresent,
    assistantSuggestionSource: assistantSuggestionPresent ? 'assistant_visual_review' : null,
    assistantPrefillVersion: assistantSuggestionPresent ? state.assistantPrefillVersion : null,
    assistantSuggestionAcceptedAsIs,
    semanticClusterId: null,
    semanticClusterApproved: false,
    researchOnly: true,
    trainingReady: false,
    productionEligible: false,
    runtimeEligible: false,
  });
  items.sort((a, b) => a.fileName.localeCompare(b.fileName));

  const includedLabelCount = items.filter((item) => item.labelStatus === 'human_confirmed').length;
  const ageSafetyExcludedCount = items.filter((item) => item.labelStatus === 'excluded_age_safety').length;
  const assistantAcceptedAsIsCount = items.filter((item) => item.assistantSuggestionAcceptedAsIs === true).length;
  const assistantCorrectedCount = items.filter((item) => item.assistantSuggestionPresent === true && item.assistantSuggestionAcceptedAsIs === false).length;
  const prefilledCount = states.filter((item) => item.assistantSuggestion).length;
  const reviewStatus = items.length === states.length ? 'complete' : 'partial';
  await writeFile(OUTPUT_PATH, `${JSON.stringify({
    schemaVersion: 1,
    labelVersion: 'artes_detector_v1',
    reviewType: 'public_web_research_local_human_review',
    datasetSubdir: DATASET_SUBDIR,
    reviewStatus,
    totalItemCount: states.length,
    reviewedItemCount: items.length,
    includedLabelCount,
    ageSafetyExcludedCount,
    assistantPrefillUsed: prefilledCount > 0,
    assistantPrefillCount: prefilledCount,
    assistantAcceptedAsIsCount,
    assistantCorrectedCount,
    humanLabelsAuthoritative: true,
    humanAgeSafetyReviewRequired: true,
    discoveryMetadataIsLabelAuthority: false,
    researchOnly: true,
    trainingReady: false,
    productionEligible: false,
    runtimeEligible: false,
    items,
  }, null, 2)}\n`, 'utf8');

  return {
    labelStatus,
    reviewStatus,
    totalCount: states.length,
    reviewedCount: items.length,
    prefilledCount,
    includedLabelCount,
    ageSafetyExcludedCount,
    assistantAcceptedAsIsCount,
    assistantCorrectedCount,
  };
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${HOST}:${PORT}`);
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await renderPage());
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/image/')) {
      const fileName = path.basename(decodeURIComponent(url.pathname.slice('/image/'.length)));
      const mime = MIME_BY_EXT.get(path.extname(fileName).toLowerCase());
      const states = await loadState();
      if (!mime || !states.some((item) => item.fileName === fileName)) throw new Error('unknown_web_research_image');
      const bytes = await readFile(path.join(IMAGE_DIR, fileName));
      response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
      response.end(bytes);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/review') {
      const payload = await readJsonBody(request);
      const result = await saveHumanReview(payload);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, ...result, researchOnly: true, trainingReady: false, productionEligible: false, runtimeEligible: false }));
      return;
    }
    response.writeHead(404).end('Not found');
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: error?.message || 'review_error' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Artes web research label review: http://${HOST}:${PORT}`);
  console.log(`Dataset: ${DATASET_SUBDIR}`);
  console.log(`Assistant prefill: ${path.relative(REPO_ROOT, PREFILL_PATH)}`);
  console.log(`Output: ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
  console.log('Stop with Ctrl+C. Assistant suggestions are non-authoritative; only saved human review is authoritative.');
});
