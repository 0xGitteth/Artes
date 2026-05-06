import { getCreditMakerFunction } from './uploadConsent.js';
import { getRoleLabel } from './roles.js';

const SELF_PORTRAIT_ROLES = new Set(['model']);
const OWN_WORK_ROLES = new Set(['mua', 'stylist', 'hair']);
const BEELD_DOOR_ROLES = new Set(['company', 'agency']);

const getCreditName = (credit = {}, roleLabel = '') => {
  if (credit.isAnonymous && roleLabel === 'Beeld door') return 'Anonieme maker';
  if (credit.name) return credit.name;
  if (credit.isAnonymous) return 'Anoniem';
  return 'Onbekend';
};

const hasStructuredCredit = (credit) => Boolean(credit && (credit.role || credit.name || credit.uid || credit.contributorId || credit.isAnonymous));

const getCreditDisplayLabels = (credit = {}) => {
  const role = credit.role || 'maker';
  const makerFunction = getCreditMakerFunction(credit);

  if (makerFunction && (credit.isAnonymous || BEELD_DOOR_ROLES.has(role))) {
    return { roleLabel: 'Beeld door', secondaryLabel: '' };
  }

  if (makerFunction && SELF_PORTRAIT_ROLES.has(role)) {
    return { roleLabel: getRoleLabel(role), secondaryLabel: 'Zelfportret' };
  }

  if (makerFunction && OWN_WORK_ROLES.has(role)) {
    return { roleLabel: getRoleLabel(role), secondaryLabel: 'Eigen werk' };
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
        role: post.authorRole || 'maker',
        name: post.authorName || 'Onbekend',
        uid: post.authorId || null,
        isLegacyAuthorFallback: true,
      }]
      : [];

    return [...fallbackAuthorCredit, ...credits].map((credit, index) => {
      const { roleLabel, secondaryLabel } = getCreditDisplayLabels(credit);

      return {
        key: `${credit.uid || credit.contributorId || credit.name || credit.role || 'credit'}-${index}`,
        role: credit.role || 'maker',
        roleLabel,
        secondaryLabel,
        name: getCreditName(credit, roleLabel),
        uid: credit.uid || null,
        contributorId: credit.contributorId || null,
        isAnonymous: Boolean(credit.isAnonymous),
        isLegacyAuthorFallback: Boolean(credit.isLegacyAuthorFallback),
        rawCredit: credit,
      };
    });
  }

  if (post.authorName || post.authorId) {
    return [{
      key: `legacy-author-${post.authorId || post.authorName}`,
      role: post.authorRole || 'maker',
      roleLabel: getRoleLabel(post.authorRole || 'maker'),
      secondaryLabel: '',
      name: post.authorName || 'Onbekend',
      uid: post.authorId || null,
      contributorId: null,
      isAnonymous: false,
      isLegacyAuthorFallback: true,
      rawCredit: null,
    }];
  }

  return [];
};
