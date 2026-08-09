import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isOnboardingComplete } from '../src/utils/firestoreGate.js';
import { isPublishedPersonalUserProfile, isPublicProfileVisible } from '../src/utils/managedProfiles.js';
import { syncPublicProfileFromCurrentPrivate } from '../src/utils/publicProfileSync.js';
import { isAvailablePersonalDmRecipient } from '../functions/publicProfileAvailability.js';
assert.equal(isOnboardingComplete({onboardingComplete:true}),true);
assert.equal(isOnboardingComplete({onboardingStep:5}),true);
assert.equal(isOnboardingComplete({ageVerified:true,isAdult:true,onboardingStep:4}),false);
assert.equal(isPublishedPersonalUserProfile({onboardingStep:5}),false);
assert.equal(isPublishedPersonalUserProfile({onboardingComplete:true}),true);
assert.equal(isPublicProfileVisible({type:'agency',status:'active'}),true);
assert.equal(isPublicProfileVisible({onboardingComplete:false}),false);
assert.equal(isPublicProfileVisible({onboardingComplete:true}),true);
assert.equal(isPublicProfileVisible({onboardingComplete:true,hidden:true}),false);
assert.equal(isPublicProfileVisible({onboardingComplete:true,status:'inactive'}),false);
assert.equal(isPublicProfileVisible({onboardingComplete:true,visibility:'private'}),false);
assert.equal(isPublicProfileVisible({onboardingComplete:true,publicVisibility:'private'}),false);
assert.equal(isPublicProfileVisible({
  onboardingComplete:true,
  hidden:true,
  status:'inactive',
  visibility:'private',
  publicVisibility:'private',
  deactivatedReason:'underage',
}),false);
assert.equal(isAvailablePersonalDmRecipient({onboardingComplete:true}),true);
assert.equal(isAvailablePersonalDmRecipient({onboardingComplete:false}),false);
assert.equal(isAvailablePersonalDmRecipient({onboardingComplete:true,hidden:true}),false);
assert.equal(isAvailablePersonalDmRecipient({onboardingComplete:true,status:'inactive'}),false);
assert.equal(isAvailablePersonalDmRecipient({onboardingComplete:true,visibility:'private'}),false);
assert.equal(isAvailablePersonalDmRecipient({onboardingComplete:true,publicVisibility:'private'}),false);
assert.equal(isAvailablePersonalDmRecipient({onboardingComplete:true,deactivatedReason:'underage'}),false);
const firebase=fs.readFileSync('src/firebase.js','utf8');
assert.match(firebase,/if \(!isOnboardingComplete\(resultingProfile\)\) return resultingProfile/);
assert.match(firebase,/const resultingPrivate = \{ \.\.\.existingPrivate, \.\.\.safeData \}/);
const updateUserProfile = firebase.match(/export const updateUserProfile = async \(uid, data\) => \{[\s\S]*?\n\};\n\n\/\*\*\n \* One-time backfill/)[0];
assert.match(
  updateUserProfile,
  /const shouldSyncPublic = isOnboardingComplete\(resultingPrivate\);/,
  'the merged private state remains the initial onboarding publication gate',
);
assert.match(
  updateUserProfile,
  /syncPublicProfileFromCurrentPrivate\(\{[\s\S]*?buildPublicUserWritePayload\(resolvedUid, currentPrivate, currentPublic\)/,
  'public sync rebuilds the projection from transactionally current private and public state',
);
assert.doesNotMatch(
  updateUserProfile,
  /writePublicUserProfile\(resolvedUid, (?:publicPatch|publicProjectionPreview)/,
  'the stale pre-write projection is never written to publicUsers',
);

const initialPrivateProfile = {
  uid: 'overlap-user',
  onboardingComplete: true,
  displayName: 'Overlap User',
  bio: 'Old bio',
  avatar: 'https://example.test/old-avatar.jpg',
  photoURL: 'https://example.test/old-avatar.jpg',
};
const staleBioResult = {
  ...initialPrivateProfile,
  bio: 'New bio',
};
const staleAvatarResult = {
  ...initialPrivateProfile,
  avatar: 'https://example.test/new-avatar.jpg',
  photoURL: 'https://example.test/new-avatar.jpg',
};
assert.equal(staleBioResult.avatar, initialPrivateProfile.avatar, 'bio update starts from the stale avatar');
assert.equal(staleAvatarResult.bio, initialPrivateProfile.bio, 'avatar update starts from the stale bio');

const concurrentState = {
  privateProfile: { ...initialPrivateProfile },
  publicProfile: { ...initialPrivateProfile },
};
const privateRef = { kind: 'private' };
const publicRef = { kind: 'public' };
let transactionTail = Promise.resolve();
const runSerializedTransaction = (_db, operation) => {
  const result = transactionTail.then(async () => {
    const pendingWrites = [];
    const transactionResult = await operation({
      get: async (ref) => {
        const data = ref === privateRef
          ? concurrentState.privateProfile
          : concurrentState.publicProfile;
        return {
          exists: () => true,
          data: () => ({ ...data }),
        };
      },
      set: (ref, payload, options) => pendingWrites.push({ ref, payload, options }),
    });

    pendingWrites.forEach(({ ref, payload, options }) => {
      assert.equal(ref, publicRef);
      assert.deepEqual(options, { merge: true });
      concurrentState.publicProfile = {
        ...concurrentState.publicProfile,
        ...payload,
      };
    });
    return transactionResult;
  });
  transactionTail = result.catch(() => {});
  return result;
};
const syncCurrentProjection = (staleResult) => {
  assert.notDeepEqual(
    staleResult,
    concurrentState.privateProfile,
    'each overlapping caller still holds a stale full-profile snapshot',
  );
  return syncPublicProfileFromCurrentPrivate({
    db: {},
    runTransaction: runSerializedTransaction,
    privateRef,
    publicRef,
    isOnboardingComplete,
    buildWritePayload: (currentPrivate) => ({
      bio: currentPrivate.bio,
      avatar: currentPrivate.avatar,
      photoURL: currentPrivate.photoURL,
      onboardingComplete: true,
    }),
  });
};

let privateWritesCompleted = 0;
let releasePublicSync;
const bothPrivateWritesCompleted = new Promise((resolve) => {
  releasePublicSync = resolve;
});
const completeOverlappingUpdate = async (staleResult, privatePatch) => {
  concurrentState.privateProfile = {
    ...concurrentState.privateProfile,
    ...privatePatch,
  };
  privateWritesCompleted += 1;
  if (privateWritesCompleted === 2) releasePublicSync();
  await bothPrivateWritesCompleted;
  return syncCurrentProjection(staleResult);
};

await Promise.all([
  completeOverlappingUpdate(staleBioResult, { bio: staleBioResult.bio }),
  completeOverlappingUpdate(staleAvatarResult, {
    avatar: staleAvatarResult.avatar,
    photoURL: staleAvatarResult.photoURL,
  }),
]);
assert.equal(concurrentState.publicProfile.bio, 'New bio', 'overlapping avatar update cannot revert bio');
assert.equal(
  concurrentState.publicProfile.avatar,
  'https://example.test/new-avatar.jpg',
  'overlapping bio update cannot revert avatar',
);
assert.equal(
  concurrentState.publicProfile.photoURL,
  'https://example.test/new-avatar.jpg',
  'the coupled public photoURL remains current',
);
const migration = firebase.match(/export const migrateArtifactsUserData = async \(user\) => \{[\s\S]*?\n\};\n\nconst shouldRedirect/)[0];
assert.match(migration, /await patchUserProfile\(/, 'artifact private migration is awaited');
assert.match(migration, /publicSnap\.exists\(\) && isOnboardingComplete\(resultingPrivate\)/, 'artifact public snapshot uses the resulting private onboarding gate');
assert.ok(migration.indexOf('await patchUserProfile(') < migration.indexOf('await writePublicUserProfile('), 'private artifact state is persisted before public publication');
assert.doesNotMatch(migration, /Promise\.all\(migrations\)/, 'private and public migration writes are not parallelized');
const chat=fs.readFileSync('src/components/ChatPanel.jsx','utf8');
assert.match(chat,/filter\(isPublishedPersonalUserProfile\)/);
const firebaseClient=fs.readFileSync('src/services/firebaseClient.js','utf8');
const publicReadPaths=firebaseClient.match(/export const subscribeToUsers[\s\S]*?export const seedDemoContent/)[0]
  + firebaseClient.match(/export const fetchUserIndex[\s\S]*?\n\};/)[0];
assert.match(publicReadPaths,/filter\(isPublicProfileVisible\)/);
assert.match(publicReadPaths,/if \(!isPublicProfileVisible\(publicData\)\) return null/);
assert.doesNotMatch(publicReadPaths,/isPublishedPersonalUserProfile/);
const fn=fs.readFileSync('functions/index.js','utf8');
const dmHandler=fn.match(/export const createDmThread = onRequest\([\s\S]*?\n\}\);\n\nexport const createDevCodexToken/)[0];
assert.match(dmHandler,/!isAvailablePersonalDmRecipient\(recipientPublicSnap\.data\(\)\)/);
assert.ok(
  dmHandler.indexOf('if (!existingSnap.empty)') < dmHandler.indexOf('const recipientPublicSnap'),
  'existing DM threads are returned before recipient availability blocks new threads',
);
assert.ok(
  dmHandler.indexOf('!isAvailablePersonalDmRecipient') < dmHandler.indexOf('await canonicalRef.create'),
  'recipient availability is checked before creating a new DM thread',
);
console.log('PASS publicUserPublication.test');
