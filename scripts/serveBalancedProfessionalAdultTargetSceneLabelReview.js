import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const IMAGE_DIR = path.join(ROOT, 'balanced-target-scene-previews');
const MANIFEST_PATH = path.join(ROOT, 'balanced-target-scene-preview-screening.json');
const OUTPUT_PATH = path.join(ROOT, 'balanced-target-scene-labels.reviewed.json');
const PREFILL_PATH = path.join(REPO_ROOT, 'docs', 'moderation-balanced-target-scene-assistant-prefill-v1.json');
const HOST = '127.0.0.1';
const PORT = Number(process.env.ARTES_BALANCED_TARGET_REVIEW_PORT || 8794);

const ALLOWED_NUDITY = ['none', 'underwear_swimwear', 'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia', 'male_topless'];
const ALLOWED_SEXUAL_CONTEXT = ['none', 'suggestive', 'bdsm_kink', 'explicit_act'];
const AGE_SAFETY_DECISIONS = ['not_required_nonadult_nonsexual', 'adult_clear', 'skip_minor_or_age_uncertain'];
const ELIGIBILITY_DECISIONS = ['include_real_photograph', 'exclude_marketing_composite', 'exclude_non_photographic_or_synthetic'];
const AGE_RELEVANT_NUDITY = new Set(['implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia']);

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const readOptionalJson = async (filePath, fallback) => {
  try { return JSON.parse(await readFile(filePath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
};
const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const labelNeedsAgeSafety = (label) => AGE_RELEVANT_NUDITY.has(label?.nudity) || (label?.sexualContext && label.sexualContext !== 'none');

const validateManifest = (manifest) => {
  if (
    manifest?.status !== 'research_balanced_professional_adult_target_scene_preview_screening_only'
    || manifest?.fetchedCount !== 78 || manifest?.failedCount !== 0 || manifest?.uniquePoolCount !== 26
    || manifest?.researchOnly !== true || manifest?.trainingReady !== false || manifest?.productionEligible !== false
    || manifest?.sourceIntentIsLabelAuthority !== false || !Array.isArray(manifest?.records)
  ) throw new Error('balanced_target_review_manifest_not_ready');
};

const validateLabel = (label) => {
  if (!label || typeof label !== 'object') throw new Error('detector_label_required');
  if (!ALLOWED_NUDITY.includes(label.nudity)) throw new Error('invalid_nudity');
  if (!ALLOWED_SEXUAL_CONTEXT.includes(label.sexualContext)) throw new Error('invalid_sexual_context');
  if (label.graphicInjury !== 'none') throw new Error('balanced_target_graphic_injury_must_be_none');
  if (!Array.isArray(label.sensitiveSignals) || label.sensitiveSignals.length !== 0) throw new Error('balanced_target_sensitive_signals_must_be_empty');
  if (label.possibleMinorConcern !== false) throw new Error('possible_minor_must_be_age_excluded');
  if (!Number.isFinite(label.confidence) || label.confidence < 0 || label.confidence > 1) throw new Error('invalid_confidence');
  if (!Array.isArray(label.uncertaintyFlags)) throw new Error('invalid_uncertainty_flags');
};

const expandPrefill = (prefill, manifest) => {
  if (
    prefill?.prefillVersion !== 'balanced_target_scene_assistant_prefill_v1'
    || prefill?.suggestionSource !== 'assistant_visual_review'
    || prefill?.authoritative !== false || prefill?.humanConfirmationRequired !== true
    || prefill?.discoveryMetadataUsedAsLabelAuthority !== false || prefill?.itemCount !== 78
    || !Array.isArray(prefill?.indexRules)
  ) throw new Error('balanced_target_prefill_invalid');
  const byIndex = new Map();
  for (const rule of prefill.indexRules) {
    if (!ELIGIBILITY_DECISIONS.includes(rule.researchEligibilityDecision)) throw new Error('balanced_target_prefill_eligibility_invalid');
    for (const index of rule.indices || []) {
      if (byIndex.has(index)) throw new Error(`balanced_target_prefill_duplicate_index:${index}`);
      const suggestion = {
        researchEligibilityDecision: rule.researchEligibilityDecision,
        ageSafetyDecision: rule.ageSafetyDecision ?? null,
        detectorLabel: rule.detectorLabel ?? null,
        basis: rule.basis || 'assistant_visual_review_from_user_uploaded_balanced_target_scene_review_batch',
      };
      if (suggestion.researchEligibilityDecision === 'include_real_photograph') {
        if (!AGE_SAFETY_DECISIONS.includes(suggestion.ageSafetyDecision)) throw new Error(`balanced_target_prefill_age_invalid:${index}`);
        if (suggestion.ageSafetyDecision === 'skip_minor_or_age_uncertain') {
          if (suggestion.detectorLabel !== null) throw new Error(`balanced_target_prefill_age_skip_has_label:${index}`);
        } else {
          validateLabel(suggestion.detectorLabel);
          if (suggestion.ageSafetyDecision === 'not_required_nonadult_nonsexual' && labelNeedsAgeSafety(suggestion.detectorLabel)) {
            throw new Error(`balanced_target_prefill_age_required:${index}`);
          }
        }
      } else if (suggestion.ageSafetyDecision !== null || suggestion.detectorLabel !== null) {
        throw new Error(`balanced_target_prefill_exclusion_has_label:${index}`);
      }
      byIndex.set(index, suggestion);
    }
  }
  for (const record of manifest.records) if (!byIndex.has(record.index)) throw new Error(`balanced_target_prefill_missing_index:${record.index}`);
  return byIndex;
};

const loadState = async () => {
  const [manifest, prefill, reviewed] = await Promise.all([
    readFile(MANIFEST_PATH, 'utf8').then(JSON.parse),
    readFile(PREFILL_PATH, 'utf8').then(JSON.parse),
    readOptionalJson(OUTPUT_PATH, { items: [] }),
  ]);
  validateManifest(manifest);
  const suggestionByIndex = expandPrefill(prefill, manifest);
  const reviewedByFile = new Map((reviewed.items || []).map((item) => [item.fileName, item]));
  return { manifest, prefill, reviewed, suggestionByIndex, reviewedByFile };
};

const eligibilityOptions = (selected) => [
  ['include_real_photograph', 'echte losse fotografie / opnemen'],
  ['exclude_marketing_composite', 'uitsluiten: cover / collage / marketingcomposiet'],
  ['exclude_non_photographic_or_synthetic', 'uitsluiten: niet-fotografisch / synthetisch'],
].map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`).join('');
const ageOptions = (selected) => [
  ['', 'Kies…'],
  ['not_required_nonadult_nonsexual', 'niet nodig: geen adult/seksuele content'],
  ['adult_clear', 'volwassene voldoende duidelijk'],
  ['skip_minor_or_age_uncertain', 'uitsluiten: minderjarig of relevante leeftijd onzeker'],
].map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`).join('');
const enumOptions = (values, selected) => values.map((value) => `<option value="${value}"${selected === value ? ' selected' : ''}>${value}</option>`).join('');

const renderPage = async () => {
  const { manifest, prefill, reviewedByFile } = await loadState();
  const reviewedCount = manifest.records.filter((record) => reviewedByFile.has(record.fileName)).length;
  const cards = manifest.records.map((record) => {
    const suggestion = expandPrefill(prefill, manifest).get(record.index);
    const reviewed = reviewedByFile.get(record.fileName) || null;
    const base = reviewed || suggestion;
    const label = base.detectorLabel || { nudity: 'none', sexualContext: 'none', confidence: 0.95, uncertaintyFlags: [] };
    const status = reviewed
      ? (reviewed.labelStatus === 'human_confirmed' ? '✓ menselijk bevestigd' : '↷ menselijk uitgesloten')
      : 'Vooringevuld door assistent · nog bevestigen';
    return `<article class="card" data-file="${escapeHtml(record.fileName)}">
      <div class="media"><div class="idx">#${record.index}</div><img loading="lazy" src="/image/${encodeURIComponent(record.fileName)}" alt="review ${record.index}"></div>
      <div class="controls">
        <div class="status">${status}</div>
        <label>Gebruik voor research<select name="eligibility">${eligibilityOptions(base.researchEligibilityDecision)}</select></label>
        <label>Leeftijdsbeslissing<select name="age">${ageOptions(base.ageSafetyDecision || '')}</select></label>
        <div class="labelFields">
          <label>Nudity<select name="nudity">${enumOptions(ALLOWED_NUDITY, label.nudity)}</select></label>
          <label>Sexual context<select name="sexualContext">${enumOptions(ALLOWED_SEXUAL_CONTEXT, label.sexualContext)}</select></label>
          <label>Confidence<input name="confidence" type="number" min="0" max="1" step="0.01" value="${escapeHtml(label.confidence ?? 0.95)}"></label>
          <label>Uncertainty flags<input name="flags" value="${escapeHtml((label.uncertaintyFlags || []).join(', '))}" placeholder="comma separated"></label>
        </div>
        <button type="button" class="save">Voorstel klopt / bevestigen</button>
        <div class="msg"></div>
      </div>
    </article>`;
  }).join('');
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Balanced target scene review</title>
  <style>
  body{font-family:system-ui,sans-serif;margin:0;background:#f5f5f5;color:#151515}header{position:sticky;top:0;z-index:2;background:white;padding:14px 20px;border-bottom:1px solid #ddd}main{max-width:1200px;margin:auto;padding:18px}.card{display:grid;grid-template-columns:minmax(260px,420px) 1fr;gap:22px;background:white;border:1px solid #ddd;border-radius:14px;padding:16px;margin:0 0 18px}.media{position:relative}.media img{display:block;max-width:100%;max-height:520px;margin:auto}.idx{position:absolute;top:6px;left:6px;background:#fff;padding:4px 7px;border-radius:6px;font-weight:700}.controls{display:grid;gap:11px;align-content:start}.status{font-weight:700}.controls label{display:grid;gap:5px;font-weight:600}.controls select,.controls input{font:inherit;padding:8px}.save{font:inherit;font-weight:700;padding:10px 14px;cursor:pointer}.msg{min-height:1.2em}.note{font-size:.92rem;color:#555}@media(max-width:760px){.card{grid-template-columns:1fr}}
  </style></head><body><header><strong>Balanced target scene review</strong> · <span id="progress">${reviewedCount}/78 menselijk beoordeeld</span><div class="note">Alles is al vooringevuld door de assistent. Discovery facets zijn bewust verborgen en zijn geen labelautoriteit.</div></header><main>${cards}</main>
  <script>
  const cards=[...document.querySelectorAll('.card')];
  function sync(card){const excluded=card.querySelector('[name=eligibility]').value!=='include_real_photograph';card.querySelector('[name=age]').disabled=excluded;card.querySelector('.labelFields').style.opacity=excluded?'.4':'1';for(const el of card.querySelectorAll('.labelFields input,.labelFields select'))el.disabled=excluded;}
  for(const card of cards){sync(card);card.querySelector('[name=eligibility]').addEventListener('change',()=>sync(card));card.querySelector('.save').addEventListener('click',async()=>{const eligibility=card.querySelector('[name=eligibility]').value;const excluded=eligibility!=='include_real_photograph';const payload={fileName:card.dataset.file,researchEligibilityDecision:eligibility,ageSafetyDecision:excluded?null:card.querySelector('[name=age]').value,detectorLabel:excluded?null:{nudity:card.querySelector('[name=nudity]').value,sexualContext:card.querySelector('[name=sexualContext]').value,graphicInjury:'none',sensitiveSignals:[],possibleMinorConcern:false,confidence:Number(card.querySelector('[name=confidence]').value),uncertaintyFlags:card.querySelector('[name=flags]').value.split(',').map(v=>v.trim()).filter(Boolean)}};const msg=card.querySelector('.msg');msg.textContent='opslaan…';const res=await fetch('/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const data=await res.json();if(!res.ok){msg.textContent='Fout: '+(data.error||res.status);return;}msg.textContent='✓ opgeslagen';card.querySelector('.status').textContent=data.labelStatus==='human_confirmed'?'✓ menselijk bevestigd':'↷ menselijk uitgesloten';document.querySelector('#progress').textContent=data.reviewedCount+'/78 menselijk beoordeeld';});}
  </script></body></html>`;
};

const readBodyJson = (req) => new Promise((resolve, reject) => { let body=''; req.on('data', chunk => { body += chunk; if (body.length > 200000) reject(new Error('request_too_large')); }); req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); } }); req.on('error', reject); });

const saveReview = async (payload) => {
  const { manifest, prefill, reviewed, suggestionByIndex } = await loadState();
  const record = manifest.records.find((item) => item.fileName === payload.fileName);
  if (!record) throw new Error('unknown_review_file');
  const eligibility = payload.researchEligibilityDecision;
  if (!ELIGIBILITY_DECISIONS.includes(eligibility)) throw new Error('invalid_research_eligibility');
  let labelStatus; let ageSafetyDecision = null; let detectorLabel = null;
  if (eligibility !== 'include_real_photograph') {
    labelStatus = eligibility === 'exclude_marketing_composite' ? 'excluded_marketing_composite' : 'excluded_non_photographic';
  } else {
    ageSafetyDecision = payload.ageSafetyDecision;
    if (!AGE_SAFETY_DECISIONS.includes(ageSafetyDecision)) throw new Error('invalid_age_safety_decision');
    if (ageSafetyDecision === 'skip_minor_or_age_uncertain') {
      labelStatus = 'excluded_age_safety';
    } else {
      detectorLabel = payload.detectorLabel;
      validateLabel(detectorLabel);
      if (ageSafetyDecision === 'not_required_nonadult_nonsexual' && labelNeedsAgeSafety(detectorLabel)) throw new Error('age_safety_required_for_adult_or_sexual_content');
      labelStatus = 'human_confirmed';
    }
  }
  const suggestion = suggestionByIndex.get(record.index);
  const comparable = { researchEligibilityDecision: eligibility, ageSafetyDecision, detectorLabel };
  const suggestedComparable = { researchEligibilityDecision: suggestion.researchEligibilityDecision, ageSafetyDecision: suggestion.ageSafetyDecision, detectorLabel: suggestion.detectorLabel };
  const item = {
    index: record.index, fileName: record.fileName, sha256: record.sha256, sourcePoolId: record.sourcePoolId,
    labelStatus, researchEligibilityDecision: eligibility, ageSafetyDecision, detectorLabel,
    labelSource: 'local_human_review', humanLabelsAuthoritative: true,
    assistantSuggestionPresent: true, assistantSuggestionAcceptedAsIs: jsonEqual(comparable, suggestedComparable),
    discoveryFacet: record.targetFacet || null, discoveryMetadataIsLabelAuthority: false,
    semanticClusterApproved: false, researchOnly: true, trainingReady: false, productionEligible: false, runtimeEligible: false,
  };
  const items = (reviewed.items || []).filter((existing) => existing.fileName !== record.fileName); items.push(item); items.sort((a,b)=>a.index-b.index);
  const output = { schemaVersion:1, status:items.length===78?'complete':'partial', reviewedCount:items.length, humanLabelsAuthoritative:true, discoveryMetadataIsLabelAuthority:false, assistantPrefillVersion:prefill.prefillVersion, researchOnly:true, trainingReady:false, productionEligible:false, runtimeEligible:false, items };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output,null,2)}\n`, 'utf8');
  return { labelStatus, reviewedCount: items.length };
};

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/') { const html=await renderPage(); res.writeHead(200,{'content-type':'text/html; charset=utf-8'}); res.end(html); return; }
    if (req.method === 'GET' && url.pathname.startsWith('/image/')) { const fileName=decodeURIComponent(url.pathname.slice('/image/'.length)); if(path.basename(fileName)!==fileName) throw new Error('invalid_image_path'); const buffer=await readFile(path.join(IMAGE_DIR,fileName)); res.writeHead(200,{'content-type':'image/jpeg','cache-control':'no-store'}); res.end(buffer); return; }
    if (req.method === 'POST' && url.pathname === '/save') { const result=await saveReview(await readBodyJson(req)); res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({ok:true,...result})); return; }
    res.writeHead(404,{'content-type':'application/json'}); res.end(JSON.stringify({error:'not_found'}));
  } catch (error) { res.writeHead(400,{'content-type':'application/json'}); res.end(JSON.stringify({error:String(error?.message||error)})); }
});
server.listen(PORT, HOST, () => { console.log(`Balanced target-scene review: http://${HOST}:${PORT}`); console.log(`Review output: ${path.relative(REPO_ROOT, OUTPUT_PATH)}`); });
