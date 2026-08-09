export const cleanPublicStringArray = (value) => (Array.isArray(value)
  ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
  : []);

export const normalizePublicProfileField = (key, value) => {
  if (value === undefined) return undefined;
  if (key === 'photoURL' || key === 'avatar' || key === 'headerImage') {
    return typeof value === 'string' || value === null ? value : null;
  }
  if (key === 'displayName' || key === 'bio') return typeof value === 'string' ? value : '';
  if ([
    'linkedAgencyName',
    'linkedCompanyName',
    'linkedAgencyId',
    'linkedCompanyId',
    'linkedAgencyLink',
    'linkedCompanyLink',
  ].includes(key)) {
    return typeof value === 'string' || value === null ? value : null;
  }
  if (key === 'linkedAgencyStatus' || key === 'linkedCompanyStatus') {
    return typeof value === 'string' ? value.trim().toLowerCase() || undefined : undefined;
  }
  if (key === 'headerPosition') return typeof value === 'string' && value ? value : 'center';
  if (key === 'roles' || key === 'themes' || key === 'quickProfilePostIds') {
    return cleanPublicStringArray(value);
  }
  if (key === 'quickProfilePreviewMode') {
    return ['latest', 'best', 'manual'].includes(value) ? value : 'latest';
  }
  return value;
};
