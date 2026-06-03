export const ROLE_OPTIONS = [
  { id: 'photographer', label: 'Fotograaf', desc: 'Deel shoots, lichtopstellingen en vind modellen.' },
  { id: 'model', label: 'Model', desc: 'Bouw je portfolio en vind veilige samenwerkingen.' },
  { id: 'artist', label: 'Artist', desc: 'Deel kunstzinnige projecten.' },
  { id: 'stylist', label: 'Stylist', desc: 'Laat je styling werk zien.' },
  { id: 'mua', label: 'MUA', desc: 'Visagie en special effects.' },
  { id: 'hair', label: 'Hairstylist', desc: 'Haarstyling en verzorging.' },
  { id: 'art_director', label: 'Art Director', desc: 'Conceptontwikkeling en visuele regie.' },
  { id: 'retoucher', label: 'Retoucher', desc: 'Nabewerking en high-end retouching.' },
  { id: 'videographer', label: 'Videograaf', desc: 'Video producties en reels.' },
  { id: 'producer', label: 'Producer', desc: 'Productie en planning van shoots.' },
  { id: 'assistent', label: 'Assistent', desc: 'Ondersteuning op de set.' },
  { id: 'agency', label: 'Agency', desc: 'Vertegenwoordig talent.' },
  { id: 'company', label: 'Company', desc: 'Merk, studio of bedrijf.' },
  { id: 'fan', label: 'Fan', desc: 'Word fan van je favoriete makers en bewaar inspiratie.' },
];

const normalizeRoleString = (value) => String(value || '').trim();
const normalizeRoleLookupKey = (value) => normalizeRoleString(value).toLowerCase();
const ROLE_LOOKUP = new Map(ROLE_OPTIONS.flatMap((role) => [
  [normalizeRoleLookupKey(role.id), role.id],
  [normalizeRoleLookupKey(role.label), role.id],
  [normalizeRoleLookupKey(role.value), role.id],
]).filter(([key]) => key));

const canonicalizeRoleValue = (value) => {
  const normalized = normalizeRoleString(value);
  return ROLE_LOOKUP.get(normalizeRoleLookupKey(normalized)) || normalized;
};

export const normalizeRoleValue = (roleValue, fallback = '') => {
  if (Array.isArray(roleValue)) {
    const normalized = roleValue.map((entry) => normalizeRoleValue(entry)).find(Boolean);
    return normalized || canonicalizeRoleValue(fallback);
  }

  if (roleValue && typeof roleValue === 'object') {
    return canonicalizeRoleValue(
      roleValue.id
      || roleValue.value
      || roleValue.name
      || roleValue.label
      || fallback,
    );
  }

  return canonicalizeRoleValue(roleValue || fallback);
};

export const getRoleLabel = (roleValue, fallback = 'Maker') => {
  const normalizedRole = normalizeRoleValue(roleValue);
  if (!normalizedRole) return fallback;
  return ROLE_OPTIONS.find((role) => role.id === normalizedRole)?.label
    || ROLE_OPTIONS.find((role) => role.value === normalizedRole)?.label
    || normalizedRole
    || fallback;
};
