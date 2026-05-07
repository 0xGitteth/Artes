import { ROLE_OPTIONS, getRoleLabel } from './roles.js';

export const ALL_PROFILE_PORTFOLIO_TAB = 'all';

const ROLE_ORDER = new Map(ROLE_OPTIONS.map((role, index) => [role.id, index]));

const isStructuredCredit = (credit) => Boolean(
  credit && (credit.role || credit.uid || credit.contributorId || credit.authorId || credit.isSelf),
);

const uniqueRoleKeys = (roles = []) => Array.from(new Set(
  roles
    .map((role) => String(role || '').trim())
    .filter(Boolean),
));

const getProfileUid = (profileUser = {}) => profileUser?.uid || profileUser?.id || null;
const getProfileContributorId = (profileUser = {}) => profileUser?.contributorId || null;
const getEligibleProfileRoleKeys = (profileUser = {}) => new Set(uniqueRoleKeys(
  Array.isArray(profileUser?.roles) ? profileUser.roles : [],
));

const sortRoleKeys = (roleKeys = [], profileUser = {}) => {
  const profileRoleOrder = new Map(uniqueRoleKeys(
    Array.isArray(profileUser?.roles) ? profileUser.roles : [],
  ).map((role, index) => [role, index]));

  return [...roleKeys].sort((a, b) => {
    const aProfileIndex = profileRoleOrder.has(a) ? profileRoleOrder.get(a) : Number.POSITIVE_INFINITY;
    const bProfileIndex = profileRoleOrder.has(b) ? profileRoleOrder.get(b) : Number.POSITIVE_INFINITY;
    if (aProfileIndex !== bProfileIndex) return aProfileIndex - bProfileIndex;

    const aIndex = ROLE_ORDER.has(a) ? ROLE_ORDER.get(a) : Number.POSITIVE_INFINITY;
    const bIndex = ROLE_ORDER.has(b) ? ROLE_ORDER.get(b) : Number.POSITIVE_INFINITY;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return getRoleLabel(a).localeCompare(getRoleLabel(b), 'nl');
  });
};

const creditMatchesProfileUser = (credit = {}, post = {}, profileUser = {}) => {
  const profileUid = getProfileUid(profileUser);
  const profileContributorId = getProfileContributorId(profileUser);

  if (profileUid && credit.uid === profileUid) return true;
  if (profileUid && credit.authorId === profileUid) return true;
  if (profileContributorId && credit.contributorId === profileContributorId) return true;

  return Boolean(credit.isSelf && profileUid && post.authorId === profileUid);
};

const getLegacyProfilePostRoleKeys = (post = {}, profileUser = {}) => {
  const profileUid = getProfileUid(profileUser);
  if (!profileUid || post.authorId !== profileUid) return [];

  const eligibleRoles = getEligibleProfileRoleKeys(profileUser);
  const postAuthorRole = String(post.authorRole || '').trim();
  if (postAuthorRole) return eligibleRoles.has(postAuthorRole) ? [postAuthorRole] : [];

  return uniqueRoleKeys(Array.isArray(profileUser.roles) ? profileUser.roles : []).slice(0, 1);
};

export const getProfilePostRoleKeys = (post = {}, profileUser = {}) => {
  const eligibleRoles = getEligibleProfileRoleKeys(profileUser);
  if (eligibleRoles.size === 0) return [];

  const credits = Array.isArray(post?.credits) ? post.credits.filter(isStructuredCredit) : [];

  if (credits.length > 0) {
    return uniqueRoleKeys(
      credits
        .filter((credit) => creditMatchesProfileUser(credit, post, profileUser))
        .map((credit) => credit.role)
        .filter((role) => eligibleRoles.has(role)),
    );
  }

  return getLegacyProfilePostRoleKeys(post, profileUser);
};

export const getEligibleProfilePosts = (posts = [], profileUser = {}) => (Array.isArray(posts) ? posts : [])
  .filter((post) => getProfilePostRoleKeys(post, profileUser).length > 0);

export const getProfilePortfolioTabs = (posts = [], profileUser = {}) => {
  const roleCounts = getEligibleProfilePosts(posts, profileUser).reduce((counts, post) => {
    getProfilePostRoleKeys(post, profileUser).forEach((roleKey) => {
      counts.set(roleKey, (counts.get(roleKey) || 0) + 1);
    });
    return counts;
  }, new Map());

  const roleKeysWithContent = sortRoleKeys([...roleCounts.keys()], profileUser);

  if (roleKeysWithContent.length < 2) return [];

  return [
    { key: ALL_PROFILE_PORTFOLIO_TAB, label: 'Alles', isAll: true },
    ...roleKeysWithContent.map((roleKey) => ({
      key: roleKey,
      label: getRoleLabel(roleKey),
      count: roleCounts.get(roleKey) || 0,
    })),
  ];
};

export const filterProfilePostsByRole = (posts = [], profileUser = {}, activeRoleKey = ALL_PROFILE_PORTFOLIO_TAB) => {
  const eligiblePosts = getEligibleProfilePosts(posts, profileUser);
  const tabs = getProfilePortfolioTabs(eligiblePosts, profileUser);
  const activeTabExists = tabs.some((tab) => tab.key === activeRoleKey);

  if (!activeRoleKey || activeRoleKey === ALL_PROFILE_PORTFOLIO_TAB || !activeTabExists) return eligiblePosts;

  return eligiblePosts.filter((post) => getProfilePostRoleKeys(post, profileUser).includes(activeRoleKey));
};
