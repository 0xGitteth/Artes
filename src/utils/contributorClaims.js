/**
 * @typedef {'instagram' | 'domain' | 'email'} ContributorAliasType
 */

/**
 * @typedef {Object} Contributor
 * @property {string} id
 * @property {string} displayName
 * @property {string | null} instagramHandle
 * @property {string | null} website
 * @property {string | null} email
 * @property {import('firebase/firestore').Timestamp | null} createdAt
 * @property {import('firebase/firestore').Timestamp | null} updatedAt
 */

/**
 * @typedef {Object} ContributorAlias
 * @property {string} id
 * @property {ContributorAliasType} type
 * @property {string} value
 * @property {string} contributorId
 * @property {import('firebase/firestore').Timestamp | null} createdAt
 */

/**
 * @typedef {Object} ClaimRequest
 * @property {string} id
 * @property {string} requestedByUid
 * @property {string | null} contributorId
 * @property {string | null} aliasId
 * @property {'pending' | 'approved' | 'denied' | 'needsModeration'} status
 * @property {import('firebase/firestore').Timestamp | null} createdAt
 * @property {import('firebase/firestore').Timestamp | null} updatedAt
 */

const toStringValue = (value) => String(value ?? '').trim();

/**
 * Normalize an Instagram handle to a lowercase string without leading @.
 * @param {string} handle
 * @returns {string}
 */
export const normalizeInstagram = (handle) => {
  const cleaned = toStringValue(handle).replace(/^@+/, '').toLowerCase();
  return cleaned.replace(/[^a-z0-9_.]/g, '');
};

/**
 * Normalize a domain or URL to a lowercase hostname without www.
 * @param {string} urlOrDomain
 * @returns {string}
 */
export const normalizeDomain = (urlOrDomain) => {
  const raw = toStringValue(urlOrDomain).toLowerCase();
  if (!raw) return '';
  const withProtocol = raw.includes('://') ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.replace(/^www\./, '');
    return hostname;
  } catch (error) {
    return raw.replace(/^www\./, '').split('/')[0];
  }
};

/**
 * Normalize an email address to lowercase.
 * @param {string} email
 * @returns {string}
 */
export const normalizeEmail = (email) => toStringValue(email).toLowerCase();

/**
 * Build a Firestore alias document id.
 * @param {ContributorAliasType} type
 * @param {string} value
 * @returns {string}
 */
export const makeAliasId = (type, value) => `${type}:${toStringValue(value).toLowerCase()}`;

/**
 * Normalize alias values by type.
 * @param {ContributorAliasType} type
 * @param {string} rawValue
 * @returns {string}
 */
export const normalizeAliasValue = (type, rawValue) => {
  if (type === 'instagram') return normalizeInstagram(rawValue);
  if (type === 'domain') return normalizeDomain(rawValue);
  if (type === 'email') return normalizeEmail(rawValue);
  return toStringValue(rawValue).toLowerCase();
};
