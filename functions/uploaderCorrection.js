export const UPLOADER_CORRECTION_ACTIONS = new Set(['acceptCorrection', 'rejectCorrection']);

const BLOCKED_OUTCOMES = new Set(['forbidden', 'explicit', 'reported', 'nocorrectionforbidden']);
const BLOCKED_CLASSIFICATIONS = new Set(['reviewrequired', 'sensitivecorrection', 'review_required']);
const ART_NUDE_THEME = 'Art Nude';
const ADULT_ART_NUDE_TRIGGER = 'adultArtNude';
const ADULT_EROTIC_SUGGESTIVE_TRIGGER = 'adultEroticSuggestive';
const KINK_BDSM_TRIGGER = 'kinkBdsm';

const PRESERVED_POLICY_SAFETY_TRIGGERS = new Set([
  'bloodInjury',
  'selfHarm',
  'suicide',
  'eatingDisorder',
  'substanceDistress',
  'violence',
  'horrorScare',
  'adultGraphicSensitive',
]);

const extractTriggerKey = (item) => String(
  typeof item === 'string' ? item : item?.trigger || ''
).trim();

const isPolicyOwnedTriggerRecord = (item) => {
  if (!item || typeof item !== 'object') return false;
  const source = String(item.source || '').trim().toLowerCase();
  return source.startsWith('policy')
    || source === 'moderatorcorrection'
    || source === 'acceptedcorrection';
};

export function buildAcceptedCorrectionModerationState() {
  return {
    outcome: 'allowed',
    forbiddenReasons: [],
    shouldReview: false,
    publishBlocked: false,
    canRequestReview: false,
  };
}

export function normalizeTaxonomy(taxonomy = {}) {
  const themes = Array.isArray(taxonomy?.themes) ? taxonomy.themes.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const triggers = Array.isArray(taxonomy?.triggers) ? taxonomy.triggers.map((x) => String(x || '').trim()).filter(Boolean) : [];
  return { themes, triggers };
}

const appendUnique = (items, value) => (items.includes(value) ? items : [...items, value]);

export function deriveMandatoryAccessTriggers({ themes = [], triggers = [] } = {}) {
  const normalized = normalizeTaxonomy({ themes, triggers });
  let required = [...normalized.triggers];
  if (normalized.themes.includes(ART_NUDE_THEME)) {
    required = appendUnique(required, ADULT_ART_NUDE_TRIGGER);
  }
  if (normalized.triggers.includes(KINK_BDSM_TRIGGER)) {
    required = appendUnique(required, ADULT_EROTIC_SUGGESTIVE_TRIGGER);
  }
  return required;
}


export function deriveAcceptedCorrectionAppliedTriggers({ upload = {}, themes = [], triggers = [] } = {}) {
  let required = deriveMandatoryAccessTriggers({ themes, triggers });
  const policyAppliedTriggers = Array.isArray(upload?.policyAppliedTriggers) ? upload.policyAppliedTriggers : [];
  policyAppliedTriggers.forEach((item) => {
    const trigger = extractTriggerKey(item);
    if (!PRESERVED_POLICY_SAFETY_TRIGGERS.has(trigger) || !isPolicyOwnedTriggerRecord(item)) return;
    required = appendUnique(required, trigger);
  });
  return required;
}

export function applyAutomaticModeratorCorrectionToPostDraft({ upload = {}, postDraft = {} } = {}) {
  const moderatorAction = String(upload?.moderatorDecision?.action || '').trim();
  const automaticModeratorCorrection = moderatorAction === 'approveWithTaxonomyCorrection';
  const acceptedUploaderCorrection = upload?.uploaderCorrectionResponse?.status === 'accepted'
    || Boolean(upload?.correction?.userAcceptedAt);
  const correctionIsAuthoritative = automaticModeratorCorrection || acceptedUploaderCorrection;
  let nextPostDraft = { ...postDraft };

  if (automaticModeratorCorrection) {
    const rawCorrectedTaxonomy = upload?.correctedTaxonomy || upload?.moderatorDecision?.correctedTaxonomy || {};
    const correctedTaxonomy = normalizeTaxonomy(rawCorrectedTaxonomy);
    const baselineTaxonomy = normalizeTaxonomy(upload?.userSelectedTaxonomy || {
      themes: upload?.postDraft?.styles || upload?.postDraft?.themes,
      triggers: upload?.postDraft?.makerTags,
    });
    const themes = correctedTaxonomy.themes.length > 0 ? correctedTaxonomy.themes : baselineTaxonomy.themes;
    const triggers = Array.isArray(rawCorrectedTaxonomy?.triggers) ? correctedTaxonomy.triggers : baselineTaxonomy.triggers;
    nextPostDraft = {
      ...nextPostDraft,
      styles: themes,
      makerTags: triggers,
    };
  }

  const effectiveThemes = Array.isArray(nextPostDraft?.styles) ? nextPostDraft.styles : nextPostDraft?.themes;
  const effectiveMakerTags = Array.isArray(nextPostDraft?.makerTags) ? nextPostDraft.makerTags : [];
  const existingAppliedTriggers = Array.isArray(nextPostDraft?.appliedTriggers) ? nextPostDraft.appliedTriggers : [];
  const mandatoryAppliedTriggers = deriveMandatoryAccessTriggers({ themes: effectiveThemes, triggers: effectiveMakerTags });
  const acceptedCorrectionAppliedTriggers = deriveAcceptedCorrectionAppliedTriggers({
    upload,
    themes: effectiveThemes,
    triggers: effectiveMakerTags,
  });
  return {
    ...nextPostDraft,
    appliedTriggers: correctionIsAuthoritative
      ? acceptedCorrectionAppliedTriggers
      : Array.from(new Set([...existingAppliedTriggers, ...mandatoryAppliedTriggers])),
  };
}

export function validateUploaderCorrectionAction({ action, upload = {}, userId }) {
  const normalizedAction = String(action || '').trim();
  if (!UPLOADER_CORRECTION_ACTIONS.has(normalizedAction)) {
    return { ok: false, error: 'Invalid action' };
  }
  const uploadOwnerId = upload?.userId || upload?.ownerUid || upload?.userUid || null;
  if (!uploadOwnerId || uploadOwnerId !== userId) {
    return { ok: false, error: 'Not authorized for this action', status: 403 };
  }
  if (upload?.requiresUploaderAcceptance !== true
    || upload?.publicationStatus !== 'needs_user_correction'
    || upload?.reviewStatus !== 'needs_user_correction') {
    return { ok: false, error: 'Upload does not require uploader correction acceptance', status: 409 };
  }
  const moderatorAction = String(upload?.moderatorDecision?.action || '').trim();
  if (moderatorAction !== 'requestUserCorrection') {
    return { ok: false, error: 'Correction is not linked to a valid moderator request', status: 409 };
  }

  const rawCorrectedTaxonomy = upload?.correctedTaxonomy || upload?.moderatorDecision?.correctedTaxonomy || {};
  const corrected = normalizeTaxonomy(rawCorrectedTaxonomy);
  const baseline = normalizeTaxonomy(upload?.userSelectedTaxonomy || {
    themes: upload?.postDraft?.styles || upload?.postDraft?.themes || upload?.themes,
    triggers: upload?.postDraft?.makerTags || upload?.makerTags,
  });
  const effectiveCorrectedTaxonomy = {
    themes: corrected.themes.length > 0 ? corrected.themes : baseline.themes,
    triggers: Array.isArray(rawCorrectedTaxonomy?.triggers) ? corrected.triggers : baseline.triggers,
  };
  if (effectiveCorrectedTaxonomy.themes.length === 0 && effectiveCorrectedTaxonomy.triggers.length === 0) {
    return { ok: false, error: 'correctedTaxonomy is missing', status: 409 };
  }

  const outcome = String(upload?.outcome || '').trim().toLowerCase();
  const classification = String(upload?.classification || '').trim().toLowerCase();
  const shouldReview = upload?.shouldReview === true;
  if (BLOCKED_OUTCOMES.has(outcome) || BLOCKED_CLASSIFICATIONS.has(classification) || shouldReview) {
    return { ok: false, error: 'Upload is blocked by moderation policy', status: 409 };
  }

  return { ok: true, action: normalizedAction, correctedTaxonomy: effectiveCorrectedTaxonomy };
}

const normalizeCorrectionValues = (items) => Array.from(new Set(
  (Array.isArray(items) ? items : [])
    .map((item) => String(typeof item === 'string' ? item : item?.trigger || '').trim())
    .filter(Boolean)
)).sort();

const sameCorrectionValues = (left, right) => (
  JSON.stringify(normalizeCorrectionValues(left)) === JSON.stringify(normalizeCorrectionValues(right))
);

const includesAllCorrectionValues = (items, requiredItems) => {
  const actual = new Set(normalizeCorrectionValues(items));
  return normalizeCorrectionValues(requiredItems).every((item) => actual.has(item));
};

export function validateAcceptedCorrectionPublicationTaxonomy({ upload = {}, postDraft = {} } = {}) {
  const moderatorAction = String(upload?.moderatorDecision?.action || '').trim();
  const automaticModeratorCorrection = moderatorAction === 'approveWithTaxonomyCorrection';
  const accepted = automaticModeratorCorrection
    || upload?.uploaderCorrectionResponse?.status === 'accepted'
    || Boolean(upload?.correction?.userAcceptedAt);
  if (!accepted) return { ok: true, enforced: false };

  const correction = upload?.correction && typeof upload.correction === 'object' ? upload.correction : {};
  const rawCorrectedTaxonomy = upload?.correctedTaxonomy || upload?.moderatorDecision?.correctedTaxonomy || {};
  const correctedTaxonomy = normalizeTaxonomy(rawCorrectedTaxonomy);
  const baselineTaxonomy = normalizeTaxonomy(upload?.userSelectedTaxonomy || {
    themes: upload?.postDraft?.styles || upload?.postDraft?.themes,
    triggers: upload?.postDraft?.makerTags,
  });
  const automaticThemes = correctedTaxonomy.themes.length > 0 ? correctedTaxonomy.themes : baselineTaxonomy.themes;
  const automaticTriggers = Array.isArray(rawCorrectedTaxonomy?.triggers) ? correctedTaxonomy.triggers : baselineTaxonomy.triggers;
  const acceptedThemes = automaticModeratorCorrection
    ? automaticThemes
    : (Array.isArray(correction.finalAcceptedThemes) ? correction.finalAcceptedThemes : correctedTaxonomy.themes);
  const acceptedTriggers = automaticModeratorCorrection
    ? automaticTriggers
    : (Array.isArray(correction.finalAcceptedTriggers) ? correction.finalAcceptedTriggers : correctedTaxonomy.triggers);
  const mandatoryAppliedTriggers = deriveAcceptedCorrectionAppliedTriggers({
    upload,
    themes: acceptedThemes,
    triggers: acceptedTriggers,
  });
  const draftThemes = Array.isArray(postDraft?.styles) ? postDraft.styles : postDraft?.themes;
  const draftMakerTags = postDraft?.makerTags;
  const draftAppliedTriggers = postDraft?.appliedTriggers;

  const matches = sameCorrectionValues(draftThemes, acceptedThemes)
    && sameCorrectionValues(draftMakerTags, acceptedTriggers)
    && sameCorrectionValues(draftAppliedTriggers, mandatoryAppliedTriggers);
  if (!matches) {
    return {
      ok: false,
      enforced: true,
      status: 409,
      code: 'accepted_correction_taxonomy_mismatch',
      error: 'Accepted moderator correction taxonomy changed',
    };
  }
  return {
    ok: true,
    enforced: true,
    acceptedTaxonomy: {
      themes: normalizeCorrectionValues(acceptedThemes),
      triggers: normalizeCorrectionValues(acceptedTriggers),
      appliedTriggers: normalizeCorrectionValues(mandatoryAppliedTriggers),
    },
  };
}

export function buildModeratedPublicationTaxonomy({ upload = {}, postDraft = {} } = {}) {
  const acceptedCorrection = validateAcceptedCorrectionPublicationTaxonomy({ upload, postDraft });
  if (!acceptedCorrection.ok) return acceptedCorrection;
  if (acceptedCorrection.enforced) {
    return {
      ok: true,
      enforced: true,
      ...acceptedCorrection.acceptedTaxonomy,
    };
  }

  const rawBaseline = upload?.userSelectedTaxonomy;
  if (!rawBaseline || typeof rawBaseline !== 'object'
    || !Array.isArray(rawBaseline.themes)
    || !Array.isArray(rawBaseline.triggers)) {
    return {
      ok: false,
      enforced: true,
      status: 409,
      code: 'moderated_taxonomy_missing',
      error: 'Moderated uploader taxonomy is missing',
    };
  }

  const baseline = normalizeTaxonomy(rawBaseline);
  const submitted = normalizeTaxonomy({
    themes: Array.isArray(postDraft?.styles) ? postDraft.styles : postDraft?.themes,
    triggers: postDraft?.makerTags,
  });
  if (!sameCorrectionValues(submitted.themes, baseline.themes)
    || !sameCorrectionValues(submitted.triggers, baseline.triggers)) {
    return {
      ok: false,
      enforced: true,
      status: 409,
      code: 'moderated_taxonomy_mismatch',
      error: 'Publication taxonomy differs from the moderated uploader taxonomy',
    };
  }

  let mandatoryAppliedTriggers = deriveMandatoryAccessTriggers(baseline);
  (Array.isArray(upload?.policyAppliedTriggers) ? upload.policyAppliedTriggers : []).forEach((item) => {
    if (!isPolicyOwnedTriggerRecord(item)) return;
    const trigger = extractTriggerKey(item);
    if (trigger) mandatoryAppliedTriggers = appendUnique(mandatoryAppliedTriggers, trigger);
  });

  const allowedExtraTriggerSet = new Set([
    ...baseline.triggers,
    ...normalizeCorrectionValues(upload?.suggestedTriggers),
    ...mandatoryAppliedTriggers,
  ]);
  const requestedAppliedTriggers = normalizeCorrectionValues(postDraft?.appliedTriggers)
    .filter((trigger) => allowedExtraTriggerSet.has(trigger));
  mandatoryAppliedTriggers.forEach((trigger) => {
    if (!requestedAppliedTriggers.includes(trigger)) requestedAppliedTriggers.push(trigger);
  });

  return {
    ok: true,
    enforced: true,
    themes: normalizeCorrectionValues(baseline.themes),
    triggers: normalizeCorrectionValues(baseline.triggers),
    appliedTriggers: normalizeCorrectionValues(requestedAppliedTriggers),
  };
}
