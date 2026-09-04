import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeArtesDetectorLabel, validateArtesDetectorLabel } from '../functions/moderationLearningDataset.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.ARTES_CONTRIBUTOR_LABEL_REVIEW_PORT || 8792);
const IMAGE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-contributor-images');
const BASE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-contributor-intake');
const INTAKE_PATH = path.join(BASE_DIR, 'embedding-intake.json');
const OUTPUT_PATH = path.join(BASE_DIR, 'labels.reviewed.json');

const ALLOWED_NUDITY = ['none', 'underwear_swimwear', 'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia', 'male_topless'];
const ALLOWED_SEXUAL_CONTEXT = ['none', 'suggestive', 'bdsm_kink', 'explicit_act'];
const ALLOWED_GRAPHIC_INJURY = ['none', 'mild', 'graphic'];
const SENSITIVE_SIGNALS = ['bloodInjury', 'selfHarm', 'suicide', 'eatingDisorder', 'substanceDistress', 'violence', 'horrorScare'];
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

const validateContributorEmbeddingIntake = (intake) => {
  if (intake?.intakeType !== 'contributor_authorized_moderation_embeddings') throw new Error('invalid_contributor_embedding_intake');
  if (intake?.authorizationConfirmed !== true) throw new Error('contributor_authorization_not_confirmed');
  if (intake?.trainingReady === true) throw new Error('contributor_embedding_intake_must_not_be_training_ready');
  if (intake?.embeddingProvider !== 'artes_custom_vision' || intake?.embeddingModel !== 'dinov2_vitb14' || intake?.embeddingDimension !== 768) {
    throw new Error('invalid_contributor_embedding_contract');
  }
  if (!Array.isArray(intake?.items) || intake.items.length === 0) throw new Error('contributor_embedding_intake_empty');
};

const loadState = async () => {
  const intake = JSON.parse(await readFile(INTAKE_PATH, 'utf8'));
  validateContributorEmbeddingIntake(intake);
  let reviewed = { items: [] };
  try { reviewed = JSON.parse(await readFile(OUTPUT_PATH, 'utf8')); } catch { /* first run */ }
  const reviewedByFile = new Map((reviewed.items || []).map((item) => [item.fileName, item]));

  return intake.items.map((item) => {
    const fileName = String(item?.fileName || '').trim();
    if (!fileName || path.basename(fileName) !== fileName) throw new Error('invalid_contributor_filename');
    if (!item?.sourcePoolId) throw new Error(`missing_source_pool_id:${fileName}`);
    if (item?.authorization?.rightsHolderConfirmed !== true || item?.authorization?.moderationMlUseAuthorized !== true) {
      throw new Error(`authorization_not_preserved:${fileName}`);
    }
    if (item?.embedding?.model !== 'dinov2_vitb14' || item?.embedding?.dimension !== 768 || !Array.isArray(item?.embedding?.vector) || item.embedding.vector.length !== 768) {
      throw new Error(`invalid_contributor_embedding:${fileName}`);
    }
    return {
      fileName,
      sha256: item.sha256,
      sourcePoolId: item.sourcePoolId,
      authorization: item.authorization,
      reviewed: reviewedByFile.get(fileName) || null,
    };
  });
};

const renderPage = async () => {
  const items = await loadState();
  const cards = items.map((item, index) => {
    const base = item.reviewed?.detectorLabel || {};
    const confirmed = item.reviewed?.labelStatus === 'human_confirmed';
    const signalChecks = SENSITIVE_SIGNALS.map((signal) => (
      `<label><input type="checkbox" name="sensitiveSignals" value="${signal}" ${(base.sensitiveSignals || []).includes(signal) ? 'checked' : ''}> ${signal}</label>`
    )).join(' ');
    return `
      <article class="card" data-file="${escapeHtml(item.fileName)}">
        <img src="/image/${encodeURIComponent(item.fileName)}" alt="Contributorbeeld ${index + 1}">
        <div class="body">
          <h2>${escapeHtml(item.fileName)}</h2>
          <p><strong>Source pool:</strong> ${escapeHtml(item.sourcePoolId)}</p>
          <p><strong>Autorisatie:</strong> ${escapeHtml(item.authorization?.authorizationScope || 'bevestigd')}</p>
          <p class="hint">Er is bewust geen inhoudelijke voorselectie. Bevestig alleen wat je zelf visueel waarneemt.</p>
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
          <label>Confidence <input name="confidence" type="number" min="0" max="1" step="0.05" value="${escapeHtml(base.confidence ?? '')}" placeholder="bijv. 0.95"></label>
          <label>Uncertainty flags <input name="uncertaintyFlags" value="${escapeHtml((base.uncertaintyFlags || []).join(', '))}" placeholder="optioneel, komma-gescheiden"></label>
          <button type="button" onclick="saveCard(this)">${confirmed ? 'Opnieuw bevestigen' : 'Bevestig label'}</button>
          <span class="status">${confirmed ? '✓ menselijk bevestigd' : 'nog niet bevestigd'}</span>
        </div>
      </article>`;
  }).join('\n');

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Artes contributor label review</title><style>
body{font-family:system-ui,sans-serif;margin:0;background:#f4f4f4;color:#171717}.wrap{max-width:1100px;margin:auto;padding:24px}.card{display:grid;grid-template-columns:minmax(280px,46%) 1fr;background:white;margin:20px 0;border-radius:12px;overflow:hidden;box-shadow:0 1px 8px #0002}.card img{width:100%;height:100%;max-height:720px;object-fit:contain;background:#111}.body{padding:20px}.body label{display:block;margin:12px 0}.body select,.body input{width:100%;padding:8px;margin-top:4px}.body fieldset label{display:inline-block;margin:4px 12px 4px 0}.body fieldset input{width:auto}.hint{font-size:.92rem;opacity:.75}.status{margin-left:12px}button{padding:10px 16px;cursor:pointer}@media(max-width:760px){.card{grid-template-columns:1fr}.card img{max-height:560px}}
</style></head><body><div class="wrap"><h1>Artes contributor detectorlabels</h1><p>Lokale, geautoriseerde beelden. Menselijke review maakt deze beelden nog niet trainingsklaar.</p>${cards}</div>
<script>
async function saveCard(button){const card=button.closest('.card');const pick=(name)=>card.querySelector('[name="'+name+'"]');const confidenceRaw=pick('confidence').value.trim();const body={fileName:card.dataset.file,detectorLabel:{nudity:pick('nudity').value,sexualContext:pick('sexualContext').value,graphicInjury:pick('graphicInjury').value,sensitiveSignals:[...card.querySelectorAll('[name="sensitiveSignals"]:checked')].map(x=>x.value),possibleMinorConcern:pick('possibleMinorConcern').value==='true'?true:pick('possibleMinorConcern').value==='false'?false:null,confidence:confidenceRaw===''?null:Number(confidenceRaw),uncertaintyFlags:pick('uncertaintyFlags').value.split(',').map(x=>x.trim()).filter(Boolean)}};const response=await fetch('/api/label',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const result=await response.json();const status=card.querySelector('.status');if(!response.ok){status.textContent='Fout: '+(result.error||'ongeldig label');return;}status.textContent='✓ menselijk bevestigd';button.textContent='Opnieuw bevestigen';}
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

const saveHumanLabel = async (payload) => {
  const states = await loadState();
  const state = states.find((item) => item.fileName === payload?.fileName);
  if (!state) throw new Error('unknown_contributor_image');
  const validation = validateArtesDetectorLabel(payload?.detectorLabel);
  if (!validation.valid) throw new Error(`invalid_detector_label:${validation.errors.join(',')}`);
  const normalized = normalizeArtesDetectorLabel(payload.detectorLabel);
  let existing = { items: [] };
  try { existing = JSON.parse(await readFile(OUTPUT_PATH, 'utf8')); } catch { /* first save */ }
  const items = Array.isArray(existing.items) ? existing.items.filter((item) => item.fileName !== state.fileName) : [];
  items.push({
    fileName: state.fileName,
    sha256: state.sha256,
    sourcePoolId: state.sourcePoolId,
    authorization: state.authorization,
    detectorLabel: normalized,
    labelStatus: 'human_confirmed',
    labelSource: 'local_human_review',
    semanticClusterId: null,
    semanticClusterApproved: false,
    trainingReady: false,
  });
  items.sort((a, b) => a.fileName.localeCompare(b.fileName));
  await writeFile(OUTPUT_PATH, `${JSON.stringify({
    schemaVersion: 1,
    labelVersion: 'artes_detector_v1',
    reviewType: 'contributor_authorized_local_human_review',
    labelStatus: items.length === states.length ? 'complete' : 'partial',
    itemCount: items.length,
    authorizationPreserved: true,
    sourcePoolRequired: true,
    semanticClusterApproved: false,
    trainingReady: false,
    items,
  }, null, 2)}\n`, 'utf8');
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
      if (!mime || !states.some((item) => item.fileName === fileName)) throw new Error('unknown_contributor_image');
      const bytes = await readFile(path.join(IMAGE_DIR, fileName));
      response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
      response.end(bytes);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/label') {
      const payload = await readJsonBody(request);
      await saveHumanLabel(payload);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, trainingReady: false, semanticClusterApproved: false }));
      return;
    }
    response.writeHead(404).end('Not found');
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: error?.message || 'review_error' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Artes contributor label review: http://${HOST}:${PORT}`);
  console.log(`Output: ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
  console.log('Stop with Ctrl+C. No image, embedding or label data is sent to a cloud service.');
});
