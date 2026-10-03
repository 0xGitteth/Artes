import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../.tmp/moderation-research-discovery/professional-adult-b2b-public-catalog-v1/', import.meta.url));
const batches = [
  { key: 'balanced', count: 78, prefix: 'balanced-target-scene', images: 'balanced-target-scene-previews' },
  { key: 'scene-depth', count: 63, prefix: 'adultlabs-scene-depth', images: 'adultlabs-scene-depth-previews' },
];
const hash = data => createHash('sha256').update(data).digest('hex');
const semantic = label => JSON.stringify([label?.nudity, label?.sexualContext, label?.graphicInjury, label?.sensitiveSignals, label?.possibleMinorConcern]);
const fail = message => { throw new Error(message); };
const rows = []; const inputDigests = {}; const excluded = []; const summaries = {};
for (const batch of batches) {
  const raw = await readFile(path.join(root, batch.prefix + '-labels.reviewed.json'), 'utf8');
  const review = JSON.parse(raw);
  const manifest = JSON.parse(await readFile(path.join(root, batch.prefix + '-preview-screening.json'), 'utf8'));
  inputDigests[batch.key] = hash(raw);
  if (review.batch !== batch.key || review.status !== 'complete' || review.reviewedCount !== batch.count || review.humanLabelsAuthoritative !== true || review.items?.length !== batch.count) fail(`${batch.key}: beoordelingen zijn niet compleet en bevestigd.`);
  if (!Array.isArray(manifest.records)) fail(`${batch.key}: manifest ontbreekt.`);
  const names = new Set(); const indices = new Set();
  summaries[batch.key] = { reviewed: batch.count, included: 0, excluded: 0 };
  for (const item of review.items) {
    const id = `${batch.key}:${item.index}`;
    if (names.has(item.fileName) || indices.has(item.index) || !Number.isInteger(item.index) || item.index < 1 || item.index > batch.count) fail(`${id}: dubbel of ongeldig item.`);
    names.add(item.fileName); indices.add(item.index);
    const record = manifest.records.find(x => x.index === item.index);
    if (!record || record.fileName !== item.fileName || record.sha256 !== item.sha256 || record.sourcePoolId !== item.sourcePoolId) fail(`${id}: herkomst wijkt af van manifest.`);
    if (path.basename(item.fileName || '') !== item.fileName) fail(`${id}: ongeldige bestandsnaam.`);
    if (hash(await readFile(path.join(root, batch.images, item.fileName))) !== item.sha256) fail(`${id}: afbeelding gewijzigd.`);
    if (item.humanLabelsAuthoritative !== true || item.researchOnly !== true || item.trainingReady !== false || item.productionEligible !== false || item.runtimeEligible !== false) fail(`${id}: ongeldige autoriteit of researchstatus.`);
    const base = { id, batch: batch.key, index: item.index, fileName: item.fileName, imagePath: `${batch.images}/${item.fileName}`, sha256: item.sha256, sourcePoolId: item.sourcePoolId };
    if (['excluded_age_safety', 'excluded_marketing_composite', 'excluded_non_photographic'].includes(item.labelStatus)) {
      if (item.detectorLabel !== null) fail(`${id}: uitgesloten item heeft detectorlabel.`);
      excluded.push({ ...base, reason: item.labelStatus }); summaries[batch.key].excluded++; continue;
    }
    const label = item.detectorLabel;
    if (item.labelStatus !== 'human_confirmed' || item.researchEligibilityDecision !== 'include_real_photograph' || !['none','underwear_swimwear','implied_nude','bare_buttocks','female_bare_breasts','genitalia','male_topless'].includes(label?.nudity) || !['none','suggestive','bdsm_kink','explicit_act'].includes(label?.sexualContext) || !Array.isArray(label?.uncertaintyFlags) || !Number.isFinite(label?.confidence) || label.confidence < 0 || label.confidence > 1 || label.graphicInjury !== 'none' || label.possibleMinorConcern !== false || !Array.isArray(label.sensitiveSignals) || label.sensitiveSignals.length) fail(`${id}: ongeldig bevestigd label.`);
    const ageRequired = ['implied_nude','bare_buttocks','female_bare_breasts','genitalia'].includes(label.nudity) || label.sexualContext !== 'none';
    if (item.ageSafetyDecision !== 'adult_clear' && (ageRequired || item.ageSafetyDecision !== 'not_required_nonadult_nonsexual')) fail(`${id}: leeftijdsbeslissing past niet bij label.`);
    if (!item.sourcePoolId) fail(`${id}: broncluster ontbreekt.`);
    const reasons = [];
    if (label.uncertaintyFlags.length) reasons.push('uncertainty_flags_present');
    if (label.confidence < 0.9) reasons.push('assistant_confidence_below_0_9');
    if (item.assistantRecheck?.proposedLabel?.uncertaintyFlags?.includes('visible_act_or_contact_uncertain_low_resolution')) reasons.push('low_resolution_contact_uncertain');
    rows.push({ ...base, detectorLabel: label, observations: item.assistantRecheck?.observations || [], quarantineReasons: reasons }); summaries[batch.key].included++;
  }
}
const byHash = new Map();
for (const row of rows) { if (!byHash.has(row.sha256)) byHash.set(row.sha256, []); byHash.get(row.sha256).push(row); }
const exactDuplicates = []; const labelConflicts = []; const canonical = [];
for (const [sha256, group] of byHash) {
  if (group.length > 1) exactDuplicates.push({ sha256, ids: group.map(x => x.id) });
  if (new Set(group.map(x => semantic(x.detectorLabel))).size > 1) {
    labelConflicts.push({ sha256, ids: group.map(x => x.id), labels: group.map(x => ({ id: x.id, detectorLabel: x.detectorLabel })) });
    for (const row of group) row.quarantineReasons.push('identical_image_label_conflict');
  }
  const first = group[0];
  canonical.push({ ...first, aliases: group.map(x => x.id), sourcePools: [...new Set(group.map(x => x.sourcePoolId))], quarantineReasons: [...new Set(group.flatMap(x => x.quarantineReasons))] });
}
// Keep entire source pools together, including links through identical images.
const parents = new Map();
const find = x => { if (!parents.has(x)) parents.set(x, x); if (parents.get(x) !== x) parents.set(x, find(parents.get(x))); return parents.get(x); };
const union = (a,b) => { a=find(a);b=find(b);if(a!==b)parents.set(b,a); };
for (const row of canonical) for (const pool of row.sourcePools) union(row.sourcePools[0], pool);
const groupPools = new Map();
for (const pool of parents.keys()) { const g=find(pool);if(!groupPools.has(g))groupPools.set(g,[]);groupPools.get(g).push(pool); }
const groupKeys = [...groupPools.entries()].map(([g,pools]) => ({ g, key: hash(pools.sort().join('\n')) })).sort((a,b)=>a.key.localeCompare(b.key));
const validationCount = groupKeys.length > 1 ? Math.max(1, Math.floor(groupKeys.length * 0.2)) : 0;
const validation = new Set(groupKeys.slice(0,validationCount).map(x => x.g));
for (const row of canonical) {
  row.sourceGroup = hash(groupPools.get(find(row.sourcePools[0])).join('\n'));
  row.proposedUse = row.quarantineReasons.length ? 'quarantine' : (validation.has(find(row.sourcePools[0])) ? 'validation_candidate' : 'training_candidate');
}
const tally = (list, field) => list.reduce((acc,row) => { const k=field(row);acc[k]=(acc[k]||0)+1;return acc; },{});
const quarantine = canonical.filter(x=>x.proposedUse==='quarantine');
const report = {
  schemaVersion: 1, status: 'research_curation_proposal', inputDigests, researchOnly: true, trainingReady: false, productionEligible: false, runtimeEligible: false,
  batchSummary: summaries, reviewedTotal: 141, excludedCount: excluded.length, includedBeforeDeduplication: rows.length, uniqueIncludedCount: canonical.length,
  exactDuplicateGroups: exactDuplicates, identicalImageLabelConflicts: labelConflicts,
  quarantineCount: quarantine.length, proposedUseCounts: tally(canonical,x=>x.proposedUse),
  sexualContextCounts: tally(canonical,x=>x.detectorLabel.sexualContext), nudityCounts: tally(canonical,x=>x.detectorLabel.nudity),
  contextByProposedUse: Object.fromEntries(['quarantine','validation_candidate','training_candidate'].map(use=>[use,tally(canonical.filter(x=>x.proposedUse===use),x=>x.detectorLabel.sexualContext)])),
  sourcePoolCounts: tally(rows,x=>x.sourcePoolId),
  limitations: ['Only byte-identical duplicates detected; visual near-duplicates have not been checked.', 'Source pools are kept together; the same production may span multiple source pools.', 'Class counts do not establish balance by sex, orientation or scene type.', 'Confidence is inherited assistant metadata, not measured human certainty.', 'Uncertainty flags may be inherited and require curation review.', 'Small previews limit visual assessment.', 'Source licensing, consent and suitability for model training have not been established.', 'Candidate split is provisional; quarantine items are in neither split.'],
  excludedItems: excluded, items: canonical,
};
const destination = path.join(root,'curation'); await mkdir(destination,{recursive:true});
const output = path.join(destination,'target-scene-curation-proposal.json');
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(`Beoordeeld: 141/141. Uitgesloten: ${excluded.length}. Unieke opgenomen beelden: ${canonical.length}.`);
console.log(`Exacte duplicaatgroepen: ${exactDuplicates.length}. Labelconflicten: ${labelConflicts.length}. Apart gehouden wegens onzekerheid/conflict: ${quarantine.length}.`);
console.log('Seksuele context: '+JSON.stringify(report.sexualContextCounts));
console.log('Voorlopige verdeling: '+JSON.stringify(report.proposedUseCounts));
console.log('Rapport: '+output);
console.log('Bronbestanden blijven ongewijzigd. Visuele bijna-duplicaten en gebruiksrechten zijn nog niet gecontroleerd; niets is vrijgegeven voor training of productie.');
