import React, { useMemo } from 'react';

const NUDITY_OPTIONS = [
  ['none', 'Geen naaktheid'],
  ['underwear_swimwear', 'Ondergoed / swimwear'],
  ['implied_nude', 'Implied nude'],
  ['bare_buttocks', 'Blote billen'],
  ['female_bare_breasts', 'Blote borsten'],
  ['genitalia', 'Genitaliën zichtbaar'],
  ['male_topless', 'Mannelijk topless'],
];

const SEXUAL_CONTEXT_OPTIONS = [
  ['none', 'Niet seksueel'],
  ['suggestive', 'Suggestief / erotisch'],
  ['bdsm_kink', 'BDSM / kink'],
  ['explicit_act', 'Expliciete seksuele handeling'],
];

const GRAPHIC_INJURY_OPTIONS = [
  ['none', 'Geen letsel'],
  ['mild', 'Mild letsel'],
  ['graphic', 'Grafisch letsel'],
];

const SENSITIVE_SIGNAL_OPTIONS = [
  ['bloodInjury', 'Bloed / verwonding'],
  ['selfHarm', 'Zelfbeschadiging'],
  ['suicide', 'Suïcide'],
  ['eatingDisorder', 'Eetstoornis'],
  ['substanceDistress', 'Ernstige intoxicatie'],
  ['violence', 'Geweld'],
  ['horrorScare', 'Horror / schrik'],
];

const FIELD_PLANS_BY_REASON = {
  allowed_art_nude: ['nudity', 'sexualContext'],
  allowed_boudoir: ['nudity', 'sexualContext'],
  allowed_non_sensitive: ['nudity', 'sexualContext'],
  review_borderline_adult: ['nudity', 'sexualContext', 'possibleMinorConcern'],
  forbidden_explicit_sexual: ['nudity', 'sexualContext'],
  forbidden_non_consensual_context: ['nudity', 'sexualContext'],
  forbidden_self_harm_instruction: ['graphicInjury', 'sensitiveSignals'],
  forbidden_suicide_instruction: ['graphicInjury', 'sensitiveSignals'],
  forbidden_eating_disorder_instruction: ['sensitiveSignals'],
  forbidden_harmful_drug_instruction: ['sensitiveSignals'],
  forbidden_other_safety: ['graphicInjury', 'sensitiveSignals', 'possibleMinorConcern'],
  wrong_theme_or_label: ['nudity', 'sexualContext', 'graphicInjury', 'sensitiveSignals', 'possibleMinorConcern'],
  unclear_ai_result: ['nudity', 'sexualContext', 'graphicInjury', 'sensitiveSignals', 'possibleMinorConcern'],
};

const isValidAiDetectorLabel = (label) => Boolean(
  label
  && typeof label === 'object'
  && NUDITY_OPTIONS.some(([value]) => value === label.nudity)
  && SEXUAL_CONTEXT_OPTIONS.some(([value]) => value === label.sexualContext)
  && GRAPHIC_INJURY_OPTIONS.some(([value]) => value === label.graphicInjury)
  && Array.isArray(label.sensitiveSignals)
  && typeof label.possibleMinorConcern === 'boolean'
);

const selectClass = 'mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

function SelectField({ label, value = '', options, onChange }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">{label}</span>
      <select className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Niet bevestigd</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

export default function ModeratorLearningEvidenceFields({
  reasonCode,
  aiDetectorLabel = null,
  value = null,
  onChange,
}) {
  const fields = FIELD_PLANS_BY_REASON[reasonCode] || [];
  const validAiLabel = useMemo(() => isValidAiDetectorLabel(aiDetectorLabel), [aiDetectorLabel]);
  const confirmAiLabel = value?.confirmAiLabel === true;
  const visualEvidence = value?.visualEvidence && typeof value.visualEvidence === 'object'
    ? value.visualEvidence
    : {};

  if (!reasonCode || fields.length === 0) return null;

  const setVisualField = (field, nextValue) => {
    const nextEvidence = { ...visualEvidence };
    if (nextValue === '' || nextValue === undefined) delete nextEvidence[field];
    else nextEvidence[field] = nextValue;
    onChange?.({ visualEvidence: nextEvidence });
  };

  const toggleSensitiveSignal = (signal) => {
    const current = Array.isArray(visualEvidence.sensitiveSignals) ? visualEvidence.sensitiveSignals : [];
    const next = current.includes(signal)
      ? current.filter((item) => item !== signal)
      : [...current, signal];
    setVisualField('sensitiveSignals', next);
  };

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 space-y-3 dark:border-indigo-800/60 dark:bg-indigo-950/20">
      <div>
        <p className="text-xs font-semibold text-indigo-900 dark:text-indigo-100">Visuele waarneming voor leren</p>
        <p className="mt-1 text-[11px] leading-relaxed text-indigo-700 dark:text-indigo-200/80">
          Bevestig alleen wat je daadwerkelijk op de foto ziet. Onbevestigde velden worden niet ingevuld of geraden.
        </p>
      </div>

      {validAiLabel && (
        <label className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-white/70 p-2.5 text-xs font-semibold text-slate-700 dark:border-indigo-800 dark:bg-slate-900/60 dark:text-slate-100">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={confirmAiLabel}
            onChange={(event) => onChange?.(event.target.checked ? { confirmAiLabel: true } : null)}
          />
          <span>De concrete AI-waarneming klopt volledig</span>
        </label>
      )}

      {!confirmAiLabel && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {fields.includes('nudity') && (
            <SelectField
              label="Wat is zichtbaar?"
              value={visualEvidence.nudity || ''}
              options={NUDITY_OPTIONS}
              onChange={(nextValue) => setVisualField('nudity', nextValue)}
            />
          )}
          {fields.includes('sexualContext') && (
            <SelectField
              label="Seksuele context"
              value={visualEvidence.sexualContext || ''}
              options={SEXUAL_CONTEXT_OPTIONS}
              onChange={(nextValue) => setVisualField('sexualContext', nextValue)}
            />
          )}
          {fields.includes('graphicInjury') && (
            <SelectField
              label="Letsel"
              value={visualEvidence.graphicInjury || ''}
              options={GRAPHIC_INJURY_OPTIONS}
              onChange={(nextValue) => setVisualField('graphicInjury', nextValue)}
            />
          )}
          {fields.includes('possibleMinorConcern') && (
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">Mogelijke minderjarigheidszorg</span>
              <select
                className={selectClass}
                value={typeof visualEvidence.possibleMinorConcern === 'boolean' ? String(visualEvidence.possibleMinorConcern) : ''}
                onChange={(event) => {
                  if (!event.target.value) setVisualField('possibleMinorConcern', '');
                  else setVisualField('possibleMinorConcern', event.target.value === 'true');
                }}
              >
                <option value="">Niet bevestigd</option>
                <option value="false">Nee</option>
                <option value="true">Ja</option>
              </select>
            </label>
          )}
        </div>
      )}

      {!confirmAiLabel && fields.includes('sensitiveSignals') && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">Gevoelige signalen</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SENSITIVE_SIGNAL_OPTIONS.map(([signal, label]) => {
              const selected = Array.isArray(visualEvidence.sensitiveSignals) && visualEvidence.sensitiveSignals.includes(signal);
              return (
                <button
                  key={signal}
                  type="button"
                  onClick={() => toggleSensitiveSignal(signal)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${selected
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setVisualField('sensitiveSignals', [])}
            className="mt-2 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300"
          >
            Bevestig: geen van deze signalen
          </button>
        </div>
      )}
    </div>
  );
}
