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

const loadState = async () => {
  const [intake, sources] = await Promise.all([
    readFile(INTAKE_PATH, 'utf8').then(JSON.parse),
    readFile(SOURCES_PATH, 'utf8').then(JSON.parse),
  ]);
  validateResearchInputs(intake, sources);

  let reviewed = { items: [] };
  try { reviewed = JSON.parse(await readFile(OUTPUT_PATH, 'utf8')); } catch { /* first review run */ }
  const sourceByFile = new Map(sources.records.map((record) => [record.fileName, record]));
  const reviewedByFile = new Map((reviewed.items || []).map((item) => [item.fileName, item]));

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
    };
  });
};

const renderPage = async () => {
  const items = await loadState();
  const reviewedCount = items.filter((item) => item.reviewed).length;
  const includedCount = items.filter((item) => item.reviewed?.labelStatus === 'human_confirmed').length;
  const excludedCount = items.filter((item) => item.reviewed?.labelStatus === 'excluded_age_safety').length;

  const cards = items.map((item, index) => {
    const base = item.reviewed?.detectorLabel || {
      nudity: null,
      sexualContext: null,
      graphicInjury: 'none',
      sensitiveSignals: [],
      possibleMinorConcern: false,
      confidence: null,
      uncertaintyFlags: [],
    };
    const ageDecision = item.reviewed?.ageSafetyDecision || '';
    const confirmed = item.reviewed?.labelStatus === 'human_confirmed';
    const excluded = item.reviewed?.labelStatus === 'excluded_age_safety';
    const signalChecks = SENSITIVE_SIGNALS.map((signal) => (
      `<label><input type="checkbox" name="sensitiveSignals" value="${signal}" ${(base.sensitiveSignals || []).includes(signal) ? 'checked' : ''}> ${signal}</label>`
    )).join(' ');

    return `
      <article class="card${excluded ? ' excluded' : ''}" data-file="${escapeHtml(item.fileName)}">
        <img src="/image/${encodeURIComponent(item.fileName)}" alt="Researchbeeld ${index + 1}">
        <div class="body">
          <h2>${index + 1}. ${escapeHtml(item.fileName)}</h2>
          <p><strong>Source pool:</strong> ${escapeHtml(item.sourcePoolId)}</p>
          <p><strong>Discovery facet:</strong> ${escapeHtml(item.source.visualFacet || 'onbekend')} <span class="hint">(zoekhint, geen detectorlabel)</span></p>
          <p><strong>Maker:</strong> ${escapeHtml(item.source.creator || 'onbekend')}</p>
          <p class="hint">Beoordeel eerst leeftijdsveiligheid. Bij een vermoedelijke minderjarige of echte leeftijdstwijfel: overslaan. De inhoudelijke velden hieronder worden alleen opgeslagen bij adult_clear.</p>

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
            <label>Confidence <input name="confidence" type="number" min="0" max="1" step="0.05" value="${escapeHtml(base.confidence ?? '')}" placeholder="bijv. 1 of 0.95"></label>
            <label>Uncertainty flags <input name="uncertaintyFlags" value="${escapeHtml((base.uncertaintyFlags || []).join(', '))}" placeholder="optioneel, komma-gescheiden"></label>
          </div>

          <button type="button" onclick="saveCard(this)">${excluded ? 'Overslaan opnieuw opslaan' : confirmed ? 'Label opnieuw bevestigen' : 'Review opslaan'}</button>
          <span class="status">${excluded ? '↷ overgeslagen wegens leeftijdsveiligheid' : confirmed ? '✓ menselijk bevestigd' : 'nog niet beoordeeld'}</span>
        </div>
      </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Artes web research label review</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f4f4f4;color:#171717}.wrap{max-width:1180px;margin:auto;padding:24px}.summary{position:sticky;top:0;z-index:5;background:#fff;padding:12px 16px;border:1px solid #ddd;border-radius:10px}.card{display:grid;grid-template-columns:minmax(300px,48%) 1fr;background:white;margin:20px 0;border-radius:12px;overflow:hidden;box-shadow:0 1px 8px #0002}.card.excluded{opacity:.72}.card img{width:100%;height:100%;max-height:760px;object-fit:contain;background:#111}.body{padding:20px}.body label{display:block;margin:12px 0}.body select,.body input{width:100%;padding:8px;margin-top:4px}.body fieldset label{display:inline-block;margin:4px 12px 4px 0}.body fieldset input{width:auto}.hint{font-size:.92rem;opacity:.72}.status{display:inline-block;margin-left:12px}.detector-fields.disabled{opacity:.45;pointer-events:none}button{padding:10px 16px;cursor:pointer}@media(max-width:780px){.card{grid-template-columns:1fr}.card img{max-height:600px}}
</style></head><body><div class="wrap">
<h1>Artes web research detectorlabels</h1>
<div class="summary"><strong>${reviewedCount}/${items.length} beoordeeld</strong> · ${includedCount} gelabeld · ${excludedCount} leeftijdsveiligheid uitgesloten. Research only. Geen training of runtime authority.</div>
<p>Alle beelden staan in één lokale reviewflow. Discovery facet is uitsluitend context over hoe het beeld is gevonden. Jouw visuele beoordeling bepaalt het detectorlabel.</p>
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
  if(result.labelStatus==='excluded_age_safety'){
    card.classList.add('excluded');status.textContent='↷ overgeslagen wegens leeftijdsveiligheid';button.textContent='Overslaan opnieuw opslaan';
  }else{
    card.classList.remove('excluded');status.textContent='✓ menselijk bevestigd';button.textContent='Label opnieuw bevestigen';
  }
  document.querySelector('.summary').innerHTML='<strong>'+result.reviewedCount+'/'+result.totalCount+' beoordeeld</strong> · '+result.includedLabelCount+' gelabeld · '+result.ageSafetyExcludedCount+' leeftijdsveiligheid uitgesloten. Research only. Geen training of runtime authority.';
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

  let existing = { items: [] };
  try { existing = JSON.parse(await readFile(OUTPUT_PATH, 'utf8')); } catch { /* first save */ }
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
    includedLabelCount,
    ageSafetyExcludedCount,
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
  console.log(`Output: ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
  console.log('Stop with Ctrl+C. No image, embedding or label data is sent to a cloud service.');
});
