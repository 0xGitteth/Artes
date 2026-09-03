const clean = (value) => String(value || '').trim();

const DEFAULT_BLOCKED_PLATFORMS = new Set(['pexels', 'unsplash', 'wikipedia', 'wikimedia', 'wikimedia commons']);
const BLOCKED_RIGHTS = new Set([
  'all_rights_reserved',
  'unknown',
  'unverified',
  'pending',
  'noncommercial_restriction',
]);

export const assessExternalImageTrainingEligibility = ({
  sourcePlatform,
  copyrightLicenseVerified = false,
  rightsStatus,
  explicitAiTrainingPermission = false,
  recognizableHuman = false,
  adultStatus,
  modelRightsStatus,
  sourceIsOriginalCreatorLocation = false,
} = {}) => {
  const reasons = [];
  const platform = clean(sourcePlatform).toLowerCase();
  const normalizedRights = clean(rightsStatus).toLowerCase();
  const normalizedAdult = clean(adultStatus).toLowerCase();
  const normalizedModelRights = clean(modelRightsStatus).toLowerCase();

  if (!sourceIsOriginalCreatorLocation) reasons.push('original_creator_source_required');

  if (DEFAULT_BLOCKED_PLATFORMS.has(platform) && !explicitAiTrainingPermission) {
    reasons.push('source_platform_ml_use_not_cleared');
  }

  if (!copyrightLicenseVerified && !explicitAiTrainingPermission) {
    reasons.push('copyright_license_not_verified');
  }

  if (BLOCKED_RIGHTS.has(normalizedRights)) {
    reasons.push(`rights_status_blocked:${normalizedRights || 'unknown'}`);
  }

  if (recognizableHuman) {
    if (!['verified_adult', 'verified_over_21_by_source'].includes(normalizedAdult)) {
      reasons.push('recognizable_human_adult_status_not_verified');
    }
    if (!['verified', 'self_subject', 'creator_subject_owned', 'explicit_release'].includes(normalizedModelRights)) {
      reasons.push('recognizable_human_model_rights_not_verified');
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
  };
};

export const assertExternalImageTrainingEligible = (candidate) => {
  const assessment = assessExternalImageTrainingEligibility(candidate);
  if (!assessment.eligible) {
    const error = new Error(`external_image_not_training_eligible:${assessment.reasons.join(',')}`);
    error.code = 'external_image_not_training_eligible';
    error.reasons = assessment.reasons;
    throw error;
  }
  return true;
};
