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
const PREFILL_OVERRIDE_PATH = path.join(REPO_ROOT, 'docs', 'moderation-web-research-assistant-prefill-overrides-v1.json');

const ALLOWED_NUDITY = ['none', 'underwear_swimwear', 'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia', 'male_topless'];
const ALLOWED_SEXUAL_CONTEXT = ['none', 'suggestive', 'bdsm_kink', 'explicit_act'];
const ALLOWED_GRAPHIC_INJURY = ['none', 'mild', 'graphic'];
const SENSITIVE_SIGNALS = ['bloodInjury', 'selfHarm', 'suicide', 'eatingDisorder', 'substanceDistress', 'violence', 'horrorScare'];
const AGE_SAFETY_DECISIONS = ['not_required_nonadult_nonsexual', 'adult_clear', 'skip_minor_or_age_uncertain'];
const AGE_SAFETY_RELEVANT_NUDITY = new Set(['implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia']);
const RESEARCH_ELIGIBILITY_DECISIONS = ['include_real_photograph', 'exclude_non_photographic_or_synthetic'];
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

const eligibilityOptionHtml = (selected) => [
  '<option value="">Kies…</option>',
  `<option value="include_real_photograph"${selected === 'include_real_photograph' ? ' selected' : ''}>echte fotografie / opnemen</option>`,
  `<option value="exclude_non_photographic_or_synthetic"${selected === 'exclude_non_photographic_or_synthetic' ? ' selected' : ''}>uitsluiten: illustratie / render / game / synthetisch</option>`,
].join('');

const ageSafetyOptionHtml = (selected) => [
  '<option value="">Kies…</option>',
  `<option value="not_required_nonadult_nonsexual"${selected === 'not_required_nonadult_nonsexual' ? ' selected' : ''}>niet nodig: geen adult/seksuele content</option>`,
  `<option value="adult_clear"${selected === 'adult_clear' ? ' selected' : ''}>volwassene voldoende duidelijk</option>`,
  `<option value="skip_minor_or_age_uncertain"${selected === 'skip_minor_or_age_uncertain' ? ' selected' : ''}>uitsluiten: minderjarig of leeftijd onzeker waar leeftijd relevant is</option>`,
].join('');

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

const detectorLabelRequiresAgeSafety = (detectorLabel) => (
  AGE_SAFETY_RELEVANT_NUDITY.has(detectorLabel?.nudity)
  || (detectorLabel?.sexualContext && detectorLabel.sexualContext !== 'none')
);

const normalizeSuggestionEligibility = (suggestion) => suggestion?.researchEligibilityDecision || 'include_real_photograph';

const validateAssistantSuggestion = (suggestion, sourceUrl) => {
  const eligibility = normalizeSuggestionEligibility(suggestion);
  if (!RESEARCH_ELIGIBILITY_DECISIONS.includes(eligibility)) {
    throw new Error(`invalid_assistant_prefill_research_eligibility:${sourceUrl}`);
  }
  if (eligibility === 'exclude_non_photographic_or_synthetic') {
    if (suggestion.ageSafetyDecision !== null || suggestion.detectorLabel !== null) {
      throw new Error(`assistant_prefill_non_photographic_must_not_have_label:${sourceUrl}`);
    }
    return;
  }

  if (!AGE_SAFETY_DECISIONS.includes(suggestion?.ageSafetyDecision)) {
    throw new Error(`invalid_assistant_prefill_age_decision:${sourceUrl}`);
  }
  if (suggestion.ageSafetyDecision === 'skip_minor_or_age_uncertain') {
    if (suggestion.detectorLabel !== null) throw new Error(`assistant_prefill_age_exclusion_must_not_have_label:${sourceUrl}`);
    return;
  }

  const validation = validateArtesDetectorLabel(suggestion.detectorLabel);
  if (!validation.valid) throw new Error(`invalid_assistant_prefill_label:${sourceUrl}:${validation.errors.join(',')}`);
  if (suggestion.detectorLabel.possibleMinorConcern !== false) {
    throw new Error(`assistant_prefill_possible_minor_must_be_skipped:${sourceUrl}`);
  }
  if (suggestion.ageSafetyDecision === 'not_required_nonadult_nonsexual' && detectorLabelRequiresAgeSafety(suggestion.detectorLabel)) {
    throw new Error(`assistant_prefill_age_safety_required_for_adult_or_sexual_content:${sourceUrl}`);
  }
};

const validateAssistantPrefill = (prefill, overrides) => {
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
  if (!overrides || typeof overrides !== 'object' || !Array.isArray(overrides.items)) throw new Error('invalid_assistant_prefill_overrides');
  if (overrides.authoritative !== false || overrides.humanConfirmationRequired !== true) {
    throw new Error('assistant_prefill_overrides_must_be_non_authoritative');
  }

  const seen = new Set();
  for (const suggestion of prefill.items) {
    const sourceUrl = String(suggestion?.sourceUrl || '').trim();
    if (!sourceUrl || seen.has(sourceUrl)) throw new Error('duplicate_or_missing_assistant_prefill_source');
    seen.add(sourceUrl);
  }
  for (const override of overrides.items) {
    const sourceUrl = String(override?.sourceUrl || '').trim();
    if (!sourceUrl) throw new Error('missing_assistant_prefill_override_source');
    if (!seen.has(sourceUrl)) throw new Error(`assistant_prefill_override_unknown_source:${sourceUrl}`);
  }
};

const applySuggestionOverrides = (prefill, overrides) => {
  const overrideByUrl = new Map(overrides.items.map((item) => [item.sourceUrl, item]));
  return prefill.items.map((item) => {
    const override = overrideByUrl.get(item.sourceUrl);
    const merged = override ? { ...item, ...override } : { ...item };
    merged.researchEligibilityDecision = normalizeSuggestionEligibility(merged);
    validateAssistantSuggestion(merged, merged.sourceUrl);
    return merged;
  });
};

const loadState = async () => {
  const [intake, sources, prefill, overrides] = await Promise.all([
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
    readOptionalJson(PREFILL_OVERRIDE_PATH, {
      overrideVersion: null,
      authoritative: false,
      humanConfirmationRequired: true,
      items: [],
    }),
  ]);
  validateResearchInputs(intake, sources);
  validateAssistantPrefill(prefill, overrides);

  const effectiveSuggestions = applySuggestionOverrides(prefill, overrides);
  const reviewed = await readOptionalJson(OUTPUT_PATH, { items: [] });
  const sourceByFile = new Map(sources.records.map((record) => [record.fileName, record]));
  const reviewedByFile = new Map((reviewed.items || []).map((item) => [item.fileName, item]));
  const suggestionBySourceUrl = new Map(effectiveSuggestions.map((item) => [item.sourceUrl, item]));
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

const researchEligibilityOfReviewed = (reviewed) => reviewed?.researchEligibilityDecision || 'include_real_photograph';
const isHumanReviewed = (item) => item.reviewed?.labelStatus === 'human_confirmed'
  || item.reviewed?.labelStatus === 'excluded_age_safety'
  || item.reviewed?.labelStatus === 'excluded_non_photographic';

const renderPage = async () => {
  const items = await loadState();
  const reviewedCount = items.filter(isHumanReviewed).length;
  const includedCount = items.filter((item) => item.reviewed?.labelStatus === 'human_confirmed').length;
  const ageExcludedCount = items.filter((item) => item.reviewed?.labelStatus === 'excluded_age_safety').length;
  const ageNotRequiredCount = items.filter((item) => item.reviewed?.labelStatus === 'human_confirmed' && item.reviewed?.ageSafetyDecision === 'not_required_nonadult_nonsexual').length;
  const nonPhotoExcludedCount = items.filter((item) => item.reviewed?.labelStatus === 'excluded_non_photographic').length;
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
    const eligibilityDecision = item.reviewed
      ? researchEligibilityOfReviewed(item.reviewed)
      : suggestion?.researchEligibilityDecision || 'include_real_photograph';
    const ageDecision = item.reviewed?.ageSafetyDecision ?? suggestion?.ageSafetyDecision ?? '';
    const confirmed = item.reviewed?.labelStatus === 'human_confirmed';
    const ageExcluded = item.reviewed?.labelStatus === 'excluded_age_safety';
    const nonPhotoExcluded = item.reviewed?.labelStatus === 'excluded_non_photographic';
    const excluded = ageExcluded || nonPhotoExcluded;
    const suggested = Boolean(suggestion);
    const signalChecks = SENSITIVE_SIGNALS.map((signal) => (
      `<label><input type="checkbox" name="sensitiveSignals" value="${signal}" ${(base?.sensitiveSignals || []).includes(signal) ? ' checked' : ''}> ${signal}</label>`
    )).join(' ');
    const statusText = nonPhotoExcluded
      ? '↷ uitgesloten: geen echte fotografie'
      : ageExcluded
        ? '↷ uitgesloten wegens leeftijdsveiligheid'
        : confirmed
          ? '✓ menselijk bevestigd'
          : suggested
            ? 'Vooringevuld door assistent · nog bevestigen'
            : 'Nog geen assistentvoorstel';
    const buttonText = excluded
      ? 'Beslissing opnieuw opslaan'
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
          <p class="hint">Leeftijd is alleen een blocker wanneer het beeld adult nudity of seksuele context bevat. Niet-seksuele male topless, gewone underwear/swimwear en andere niet-adult content mogen dus gelabeld worden zonder 18+ vast te stellen. Illustraties, renders, gamebeelden en andere synthetische/non-photographic beelden worden voor deze batch apart uitgesloten.</p>

          <label>Research image type
            <select name="researchEligibilityDecision" onchange="syncEligibility(this)">${eligibilityOptionHtml(eligibilityDecision)}</select>
          </label>

          <div class="age-fields">
            <label>Age safety decision
              <select name="ageSafetyDecision" onchange="syncAgeDecision(this)">${ageSafetyOptionHtml(ageDecision)}</select>
            </label>
          </div>

          <div class="detector-fields">
            <label>Nudity <select name="nudity">${optionHtml(ALLOWED_NUDITY, base?.nudity)}</select></label>
            <label>Sexual context <select name="sexualContext">${optionHtml(ALLOWED_SEXUAL_CONTEXT, base?.sexualContext)}</select></label>
            <label>Graphic injury <select name="graphicInjury">${optionHtml(ALLOWED_GRAPHIC_INJURY, base?.graphicInjury)}</select></label>
            <fieldset><legend>Sensitive signals</legend>${signalChecks}</fieldset>
            <label>Possible minor concern
              <select name="possibleMinorConcern">
                <option value="">Kies…</option>
                <option value="false"${base?.possibleMinorConcern === false ? ' selected' : ''}>false</option>
                <option value="true"${base?.possibleMinorConcern === true ? ' selected' : ''}>true</option>
              </select>
            </label>
            <label>Confidence <input name="confidence" type="number" min="0" max="1" step="0.01" value="${escapeHtml(base?.confidence ?? '')}" placeholder="bijv. 0.99"></label>
            <label>Uncertainty flags <input name="uncertaintyFlags" value="${escapeHtml((base?.uncertaintyFlags || []).join(', '))}" placeholder="optioneel, komma-gescheiden"></label>
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
body{font-family:system-ui,sans-serif;margin:0;background:#f4f4f4;color:#171717}.wrap{max-width:1180px;margin:auto;padding:24px}.summary{position:sticky;top:0;z-index:5;background:#fff;padding:12px 16px;border:1px solid #ddd;border-radius:10px}.card{display:grid;grid-template-columns:minmax(300px,48%) 1fr;background:white;margin:20px 0;border-radius:12px;overflow:hidden;box-shadow:0 1px 8px #0002}.card.suggested{outline:2px solid #ddd}.card.excluded{opacity:.72}.card img{width:100%;height:100%;max-height:760px;object-fit:contain;background:#111}.body{padding:20px}.body label{display:block;margin:12px 0}.body select,.body input{width:100%;padding:8px;margin-top:4px}.body fieldset label{display:inline-block;margin:4px 12px 4px 0}.body fieldset input{width:auto}.hint{font-size:.92rem;opacity:.72}.assistant-note{padding:10px 12px;background:#f3f3f3;border-radius:8px}.status{display:inline-block;margin-left:12px}.disabled{opacity:.45;pointer-events:none}button{padding:10px 16px;cursor:pointer}@media(max-width:780px){.card{grid-template-columns:1fr}.card img{max-height:600px}}
</style></head><body><div class="wrap">
<h1>Artes web research detectorlabels</h1>
<div class="summary"><strong>${reviewedCount}/${items.length} menselijk beoordeeld</strong> · ${prefilledCount} vooringevuld · ${includedCount} gelabeld · ${ageNotRequiredCount} zonder leeftijdsblok · ${ageExcludedCount} leeftijdsveiligheid uitgesloten · ${nonPhotoExcludedCount} non-photographic uitgesloten · ${acceptedAsIsCount} assistentvoorstellen ongewijzigd bevestigd · ${correctedCount} aangepast. Research only.</div>
<p>Waar een assistentvoorstel beschikbaar is, zijn de velden al ingevuld op basis van visuele beoordeling. Discovery metadata wordt niet getoond en is geen labelbron. Jouw bevestiging is authoritative.</p>
${cards}
</div>
<script>
function syncEligibility(select){
  const card=select.closest('.card');
  const excluded=select.value==='exclude_non_photographic_or_synthetic';
  card.querySelector('.age-fields').classList.toggle('disabled',excluded);
  card.querySelector('.detector-fields').classList.toggle('disabled',excluded || card.querySelector('[name="ageSafetyDecision"]').value==='skip_minor_or_age_uncertain');
}
function syncAgeDecision(select){
  const card=select.closest('.card');
  const nonPhoto=card.querySelector('[name="researchEligibilityDecision"]').value==='exclude_non_photographic_or_synthetic';
  card.querySelector('.detector-fields').classList.toggle('disabled',nonPhoto || select.value==='skip_minor_or_age_uncertain');
}
for(const select of document.querySelectorAll('[name="researchEligibilityDecision"]')) syncEligibility(select);
for(const select of document.querySelectorAll('[name="ageSafetyDecision"]')) syncAgeDecision(select);
async function saveCard(button){
  const card=button.closest('.card');
  const pick=(name)=>card.querySelector('[name="'+name+'"]');
  const researchEligibilityDecision=pick('researchEligibilityDecision').value;
  const excludedNonPhoto=researchEligibilityDecision==='exclude_non_photographic_or_synthetic';
  const ageSafetyDecision=excludedNonPhoto?null:pick('ageSafetyDecision').value;
  const confidenceRaw=pick('confidence').value.trim();
  const shouldLabel=!excludedNonPhoto && ageSafetyDecision && ageSafetyDecision!=='skip_minor_or_age_uncertain';
  const detectorLabel=shouldLabel?{
    nudity:pick('nudity').value,
    sexualContext:pick('sexualContext').value,
    graphicInjury:pick('graphicInjury').value,
    sensitiveSignals:[...card.querySelectorAll('[name="sensitiveSignals"]:checked')].map(x=>x.value),
    possibleMinorConcern:pick('possibleMinorConcern').value==='true'?true:pick('possibleMinorConcern').value==='false'?false:null,
    confidence:confidenceRaw===''?null:Number(confidenceRaw),
    uncertaintyFlags:pick('uncertaintyFlags').value.split(',').map(x=>x.trim()).filter(Boolean)
  }:null;
  const response=await fetch('/api/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fileName:card.dataset.file,researchEligibilityDecision,ageSafetyDecision,detectorLabel})});
  const result=await response.json();
  const status=card.querySelector('.status');
  if(!response.ok){status.textContent='Fout: '+(result.error||'ongeldige review');return;}
  card.classList.remove('suggested');
  if(result.labelStatus==='excluded_non_photographic'){
    card.classList.add('excluded');status.textContent='↷ uitgesloten: geen echte fotografie';button.textContent='Beslissing opnieuw opslaan';
  }else if(result.labelStatus==='excluded_age_safety'){
    card.classList.add('excluded');status.textContent='↷ uitgesloten wegens leeftijdsveiligheid';button.textContent='Beslissing opnieuw opslaan';
  }else{
    card.classList.remove('excluded');status.textContent='✓ menselijk bevestigd';button.textContent='Label opnieuw bevestigen';
  }
  document.querySelector('.summary').innerHTML='<strong>'+result.reviewedCount+'/'+result.totalCount+' menselijk beoordeeld</strong> · '+result.prefilledCount+' vooringevuld · '+result.includedLabelCount+' gelabeld · '+result.ageSafetyNotRequiredCount+' zonder leeftijdsblok · '+result.ageSafetyExcludedCount+' leeftijdsveiligheid uitgesloten · '+result.nonPhotographicExcludedCount+' non-photographic uitgesloten · '+result.assistantAcceptedAsIsCount+' assistentvoorstellen ongewijzigd bevestigd · '+result.assistantCorrectedCount+' aangepast. Research only.';
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
  if (!RESEARCH_ELIGIBILITY_DECISIONS.includes(payload?.researchEligibilityDecision)) {
    throw new Error('invalid_research_eligibility_decision');
  }

  let ageSafetyDecision = null;
  let detectorLabel = null;
  let labelStatus = null;

  if (payload.researchEligibilityDecision === 'exclude_non_photographic_or_synthetic') {
    labelStatus = 'excluded_non_photographic';
  } else {
    if (!AGE_SAFETY_DECISIONS.includes(payload?.ageSafetyDecision)) throw new Error('invalid_age_safety_decision');
    ageSafetyDecision = payload.ageSafetyDecision;
    if (ageSafetyDecision === 'skip_minor_or_age_uncertain') {
      labelStatus = 'excluded_age_safety';
    } else {
      const validation = validateArtesDetectorLabel(payload?.detectorLabel);
      if (!validation.valid) throw new Error(`invalid_detector_label:${validation.errors.join(',')}`);
      detectorLabel = normalizeArtesDetectorLabel(payload.detectorLabel);
      if (detectorLabel.possibleMinorConcern !== false) {
        throw new Error('web_research_possible_minor_must_be_skipped');
      }
      if (ageSafetyDecision === 'not_required_nonadult_nonsexual' && detectorLabelRequiresAgeSafety(detectorLabel)) {
        throw new Error('web_research_age_safety_required_for_adult_or_sexual_content');
      }
      labelStatus = 'human_confirmed';
    }
  }

  const assistantSuggestionPresent = Boolean(state.assistantSuggestion);
  let assistantSuggestionAcceptedAsIs = null;
  if (assistantSuggestionPresent) {
    const suggestion = state.assistantSuggestion;
    const suggestedEligibility = suggestion.researchEligibilityDecision || 'include_real_photograph';
    const suggestedAge = suggestedEligibility === 'include_real_photograph' ? suggestion.ageSafetyDecision : null;
    const suggestedLabel = suggestedEligibility === 'include_real_photograph' && suggestedAge !== 'skip_minor_or_age_uncertain'
      ? normalizeArtesDetectorLabel(suggestion.detectorLabel)
      : null;
    assistantSuggestionAcceptedAsIs = suggestedEligibility === payload.researchEligibilityDecision
      && suggestedAge === ageSafetyDecision
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
    researchEligibilityDecision: payload.researchEligibilityDecision,
    ageSafetyDecision,
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
  const ageSafetyNotRequiredCount = items.filter((item) => item.labelStatus === 'human_confirmed' && item.ageSafetyDecision === 'not_required_nonadult_nonsexual').length;
  const ageSafetyExcludedCount = items.filter((item) => item.labelStatus === 'excluded_age_safety').length;
  const nonPhotographicExcludedCount = items.filter((item) => item.labelStatus === 'excluded_non_photographic').length;
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
    ageSafetyNotRequiredCount,
    ageSafetyExcludedCount,
    nonPhotographicExcludedCount,
    assistantPrefillUsed: prefilledCount > 0,
    assistantPrefillCount: prefilledCount,
    assistantAcceptedAsIsCount,
    assistantCorrectedCount,
    humanLabelsAuthoritative: true,
    humanAgeSafetyReviewRequired: true,
    ageSafetyAppliedOnlyWhenAdultOrSexualContent: true,
    realPhotographyResearchOnly: true,
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
    ageSafetyNotRequiredCount,
    ageSafetyExcludedCount,
    nonPhotographicExcludedCount,
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
  console.log(`Assistant prefill overrides: ${path.relative(REPO_ROOT, PREFILL_OVERRIDE_PATH)}`);
  console.log(`Output: ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
  console.log('Stop with Ctrl+C. Assistant suggestions are non-authoritative; only saved human review is authoritative.');
});
