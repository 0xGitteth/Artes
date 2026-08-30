export const MODERATOR_DECISION_ACTIONS = new Set([
  'approveAsIs',
  'approveWithTaxonomyCorrection',
  'requestUserCorrection',
  'rejectForbidden',
]);

export const normalizeModeratorDecisionAction = (action, normalizedDecision) => {
  const fallback = normalizedDecision === 'approved' ? 'approveAsIs' : 'rejectForbidden';
  const normalized = String(action || '').trim() || fallback;
  if (!MODERATOR_DECISION_ACTIONS.has(normalized)) return null;
  return normalized;
};

const MODERATOR_APPROVAL_ACTIONS = new Set(['approveAsIs', 'approveWithTaxonomyCorrection', 'requestUserCorrection']);

export const isModeratorDecisionActionCompatible = (action, normalizedDecision) => {
  if (normalizedDecision === 'approved') return MODERATOR_APPROVAL_ACTIONS.has(action);
  if (normalizedDecision === 'rejected') return action === 'rejectForbidden';
  return false;
};

export const validateCorrectedTaxonomyForAction = (action, correctedTaxonomy = {}) => {
  const themes = Array.isArray(correctedTaxonomy?.themes) ? correctedTaxonomy.themes.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const triggers = Array.isArray(correctedTaxonomy?.triggers) ? correctedTaxonomy.triggers.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const requiresCorrection = action === 'approveWithTaxonomyCorrection' || action === 'requestUserCorrection';
  const isValid = !requiresCorrection || themes.length > 0 || triggers.length > 0;
  return { isValid, themes, triggers, requiresCorrection };
};
