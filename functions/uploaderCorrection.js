export const UPLOADER_CORRECTION_ACTIONS = new Set(['acceptCorrection', 'rejectCorrection']);

const BLOCKED_OUTCOMES = new Set(['forbidden', 'explicit', 'reported', 'nocorrectionforbidden']);
const BLOCKED_CLASSIFICATIONS = new Set(['reviewrequired', 'sensitivecorrection', 'review_required']);

export function normalizeTaxonomy(taxonomy = {}) {
  const themes = Array.isArray(taxonomy?.themes) ? taxonomy.themes.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const triggers = Array.isArray(taxonomy?.triggers) ? taxonomy.triggers.map((x) => String(x || '').trim()).filter(Boolean) : [];
  return { themes, triggers };
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
  if (upload?.requiresUploaderAcceptance !== true || upload?.publicationStatus !== 'needs_user_correction') {
    return { ok: false, error: 'Upload does not require uploader correction acceptance', status: 409 };
  }
  const moderatorAction = String(upload?.moderatorDecision?.action || '').trim();
  if (moderatorAction !== 'requestUserCorrection') {
    return { ok: false, error: 'Correction is not linked to a valid moderator request', status: 409 };
  }

  const corrected = normalizeTaxonomy(upload?.correctedTaxonomy || upload?.moderatorDecision?.correctedTaxonomy || {});
  if (corrected.themes.length === 0 && corrected.triggers.length === 0) {
    return { ok: false, error: 'correctedTaxonomy is missing', status: 409 };
  }

  const outcome = String(upload?.outcome || '').trim().toLowerCase();
  const classification = String(upload?.classification || '').trim().toLowerCase();
  const shouldReview = upload?.shouldReview === true;
  if (BLOCKED_OUTCOMES.has(outcome) || BLOCKED_CLASSIFICATIONS.has(classification) || shouldReview) {
    return { ok: false, error: 'Upload is blocked by moderation policy', status: 409 };
  }

  return { ok: true, action: normalizedAction, correctedTaxonomy: corrected };
}
