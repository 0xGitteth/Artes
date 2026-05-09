import { AFFILIATION_STATUSES, normalizeAffiliationStatus } from './profileAffiliationStatus.js';

export const AFFILIATION_REQUEST_MESSAGE_TYPE = 'affiliationRequest';

export const AFFILIATION_REQUEST_LABELS = Object.freeze({
  agency: Object.freeze({
    role: 'Talent',
    remove: 'Verwijderen uit Talent',
    removeConfirm: 'Weet je zeker dat je dit profiel uit Talent wilt verwijderen?',
    pendingFallbackOrganization: 'de agency',
  }),
  company: Object.freeze({
    role: 'Team',
    remove: 'Verwijderen uit Team',
    removeConfirm: 'Weet je zeker dat je dit profiel uit Team wilt verwijderen?',
    pendingFallbackOrganization: 'het bedrijf',
  }),
});

const normalizeUid = (value) => String(value || '').trim();
const normalizeKind = (value) => (value === 'company' ? 'company' : 'agency');

export const getAffiliationRequestThreadId = (requesterUid, organizationUid) => {
  const pair = [normalizeUid(requesterUid), normalizeUid(organizationUid)].filter(Boolean).sort();
  if (pair.length !== 2) return '';
  return `dm_${pair.join('_')}`;
};

export const getAffiliationRequestMessageId = ({ requesterUid, organizationUid, affiliationType }) => {
  const type = normalizeKind(affiliationType);
  const requester = normalizeUid(requesterUid);
  const organization = normalizeUid(organizationUid);
  if (!requester || !organization) return '';
  return `affiliation_${type}_${requester}_${organization}`;
};

export const getAffiliationFields = (affiliationType) => {
  const type = normalizeKind(affiliationType);
  return type === 'company'
    ? { id: 'linkedCompanyId', name: 'linkedCompanyName', status: 'linkedCompanyStatus' }
    : { id: 'linkedAgencyId', name: 'linkedAgencyName', status: 'linkedAgencyStatus' };
};

export const buildAffiliationRequestText = ({ requesterName, organizationName, affiliationType }) => {
  const type = normalizeKind(affiliationType);
  const labels = AFFILIATION_REQUEST_LABELS[type];
  const requester = String(requesterName || 'Dit profiel').trim();
  const organization = String(organizationName || labels.pendingFallbackOrganization).trim();
  return `${requester} wil gekoppeld worden aan ${organization} als ${labels.role}.`;
};

export const buildAffiliationRequestMessagePayload = ({
  requesterUid,
  organizationUid,
  affiliationType,
  requesterName,
  organizationName,
  createdAt,
  updatedAt,
}) => {
  const type = normalizeKind(affiliationType);
  const text = buildAffiliationRequestText({ requesterName, organizationName, affiliationType: type });
  return {
    type: AFFILIATION_REQUEST_MESSAGE_TYPE,
    affiliationType: type,
    requesterUid: normalizeUid(requesterUid),
    organizationUid: normalizeUid(organizationUid),
    targetUid: normalizeUid(requesterUid),
    statusSnapshot: AFFILIATION_STATUSES.PENDING,
    text,
    senderUid: normalizeUid(requesterUid),
    senderId: normalizeUid(requesterUid),
    senderRole: 'system',
    createdAt,
    updatedAt,
  };
};

export const shouldCreateAffiliationRequestCard = ({ existing = {}, next = {}, affiliationType } = {}) => {
  const fields = getAffiliationFields(affiliationType);
  const previousId = normalizeUid(existing?.[fields.id]);
  const nextId = normalizeUid(next?.[fields.id]);
  const nextStatus = normalizeAffiliationStatus(next?.[fields.status]);
  if (!nextId || nextStatus !== AFFILIATION_STATUSES.PENDING) return false;
  if (previousId !== nextId) return true;
  const previousStatus = normalizeAffiliationStatus(existing?.[fields.status]);
  return previousStatus !== AFFILIATION_STATUSES.PENDING;
};

export const deriveAffiliationRequestCardState = ({ message = {}, requesterProfile = {}, viewerUid } = {}) => {
  const type = normalizeKind(message.affiliationType);
  const fields = getAffiliationFields(type);
  const labels = AFFILIATION_REQUEST_LABELS[type];
  const requesterUid = normalizeUid(message.requesterUid || message.targetUid);
  const organizationUid = normalizeUid(message.organizationUid);
  const linkedOrganizationUid = normalizeUid(requesterProfile?.[fields.id]);
  const profileStatus = normalizeAffiliationStatus(requesterProfile?.[fields.status]);
  const snapshotStatus = normalizeAffiliationStatus(message.statusSnapshot);
  const currentStatus = linkedOrganizationUid === organizationUid && profileStatus
    ? profileStatus
    : (linkedOrganizationUid
      ? snapshotStatus
      : ([AFFILIATION_STATUSES.REJECTED, AFFILIATION_STATUSES.REMOVED].includes(snapshotStatus)
        ? snapshotStatus
        : AFFILIATION_STATUSES.REMOVED));
  const isOwner = normalizeUid(viewerUid) === organizationUid && requesterUid !== normalizeUid(viewerUid);

  if (currentStatus === AFFILIATION_STATUSES.PENDING) {
    return {
      status: currentStatus,
      ownerCanApprove: isOwner,
      ownerCanReject: isOwner,
      ownerCanRemove: false,
      inactiveText: '',
      removeLabel: labels.remove,
      removeConfirm: labels.removeConfirm,
    };
  }

  if ([AFFILIATION_STATUSES.APPROVED, AFFILIATION_STATUSES.VERIFIED].includes(currentStatus)) {
    return {
      status: currentStatus,
      ownerCanApprove: false,
      ownerCanReject: false,
      ownerCanRemove: isOwner,
      inactiveText: '',
      removeLabel: labels.remove,
      removeConfirm: labels.removeConfirm,
    };
  }

  if (currentStatus === AFFILIATION_STATUSES.REJECTED) {
    return {
      status: currentStatus,
      ownerCanApprove: false,
      ownerCanReject: false,
      ownerCanRemove: false,
      inactiveText: 'De aanvraag is afgewezen.',
      removeLabel: labels.remove,
      removeConfirm: labels.removeConfirm,
    };
  }

  return {
    status: AFFILIATION_STATUSES.REMOVED,
    ownerCanApprove: false,
    ownerCanReject: false,
    ownerCanRemove: false,
    inactiveText: snapshotStatus === AFFILIATION_STATUSES.PENDING ? 'De aanvraag is ingetrokken.' : 'De koppeling is verwijderd.',
    removeLabel: labels.remove,
    removeConfirm: labels.removeConfirm,
  };
};
