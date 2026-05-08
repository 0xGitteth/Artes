export const AFFILIATION_STATUSES = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REMOVED: 'removed',
  VERIFIED: 'verified',
});

const APPROVED_AFFILIATION_STATUSES = new Set([
  AFFILIATION_STATUSES.APPROVED,
  AFFILIATION_STATUSES.VERIFIED,
]);

export const normalizeAffiliationStatus = (status) => String(status || '').trim().toLowerCase();

export const isApprovedAffiliationStatus = (status) => (
  APPROVED_AFFILIATION_STATUSES.has(normalizeAffiliationStatus(status))
);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const normalizeId = (value) => (typeof value === 'string' ? value.trim() : value) || null;

const fieldNames = (kind) => ({
  id: kind === 'agency' ? 'linkedAgencyId' : 'linkedCompanyId',
  name: kind === 'agency' ? 'linkedAgencyName' : 'linkedCompanyName',
  status: kind === 'agency' ? 'linkedAgencyStatus' : 'linkedCompanyStatus',
  statusUpdatedAt: kind === 'agency' ? 'linkedAgencyStatusUpdatedAt' : 'linkedCompanyStatusUpdatedAt',
  approvedAt: kind === 'agency' ? 'linkedAgencyApprovedAt' : 'linkedCompanyApprovedAt',
  approvedBy: kind === 'agency' ? 'linkedAgencyApprovedBy' : 'linkedCompanyApprovedBy',
});

export const getAffiliationFieldNames = fieldNames;

export const applyAffiliationStatusTransition = ({
  incoming = {},
  existing = {},
  kind,
  timestamp = null,
  deleteValue = undefined,
} = {}) => {
  const fields = fieldNames(kind);
  const idWasProvided = hasOwn(incoming, fields.id);
  const nameWasProvided = hasOwn(incoming, fields.name);
  const statusWasProvided = hasOwn(incoming, fields.status);

  if (!idWasProvided && !nameWasProvided && !statusWasProvided) return {};

  const patch = {};
  const previousId = normalizeId(existing?.[fields.id]);
  const nextId = idWasProvided ? normalizeId(incoming?.[fields.id]) : previousId;
  const previousStatus = normalizeAffiliationStatus(existing?.[fields.status]);
  const nextStatus = normalizeAffiliationStatus(incoming?.[fields.status]);
  const organizationChanged = idWasProvided && nextId !== previousId;

  if (!nextId) {
    patch[fields.id] = null;
    patch[fields.name] = '';
    patch[fields.status] = deleteValue;
    patch[fields.statusUpdatedAt] = timestamp || deleteValue;
    patch[fields.approvedAt] = deleteValue;
    patch[fields.approvedBy] = deleteValue;
    return patch;
  }

  if (organizationChanged) {
    patch[fields.status] = AFFILIATION_STATUSES.PENDING;
    patch[fields.statusUpdatedAt] = timestamp;
    patch[fields.approvedAt] = deleteValue;
    patch[fields.approvedBy] = deleteValue;
    return patch;
  }

  if (isApprovedAffiliationStatus(previousStatus)) {
    patch[fields.status] = previousStatus;
    return patch;
  }

  if (nextStatus === AFFILIATION_STATUSES.PENDING) {
    patch[fields.status] = AFFILIATION_STATUSES.PENDING;
    patch[fields.statusUpdatedAt] = timestamp;
    return patch;
  }

  if (idWasProvided || statusWasProvided) {
    patch[fields.status] = AFFILIATION_STATUSES.PENDING;
    patch[fields.statusUpdatedAt] = timestamp;
  }

  return patch;
};

export const applyAffiliationStatusTransitions = (incoming = {}, existing = {}, options = {}) => ({
  ...applyAffiliationStatusTransition({ incoming, existing, kind: 'agency', ...options }),
  ...applyAffiliationStatusTransition({ incoming, existing, kind: 'company', ...options }),
});

export const getPublicAffiliationProjectionPatch = ({
  source = {},
  existingPublic = {},
  kind,
  deleteValue = undefined,
} = {}) => {
  const fields = fieldNames(kind);
  const hasAffiliationInput = [fields.id, fields.name, fields.status].some((field) => hasOwn(source, field));
  if (!hasAffiliationInput) return {};

  const patch = {};
  const id = normalizeId(hasOwn(source, fields.id) ? source?.[fields.id] : existingPublic?.[fields.id]);
  const name = hasOwn(source, fields.name) ? source?.[fields.name] : (existingPublic?.[fields.name] ?? '');
  const status = normalizeAffiliationStatus(hasOwn(source, fields.status) ? source?.[fields.status] : existingPublic?.[fields.status]);

  if (hasOwn(source, fields.id)) patch[fields.id] = id;
  if (hasOwn(source, fields.id) && !id) {
    patch[fields.name] = '';
  } else if (hasOwn(source, fields.name)) {
    patch[fields.name] = name || '';
  }

  if (id && status) {
    patch[fields.status] = status;
  } else {
    patch[fields.status] = deleteValue;
  }

  return patch;
};
