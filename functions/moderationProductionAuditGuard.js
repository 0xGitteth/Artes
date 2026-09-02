export const MODERATION_PRODUCTION_PROJECT_ID = 'artes-media-app';

export const assertModerationProductionAuditProject = (projectId) => {
  const normalized = String(projectId || '').trim();
  if (!normalized) throw new Error('production_audit_project_missing');
  if (normalized !== MODERATION_PRODUCTION_PROJECT_ID) {
    throw new Error(`production_audit_project_forbidden:${normalized}`);
  }
  return normalized;
};

export const assertProductionAuditReadOnlyOptions = ({ limit, collection = 'moderationExamples' } = {}) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error('production_audit_invalid_limit');
  }
  if (collection !== 'moderationExamples') {
    throw new Error(`production_audit_collection_forbidden:${collection}`);
  }
  return { limit, collection };
};
