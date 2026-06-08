import { getCreditMakerFunction } from './uploadConsent.js';
import { getRoleLabel, normalizeRoleValue } from './roles.js';

const SELF_PORTRAIT_ROLES = new Set(['model']);
const OWN_WORK_ROLES = new Set(['mua', 'stylist', 'hair']);
const BEELD_DOOR_ROLES = new Set(['company', 'agency']);

const ANONYMOUS_FALLBACK_NAME = 'Anonieme bijdrager';
const ANONYMOUS_DISPLAY_NAMES = new Set([
  ANONYMOUS_FALLBACK_NAME,
  'Anoniem model',
  'Anonieme fotograaf',
]);
const ANONYMOUS_ROLE_FALLBACKS = {
  model: { roleLabel: 'Model', name: 'Anoniem model' },
  photographer: { roleLabel: 'Fotograaf', name: 'Anonieme fotograaf' },
};

export const hasAnonymousCreditFlag = (credit = {}) => Boolean(
  credit?.isAnonymous === true
    || credit?.anonymous === true
    || credit?.anonymousMode === true
    || credit?.isAnonymousContributor === true
    || credit?.mode === 'anonymous'
    || credit?.creditType === 'anonymous'
    || credit?.type === 'anonymous'
    || credit?.consentStatus === 'anonymous',
);

const hasAnonymousDisplayName = (credit = {}) => {
  const displayName = String(credit?.displayName || credit?.name || '').trim();
  return ANONYMOUS_DISPLAY_NAMES.has(displayName);
};

export const isLegacyAnonymousContributorCredit = (credit = {}) => hasAnonymousDisplayName(credit);

export const isAnonymousContributorCredit = (credit = {}) => (
  hasAnonymousCreditFlag(credit) || isLegacyAnonymousContributorCredit(credit)
);

export const getAnonymousCreditDisplay = (roleValue) => {
  const role = normalizeRoleValue(roleValue);
  return ANONYMOUS_ROLE_FALLBACKS[role] || { roleLabel: 'Bijdrager', name: ANONYMOUS_FALLBACK_NAME };
};

export const isClaimableTemporaryContributor = (candidate = {}) => Boolean(
  candidate?.contributorId
    && !hasAnonymousDisplayName(candidate)
    && !isAnonymousContributorCredit(candidate),
);

export const isAnonymousDisplayOnlyShadowProfile = ({ name = '', displayName = '', isAnonymous = false } = {}) => {
  if (isAnonymous === true) return true;
  const candidateName = String(displayName || name || '').trim();
  return ANONYMOUS_DISPLAY_NAMES.has(candidateName);
};


const getCreditName = (credit = {}, roleLabel = '') => {
  if (isAnonymousContributorCredit(credit)) {
    return getAnonymousCreditDisplay(credit.role).name;
  }
  if (credit.name) return String(credit.name);
  if (credit.displayName) return String(credit.displayName);
  return 'Onbekend';
};

const hasStructuredCredit = (credit) => Boolean(credit && (credit.role || credit.name || credit.displayName || credit.uid || credit.userId || credit.profileId || credit.contributorId || hasAnonymousCreditFlag(credit)));

const getCreditDisplayLabels = (credit = {}) => {
  const role = normalizeRoleValue(credit.role, 'maker');
  const makerFunction = getCreditMakerFunction({ ...credit, role });
  const isSelf = Boolean(credit.isSelf);

  if (makerFunction && BEELD_DOOR_ROLES.has(role)) {
    return { roleLabel: 'Beeld door', secondaryLabel: '' };
  }

  if (isSelf && role === 'model' && credit.isMaker === true && credit.selfPortrait === true) {
    return { roleLabel: getRoleLabel(role), secondaryLabel: 'Zelfportret' };
  }

  if (makerFunction && OWN_WORK_ROLES.has(role)) {
    return { roleLabel: getRoleLabel(role), secondaryLabel: 'Eigen werk' };
  }

  if (isAnonymousContributorCredit(credit)) {
    return { roleLabel: getAnonymousCreditDisplay(role).roleLabel, secondaryLabel: '' };
  }

  return { roleLabel: getRoleLabel(role), secondaryLabel: '' };
};

export const getPostCreditRows = (post = {}) => {
  const credits = Array.isArray(post.credits) ? post.credits.filter(hasStructuredCredit) : [];

  if (credits.length > 0) {
    const hasAuthorCredit = credits.some((credit) => Boolean(
      credit?.isSelf
        || (post.authorId && credit?.uid === post.authorId)
        || (post.authorName && credit?.name === post.authorName),
    ));

    const fallbackAuthorCredit = !hasAuthorCredit && (post.authorName || post.authorId)
      ? [{
        role: normalizeRoleValue(post.authorRole, 'maker'),
        name: post.authorName || 'Onbekend',
        uid: post.authorId || null,
        isLegacyAuthorFallback: true,
      }]
      : [];

    return [...fallbackAuthorCredit, ...credits].map((credit, index) => {
      const { roleLabel, secondaryLabel } = getCreditDisplayLabels(credit);
      const explicitCreditName = String(credit.name || credit.displayName || '').trim();

      return {
        key: `${credit.uid || credit.userId || credit.profileId || credit.contributorId || credit.name || credit.displayName || normalizeRoleValue(credit.role) || 'credit'}-${index}`,
        role: normalizeRoleValue(credit.role, 'maker'),
        roleLabel,
        secondaryLabel,
        name: getCreditName(credit, roleLabel),
        uid: credit.uid || credit.userId || credit.profileId || null,
        contributorId: isAnonymousContributorCredit(credit) ? null : (credit.contributorId || null),
        isAnonymous: isAnonymousContributorCredit(credit),
        canOpenShadowByName: !credit.isLegacyAuthorFallback && Boolean(explicitCreditName),
        isLegacyAuthorFallback: Boolean(credit.isLegacyAuthorFallback),
        rawCredit: credit,
      };
    });
  }

  if (post.authorName || post.authorId) {
    const fallbackRole = normalizeRoleValue(post.authorRole, 'maker');
    const fallbackSecondaryLabel = '';

    return [{
      key: `legacy-author-${post.authorId || post.authorName}`,
      role: fallbackRole,
      roleLabel: getRoleLabel(fallbackRole),
      secondaryLabel: fallbackSecondaryLabel,
      name: post.authorName || 'Onbekend',
      uid: post.authorId || null,
      contributorId: null,
      isAnonymous: false,
      canOpenShadowByName: false,
      isLegacyAuthorFallback: true,
      rawCredit: null,
    }];
  }

  return [];
};
