import React from 'react';

const checkboxClassName = 'mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-900';

const AdultSubjectAttestationPrompt = ({
  state,
  onConfirmAge,
  onConfirmAnonymousConsent,
} = {}) => {
  if (!state?.attestationRequired || state?.humanReviewRequired) return null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="font-semibold">Leeftijd model bevestigen</div>
      <p className="mt-1">
        We kunnen de leeftijd van het model niet goed bevestigen. Bevestig dat alle afgebeelde modellen 18 jaar of ouder waren op het moment van de opname.
      </p>
      <label className="mt-3 flex items-start gap-2">
        <input
          type="checkbox"
          className={checkboxClassName}
          checked={Boolean(state.allDepictedSubjects18PlusConfirmed)}
          onChange={(event) => onConfirmAge?.(event.target.checked)}
        />
        <span>Ik bevestig dat alle afgebeelde modellen 18 jaar of ouder waren op het moment van de opname.</span>
      </label>

      {state.anonymousConsentConfirmationRequired && (
        <label className="mt-2 flex items-start gap-2">
          <input
            type="checkbox"
            className={checkboxClassName}
            checked={Boolean(state.anonymousSubjectPublicationConsentConfirmed)}
            onChange={(event) => onConfirmAnonymousConsent?.(event.target.checked)}
          />
          <span>Ik bevestig dat het anonieme model toestemming heeft gegeven voor het plaatsen van deze foto.</span>
        </label>
      )}
    </div>
  );
};

export default AdultSubjectAttestationPrompt;
