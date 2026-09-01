export const ARTES_STAGING_PROJECT_ID = 'artes-staging';
export const ARTES_PRODUCTION_PROJECT_ID = 'artes-media-app';

const normalizeProjectId = (value) => String(value || '').trim();

export const getModerationLearningProjectDecision = (projectId) => {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) {
    return { allowed: false, projectId: null, reason: 'missing_project_id' };
  }
  if (normalizedProjectId === ARTES_PRODUCTION_PROJECT_ID) {
    return { allowed: false, projectId: normalizedProjectId, reason: 'production_project_forbidden' };
  }
  if (normalizedProjectId !== ARTES_STAGING_PROJECT_ID) {
    return { allowed: false, projectId: normalizedProjectId, reason: 'non_staging_project_forbidden' };
  }
  return { allowed: true, projectId: normalizedProjectId, reason: null };
};

export const assertModerationLearningStagingProject = (projectId) => {
  const decision = getModerationLearningProjectDecision(projectId);
  if (decision.allowed) return decision.projectId;

  const error = new Error(
    decision.reason === 'production_project_forbidden'
      ? `Moderation learning must never run against production project ${ARTES_PRODUCTION_PROJECT_ID}`
      : `Moderation learning requires staging project ${ARTES_STAGING_PROJECT_ID}`,
  );
  error.code = decision.reason;
  throw error;
};
