import { isApprovedAffiliationStatus } from './profileAffiliationStatus.js';

const ORGANIZATION_TABS = {
  agency: { key: 'talent', label: 'Talent', organizationRole: 'agency', emptyState: 'Nog geen talent gekoppeld.' },
  company: { key: 'team', label: 'Team', organizationRole: 'company', emptyState: 'Nog geen teamleden gekoppeld.' },
};


const profileRoles = (profile = {}) => (Array.isArray(profile?.roles) ? profile.roles : []);
const profileUid = (profile = {}) => profile?.uid || profile?.id || null;
export const getOrganizationProfileTab = (viewedProfile = {}) => {
  const roles = profileRoles(viewedProfile);
  if (roles.includes('agency')) return ORGANIZATION_TABS.agency;
  if (roles.includes('company')) return ORGANIZATION_TABS.company;
  return null;
};

export const isApprovedAffiliation = (profile = {}, organizationProfile = {}) => {
  const tab = getOrganizationProfileTab(organizationProfile);
  const organizationUid = profileUid(organizationProfile);
  if (!tab || !organizationUid || profileUid(profile) === organizationUid) return false;

  if (tab.organizationRole === 'agency') {
    return profile?.linkedAgencyId === organizationUid
      && isApprovedAffiliationStatus(profile?.linkedAgencyStatus);
  }

  if (tab.organizationRole === 'company') {
    return profile?.linkedCompanyId === organizationUid
      && isApprovedAffiliationStatus(profile?.linkedCompanyStatus);
  }

  return false;
};

export const getAffiliatedProfilesForOrganization = (viewedProfile = {}, allProfiles = []) => {
  if (!Array.isArray(allProfiles)) return [];
  return allProfiles.filter((profile) => isApprovedAffiliation(profile, viewedProfile));
};

export const getVisibleOrganizationProfileTab = (viewedProfile = {}, allProfiles = []) => {
  const tab = getOrganizationProfileTab(viewedProfile);
  if (!tab) return null;

  const affiliatedProfiles = getAffiliatedProfilesForOrganization(viewedProfile, allProfiles);
  if (affiliatedProfiles.length === 0) return null;

  return { ...tab, count: affiliatedProfiles.length };
};
