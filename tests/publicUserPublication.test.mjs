import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isOnboardingComplete } from '../src/utils/firestoreGate.js';
import { isPublishedPersonalUserProfile, isPublicProfileVisible } from '../src/utils/managedProfiles.js';
import { isAvailablePersonalDmRecipient } from '../functions/publicProfileAvailability.js';
assert.equal(isOnboardingComplete({onboardingComplete:true}),true);
assert.equal(isOnboardingComplete({onboardingStep:5}),true);
assert.equal(isOnboardingComplete({ageVerified:true,isAdult:true,onboardingStep:4}),false);
assert.equal(isPublishedPersonalUserProfile({onboardingStep:5}),false);
assert.equal(isPublishedPersonalUserProfile({onboardingComplete:true}),true);
assert.equal(isPublicProfileVisible({type:'agency',status:'active'}),true);
assert.equal(isPublicProfileVisible({onboardingComplete:false}),false);
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
const migration = firebase.match(/export const migrateArtifactsUserData = async \(user\) => \{[\s\S]*?\n\};\n\nconst shouldRedirect/)[0];
assert.match(migration, /await patchUserProfile\(/, 'artifact private migration is awaited');
assert.match(migration, /publicSnap\.exists\(\) && isOnboardingComplete\(resultingPrivate\)/, 'artifact public snapshot uses the resulting private onboarding gate');
assert.ok(migration.indexOf('await patchUserProfile(') < migration.indexOf('await writePublicUserProfile('), 'private artifact state is persisted before public publication');
assert.doesNotMatch(migration, /Promise\.all\(migrations\)/, 'private and public migration writes are not parallelized');
const chat=fs.readFileSync('src/components/ChatPanel.jsx','utf8');
assert.match(chat,/filter\(isPublishedPersonalUserProfile\)/);
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
