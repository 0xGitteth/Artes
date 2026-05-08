import assert from 'node:assert/strict';
import {
  getAffiliatedProfilesForOrganization,
  getOrganizationProfileTab,
  getVisibleOrganizationProfileTab,
  isApprovedAffiliation,
} from '../src/utils/profileAffiliations.js';

const agency = { uid: 'agency-1', roles: ['agency'], displayName: 'Agency One' };
const company = { uid: 'company-1', roles: ['company'], displayName: 'Company One' };
const normalProfile = { uid: 'model-1', roles: ['model'], displayName: 'Model One' };

assert.deepEqual(
  getOrganizationProfileTab(agency),
  { key: 'talent', label: 'Talent', organizationRole: 'agency', emptyState: 'Nog geen talent gekoppeld.' },
  'agency profile gets Talent tab metadata',
);
assert.deepEqual(
  getOrganizationProfileTab(company),
  { key: 'team', label: 'Team', organizationRole: 'company', emptyState: 'Nog geen teamleden gekoppeld.' },
  'company profile gets Team tab metadata',
);
assert.equal(getOrganizationProfileTab(normalProfile), null, 'normal profile gets no Talent/Team tab metadata');

const approvedAgencyTalent = {
  uid: 'talent-approved',
  roles: ['model'],
  linkedAgencyId: 'agency-1',
  linkedAgencyName: 'Agency One',
  linkedAgencyStatus: 'approved',
};
const verifiedAgencyTalent = {
  uid: 'talent-verified',
  roles: ['model'],
  linkedAgencyId: 'agency-1',
  linkedAgencyStatus: 'verified',
};
const pendingAgencyTalent = {
  uid: 'talent-pending',
  roles: ['model'],
  linkedAgencyId: 'agency-1',
  linkedAgencyStatus: 'pending',
};
const missingStatusAgencyTalent = {
  uid: 'talent-missing-status',
  roles: ['model'],
  linkedAgencyId: 'agency-1',
};
const freeTextAgencyTalent = {
  uid: 'talent-free-text',
  roles: ['model'],
  linkedAgencyName: 'Agency One',
  linkedAgencyStatus: 'approved',
};
const wrongAgencyTalent = {
  uid: 'talent-wrong-agency',
  roles: ['model'],
  linkedAgencyId: 'agency-2',
  linkedAgencyStatus: 'approved',
};

assert.equal(isApprovedAffiliation(approvedAgencyTalent, agency), true, 'approved linked agency profile is approved affiliation');
assert.equal(isApprovedAffiliation(verifiedAgencyTalent, agency), true, 'verified linked agency profile is approved affiliation');
assert.equal(isApprovedAffiliation(pendingAgencyTalent, agency), false, 'pending linked agency profile is not public');
assert.equal(isApprovedAffiliation(missingStatusAgencyTalent, agency), false, 'missing agency status is not treated as approved');
assert.equal(isApprovedAffiliation(freeTextAgencyTalent, agency), false, 'free text agency name without linkedAgencyId is not public');
assert.equal(isApprovedAffiliation(wrongAgencyTalent, agency), false, 'wrong organization id does not match agency');
assert.deepEqual(
  getAffiliatedProfilesForOrganization(agency, [approvedAgencyTalent, pendingAgencyTalent, freeTextAgencyTalent, wrongAgencyTalent]).map((profile) => profile.uid),
  ['talent-approved'],
  'only approved agency-linked profile appears in Talent',
);

const approvedCompanyTeamMember = {
  uid: 'team-approved',
  roles: ['producer'],
  linkedCompanyId: 'company-1',
  linkedCompanyName: 'Company One',
  linkedCompanyStatus: 'approved',
};
const verifiedCompanyTeamMember = {
  uid: 'team-verified',
  roles: ['producer'],
  linkedCompanyId: 'company-1',
  linkedCompanyStatus: 'verified',
};
const pendingCompanyTeamMember = {
  uid: 'team-pending',
  roles: ['producer'],
  linkedCompanyId: 'company-1',
  linkedCompanyStatus: 'pending',
};
const missingStatusCompanyTeamMember = {
  uid: 'team-missing-status',
  roles: ['producer'],
  linkedCompanyId: 'company-1',
};
const freeTextCompanyTeamMember = {
  uid: 'team-free-text',
  roles: ['producer'],
  linkedCompanyName: 'Company One',
  linkedCompanyStatus: 'approved',
};
const wrongCompanyTeamMember = {
  uid: 'team-wrong-company',
  roles: ['producer'],
  linkedCompanyId: 'company-2',
  linkedCompanyStatus: 'approved',
};

assert.equal(isApprovedAffiliation(approvedCompanyTeamMember, company), true, 'approved linked company profile is approved affiliation');
assert.equal(isApprovedAffiliation(verifiedCompanyTeamMember, company), true, 'verified linked company profile is approved affiliation');
assert.equal(isApprovedAffiliation(pendingCompanyTeamMember, company), false, 'pending linked company profile is not public');
assert.equal(isApprovedAffiliation(missingStatusCompanyTeamMember, company), false, 'missing company status is not treated as approved');
assert.equal(isApprovedAffiliation(freeTextCompanyTeamMember, company), false, 'free text company name without linkedCompanyId is not public');
assert.equal(isApprovedAffiliation(wrongCompanyTeamMember, company), false, 'wrong organization id does not match company');
assert.deepEqual(
  getAffiliatedProfilesForOrganization(company, [approvedCompanyTeamMember, pendingCompanyTeamMember, freeTextCompanyTeamMember, wrongCompanyTeamMember]).map((profile) => profile.uid),
  ['team-approved'],
  'only approved company-linked profile appears in Team',
);

assert.equal(getOrganizationProfileTab({ uid: 'agency-1', roles: ['agency'] })?.key === 'moodboards', false, 'moodboard tab is not added');
assert.equal(getVisibleOrganizationProfileTab(agency, [pendingAgencyTalent]), null, 'owner only/private or unsafe organization tabs are not shown to public viewers');
assert.deepEqual(
  getVisibleOrganizationProfileTab(company, [approvedCompanyTeamMember]),
  { key: 'team', label: 'Team', organizationRole: 'company', emptyState: 'Nog geen teamleden gekoppeld.', count: 1 },
  'public Team tab becomes visible only when safe approved data is present',
);
