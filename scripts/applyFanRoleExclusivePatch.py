from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


def replace_all(path, old, new, min_count=1):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count < min_count:
        raise RuntimeError(f"{path}: expected at least {min_count} matches, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new))
    return count


# ArtesApp: use the central role invariant in onboarding, editing, rendering and upload gating.
replace_once(
    'src/ArtesApp.jsx',
    "import { ROLE_OPTIONS, normalizeRoleValue } from './utils/roles';",
    "import { ROLE_OPTIONS, normalizeProfileRoles, normalizeRoleValue, toggleProfileRole } from './utils/roles';",
)
replace_once(
    'src/ArtesApp.jsx',
    "  const roles = Array.isArray(profileData?.roles) && profileData.roles.length\n    ? profileData.roles\n    : fallbackRoles;",
    "  const roles = normalizeProfileRoles(\n    Array.isArray(profileData?.roles) && profileData.roles.length\n      ? profileData.roles\n      : fallbackRoles,\n  );",
)
replace_once(
    'src/ArtesApp.jsx',
    "      bio: profileData.bio,\n      roles,\n      themes: Array.isArray(profileData.themes) ? profileData.themes : [],",
    "      bio: profileData.bio,\n      roles: normalizeProfileRoles(roles, { fallbackToFan: true }),\n      themes: Array.isArray(profileData.themes) ? profileData.themes : [],",
)
replace_once(
    'src/ArtesApp.jsx',
    "      const effectiveRoles = roles.length\n        ? roles\n        : (Array.isArray(profile?.roles) ? profile.roles : []);",
    "      const effectiveRoles = normalizeProfileRoles(\n        roles.length ? roles : (Array.isArray(profile?.roles) ? profile.roles : []),\n      );",
)
replace_once(
    'src/ArtesApp.jsx',
    "onClick={() => setRoles(prev => prev.includes(r.id) ? prev.filter(x => x !== r.id) : [...prev, r.id])}",
    "onClick={() => setRoles((prev) => toggleProfileRole(prev, r.id))}",
)
replace_once(
    'src/ArtesApp.jsx',
    "       roles: formData.roles?.length ? formData.roles : ['fan'],",
    "       roles: normalizeProfileRoles(formData.roles, { fallbackToFan: true }),",
)
replace_once(
    'src/ArtesApp.jsx',
    "    setFormData((prev) => ({\n      ...prev,\n      roles: [...(prev.roles || []), roleId],\n    }));",
    "    setFormData((prev) => ({\n      ...prev,\n      roles: toggleProfileRole(prev.roles || [], roleId),\n    }));",
)
replace_once(
    'src/ArtesApp.jsx',
    "  const canUpload = profile && (!profile.roles.includes('fan') || profile.roles.length > 1);",
    "  const canUpload = profile && normalizeProfileRoles(profile.roles).some((role) => role !== 'fan');",
)
replace_once(
    'src/ArtesApp.jsx',
    "  { uid: 'user_kai', displayName: 'Kai Sato', bio: 'Nature documentarian.', roles: ['photographer', 'fan'], avatar:",
    "  { uid: 'user_kai', displayName: 'Kai Sato', bio: 'Nature documentarian.', roles: ['photographer'], avatar:",
)
replace_all(
    'src/ArtesApp.jsx',
    "const roles = userProfile?.roles || [];",
    "const roles = normalizeProfileRoles(userProfile?.roles || []);",
    min_count=1,
)

# firebase.js: normalize any actual profile role write at the central write helper and update flow.
replace_once(
    'src/firebase.js',
    "import {\n  normalizePublicProfileField,\n  resolvePublicDisplayName,\n} from './utils/publicProfileFieldNormalization';",
    "import {\n  normalizePublicProfileField,\n  resolvePublicDisplayName,\n} from './utils/publicProfileFieldNormalization';\nimport { normalizeProfileRoles } from './utils/roles.js';",
)
replace_once(
    'src/firebase.js',
    "  let nextPatch = authorizeOnboardingWritePatch(patch, {\n    allowCompletion: allowOnboardingCompletion,\n  });\n\n  if (!hasOnboardingWriteKeys(nextPatch)) {",
    "  let nextPatch = authorizeOnboardingWritePatch(patch, {\n    allowCompletion: allowOnboardingCompletion,\n  });\n  if (Array.isArray(nextPatch.roles)) {\n    nextPatch = {\n      ...nextPatch,\n      roles: normalizeProfileRoles(nextPatch.roles, { fallbackToFan: true }),\n    };\n  }\n\n  if (!hasOnboardingWriteKeys(nextPatch)) {",
)
replace_once(
    'src/firebase.js',
    "  Object.assign(safeData, normalizeOnboardingWritePatch(existingPrivate, safeData));\n\n  const updatePayload = { ...safeData, updatedAt: serverTimestamp() };",
    "  Object.assign(safeData, normalizeOnboardingWritePatch(existingPrivate, safeData));\n  if (Array.isArray(safeData.roles)) {\n    safeData.roles = normalizeProfileRoles(safeData.roles, { fallbackToFan: true });\n  }\n\n  const updatePayload = { ...safeData, updatedAt: serverTimestamp() };",
)

# firebaseClient: normalize legacy public reads and all alternate profile write/projection paths.
replace_once(
    'src/services/firebaseClient.js',
    "import { buildPostAuthorFields, isLegacySetupProfileId, isPublicProfileVisible, resolvePostAuthorProfile } from '../utils/managedProfiles';",
    "import { buildPostAuthorFields, isLegacySetupProfileId, isPublicProfileVisible, resolvePostAuthorProfile } from '../utils/managedProfiles';\nimport { normalizeProfileRoles } from '../utils/roles.js';",
)
replace_once(
    'src/services/firebaseClient.js',
    "const PUBLIC_ARRAY_FIELDS = ['roles', 'themes', 'quickProfilePostIds'];",
    "const PUBLIC_ARRAY_FIELDS = ['themes', 'quickProfilePostIds'];",
)
replace_once(
    'src/services/firebaseClient.js',
    "  PUBLIC_ARRAY_FIELDS.forEach((field) => {\n    if (payload?.[field] !== undefined) publicPayload[field] = cleanStringArray(payload[field]);\n  });",
    "  if (payload?.roles !== undefined) {\n    publicPayload.roles = normalizeProfileRoles(cleanStringArray(payload.roles));\n  }\n  PUBLIC_ARRAY_FIELDS.forEach((field) => {\n    if (payload?.[field] !== undefined) publicPayload[field] = cleanStringArray(payload[field]);\n  });",
)
replace_once(
    'src/services/firebaseClient.js',
    "        ...safeData,\n        uid: resolvedUid,",
    "        ...safeData,\n        roles: normalizeProfileRoles(safeData.roles),\n        uid: resolvedUid,",
)
replace_once(
    'src/services/firebaseClient.js',
    "export const createProfile = async (uid, profile) => {\n  const payload = {\n    createdAt: serverTimestamp(),\n    updatedAt: serverTimestamp(),\n    ...profile,",
    "export const createProfile = async (uid, profile) => {\n  const normalizedProfile = Array.isArray(profile?.roles)\n    ? { ...profile, roles: normalizeProfileRoles(profile.roles, { fallbackToFan: true }) }\n    : profile;\n  const payload = {\n    createdAt: serverTimestamp(),\n    updatedAt: serverTimestamp(),\n    ...normalizedProfile,",
)
replace_once(
    'src/services/firebaseClient.js',
    "    uid: profile?.uid || uid,\n    profileId: profile?.profileId || uid,\n    ownerUid: profile?.ownerUid || uid,",
    "    uid: normalizedProfile?.uid || uid,\n    profileId: normalizedProfile?.profileId || uid,\n    ownerUid: normalizedProfile?.ownerUid || uid,",
)
replace_once(
    'src/services/firebaseClient.js',
    "  if (isOnboardingComplete(profile) && !(await isCodexDevUser(auth.currentUser))) {\n    const publicPayload = { ...toPublicProfilePayload(profile, uid), onboardingComplete: true };",
    "  if (isOnboardingComplete(normalizedProfile) && !(await isCodexDevUser(auth.currentUser))) {\n    const publicPayload = { ...toPublicProfilePayload(normalizedProfile, uid), onboardingComplete: true };",
)
replace_once(
    'src/services/firebaseClient.js',
    "export const updateProfile = async (uid, payload) => {\n  const privateRef = doc(db, 'users', uid);\n  const publicRef = doc(db, 'publicUsers', uid);\n  const privateSnap = await getDoc(privateRef);\n  const resultingProfile = { ...(privateSnap.exists() ? privateSnap.data() : {}), ...payload };\n  logFirestoreOp('UPDATE', `users/${uid}`, 'updateProfile');\n  await setDoc(privateRef, { ...payload, updatedAt: serverTimestamp() }, { merge: true });",
    "export const updateProfile = async (uid, payload) => {\n  const normalizedPayload = Array.isArray(payload?.roles)\n    ? { ...payload, roles: normalizeProfileRoles(payload.roles, { fallbackToFan: true }) }\n    : payload;\n  const privateRef = doc(db, 'users', uid);\n  const publicRef = doc(db, 'publicUsers', uid);\n  const privateSnap = await getDoc(privateRef);\n  const resultingProfile = { ...(privateSnap.exists() ? privateSnap.data() : {}), ...normalizedPayload };\n  logFirestoreOp('UPDATE', `users/${uid}`, 'updateProfile');\n  await setDoc(privateRef, { ...normalizedPayload, updatedAt: serverTimestamp() }, { merge: true });",
)
replace_once(
    'src/services/firebaseClient.js',
    "  const resolvedPublicData = {\n    ...safePublicData,\n    profileId: safePublicData.profileId || safePublicData.uid || userId,",
    "  const resolvedPublicData = {\n    ...safePublicData,\n    roles: normalizeProfileRoles(safePublicData.roles),\n    profileId: safePublicData.profileId || safePublicData.uid || userId,",
)

# Admin backfill must not reintroduce mixed fan roles.
replace_once(
    'functions/scripts/backfillPublicUsersFromUsers.js',
    "import { cleanPublicStringArray } from '../../src/utils/publicProfileFieldNormalization.js';",
    "import { cleanPublicStringArray } from '../../src/utils/publicProfileFieldNormalization.js';\nimport { normalizeProfileRoles } from '../../src/utils/roles.js';",
)
replace_once(
    'functions/scripts/backfillPublicUsersFromUsers.js',
    "export const PUBLIC_ARRAY_FIELDS = [\n  'roles',\n  'themes',\n];",
    "export const PUBLIC_ARRAY_FIELDS = [\n  'themes',\n];",
)
replace_once(
    'functions/scripts/backfillPublicUsersFromUsers.js',
    "    roles: cleanStringArray(userData.roles),",
    "    roles: normalizeProfileRoles(cleanStringArray(userData.roles)),",
)

# Firestore rules: new/changed role arrays cannot combine fan with other roles,
# while unrelated edits on a pre-migration legacy record remain possible.
replace_once(
    'firestore.rules',
    "    function noPublicUserCounterWrites() {\n      return resource == null\n        ? !request.resource.data.keys().hasAny(['fansCount', 'fanOfCount'])\n        : !request.resource.data.diff(resource.data).affectedKeys().hasAny(['fansCount', 'fanOfCount']);\n    }",
    "    function noPublicUserCounterWrites() {\n      return resource == null\n        ? !request.resource.data.keys().hasAny(['fansCount', 'fanOfCount'])\n        : !request.resource.data.diff(resource.data).affectedKeys().hasAny(['fansCount', 'fanOfCount']);\n    }\n    function hasExclusiveFanProfileRoles(data) {\n      return !('roles' in data)\n        || (data.roles is list\n          && (!('fan' in data.roles) || data.roles.size() == 1));\n    }\n    function hasValidProfileRoleWrite() {\n      return resource == null\n        ? hasExclusiveFanProfileRoles(request.resource.data)\n        : (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['roles'])\n          || hasExclusiveFanProfileRoles(request.resource.data));\n    }",
)
replace_once(
    'firestore.rules',
    "      allow create: if isOwner(userId)\n        && noServerManagedUserFieldWrites()\n        && isSelfSafeAffiliationStatusWrite();",
    "      allow create: if isOwner(userId)\n        && noServerManagedUserFieldWrites()\n        && hasExclusiveFanProfileRoles(request.resource.data)\n        && isSelfSafeAffiliationStatusWrite();",
)
replace_once(
    'firestore.rules',
    "          && noClientGateFieldWrites()\n          && noServerManagedUserFieldWrites()\n          && isSelfSafeAffiliationStatusWrite())",
    "          && noClientGateFieldWrites()\n          && noServerManagedUserFieldWrites()\n          && hasValidProfileRoleWrite()\n          && isSelfSafeAffiliationStatusWrite())",
)
replace_once(
    'firestore.rules',
    "        && ((isOwner(uid)\n        && exists(/databases/$(database)/documents/users/$(uid))",
    "        && ((isOwner(uid)\n        && hasValidProfileRoleWrite()\n        && exists(/databases/$(database)/documents/users/$(uid))",
)

print('Fan role patch applied successfully')
