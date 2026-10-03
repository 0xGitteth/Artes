import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = fileURLToPath(new URL('../.tmp/moderation-research-discovery/professional-adult-b2b-public-catalog-v1/', import.meta.url));
const errors = [];
const requireCondition = (condition, message) => { if (!condition) errors.push(message); };
try {
  const review = JSON.parse(await readFile(path.join(root, 'adultlabs-scene-depth-labels.reviewed.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(root, 'adultlabs-scene-depth-preview-screening.json'), 'utf8'));
  requireCondition(review.batch === 'scene-depth', 'Verkeerde batch.');
  const items = Array.isArray(review.items) ? review.items : [];
  requireCondition(items.length === 63, `Er zijn ${items.length} beoordelingen in plaats van 63.`);
  requireCondition(new Set(items.map(x => x.index)).size === items.length, 'Dubbele beeldnummers.');
  requireCondition(new Set(items.map(x => x.fileName)).size === items.length, 'Dubbele bestandsnamen.');
  requireCondition(Array.from({ length: 63 }, (_, i) => i + 1).every(i => items.some(x => x.index === i)), 'Niet alle beeldnummers 1 t/m 63 zijn aanwezig.');
  const records = Array.isArray(manifest.records) ? manifest.records : [];
  const pending = items.filter(x => x.labelStatus === 'assistant_recheck_pending');
  const confirmed = items.filter(x => x.humanLabelsAuthoritative === true && (x.labelStatus === 'human_confirmed' || ['excluded_age_safety', 'excluded_marketing_composite', 'excluded_non_photographic'].includes(x.labelStatus)));
  requireCondition(review.reviewedCount === confirmed.length, 'Opgeslagen teller klopt niet met de bevestigingen.');
  requireCondition(review.status === (confirmed.length === 63 ? 'complete' : 'partial'), 'Batchstatus klopt niet met de bevestigingen.');
  requireCondition(review.humanLabelsAuthoritative === (confirmed.length === items.length), 'Autoriteitsstatus van de batch klopt niet.');
  for (const entity of [review, ...items]) for (const key of ['trainingReady', 'productionEligible', 'runtimeEligible']) requireCondition(entity[key] === false, `${entity.index ? '#' + entity.index : 'Batch'}: ${key} moet false blijven.`);
  for (const entity of [review, ...items]) requireCondition(entity.researchOnly === true, `${entity.index ? '#' + entity.index : 'Batch'}: researchOnly ontbreekt.`);
  for (const item of items) {
    const prefix = `#${item.index}`;
    const record = records.find(x => x.index === item.index);
    requireCondition(record?.fileName === item.fileName && record?.sha256 === item.sha256, `${prefix}: herkomst komt niet overeen met manifest.`);
    requireCondition(path.basename(item.fileName || '') === item.fileName, `${prefix}: ongeldige bestandsnaam.`);
    if (path.basename(item.fileName || '') === item.fileName) {
      try {
        const bytes = await readFile(path.join(root, 'adultlabs-scene-depth-previews', item.fileName));
        requireCondition(createHash('sha256').update(bytes).digest('hex') === item.sha256, `${prefix}: afbeelding is gewijzigd.`);
      } catch { errors.push(`${prefix}: afbeelding ontbreekt of is niet leesbaar.`); }
    }
    requireCondition(confirmed.includes(item) || pending.includes(item), `${prefix}: onbekende beoordelingsstatus.`);
    if (pending.includes(item)) requireCondition(item.humanLabelsAuthoritative === false, `${prefix}: onbevestigd voorstel is ten onrechte autoritatief.`);
    if (item.assistantRecheck) {
      requireCondition(item.previousHumanReview?.fileName === item.fileName && item.previousHumanReview?.sha256 === item.sha256 && item.previousHumanReview?.humanLabelsAuthoritative === true, `${prefix}: oorspronkelijke beoordeling ontbreekt of is ongeldig.`);
      requireCondition(item.assistantRecheck.authoritative === false, `${prefix}: assistentvoorstel is ten onrechte autoritatief.`);
    }
    if (item.labelStatus === 'human_confirmed' || pending.includes(item)) {
      const label = item.detectorLabel;
      requireCondition(['none', 'underwear_swimwear', 'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia', 'male_topless'].includes(label?.nudity), `${prefix}: ongeldig naaktheidslabel.`);
      requireCondition(['none', 'suggestive', 'bdsm_kink', 'explicit_act'].includes(label?.sexualContext), `${prefix}: ongeldige seksuele context.`);
      requireCondition(Number.isFinite(label?.confidence) && label.confidence >= 0 && label.confidence <= 1, `${prefix}: ongeldige confidence.`);
      requireCondition(Array.isArray(label?.uncertaintyFlags), `${prefix}: ongeldige onzekerheidsflags.`);
      requireCondition(label?.graphicInjury === 'none' && label?.possibleMinorConcern === false && Array.isArray(label?.sensitiveSignals) && label.sensitiveSignals.length === 0, `${prefix}: ongeldig detectorlabel.`);
      const ageRequired = ['implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia'].includes(label?.nudity) || label?.sexualContext !== 'none';
      requireCondition(item.ageSafetyDecision === 'adult_clear' || (!ageRequired && item.ageSafetyDecision === 'not_required_nonadult_nonsexual'), `${prefix}: leeftijdsbeslissing ontbreekt of past niet bij het label.`);
    } else requireCondition(item.detectorLabel === null, `${prefix}: uitgesloten beeld heeft nog een detectorlabel.`);
  }
  if (review.assistantRecheckVersion) requireCondition(items.filter(x => x.assistantRecheck).length === 28, 'Niet alle 28 controles met eerdere beoordelingen zijn bewaard.');
  console.log(`Bevestigd: ${confirmed.length}/63. Openstaande voorstellen: ${pending.length}.`);
  if (errors.length) {
    console.error('Controle niet geslaagd:\n' + errors.map(x => '- ' + x).join('\n'));
    process.exitCode = 1;
  } else if (pending.length) {
    console.log('Bestanden zijn consistent. Bevestig de resterende voorstellen in de reviewer.');
    process.exitCode = 2;
  } else console.log('Controle geslaagd: alle 63 beoordelingen zijn bevestigd, afbeeldingen en herkomst kloppen en de eerdere keuzes zijn bewaard. De set blijft alleen voor research; dit controleert de bestanden, niet de inhoudelijke juistheid van de labels.');
} catch (error) {
  console.error(`Controle kon niet worden uitgevoerd: ${error.message}`);
  process.exitCode = 1;
}
