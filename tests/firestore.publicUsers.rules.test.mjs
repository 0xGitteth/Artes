import fs from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
  writeBatch,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'artes-rules-test';

const authedContext = (env, uid, token = {}) => {
  const adultDefaults = token.email_verified === true && token.__adultDefaults !== false
    ? { idvVerified: true, isAdult: true }
    : {};
  const { __adultDefaults, ...safeToken } = token;
  return env.authenticatedContext(uid, {
    email: `${uid}@example.com`,
    ...adultDefaults,
    ...safeToken,
  });
};

async function run() {
  const rules = await fs.readFile('firestore.rules', 'utf8');
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });

  try {
    const ownerUid = 'owner_1';
    const otherUid = 'other_1';

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'publicUsers', ownerUid), {
       onboardingComplete: true,
        onboardingComplete: true,
        uid: ownerUid,
        username: 'owner1',
        displayName: 'Owner One',
        displayNameLower: 'owner one',
        email: 'legacy@example.com',
        fansCount: 1,
        fanOfCount: 2,
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'publicUsers', otherUid), {
        onboardingComplete: true,
        uid: otherUid,
        username: 'other1',
        displayName: 'Other One',
        displayNameLower: 'other one',
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'publicUsers', 'legacy_auth_provider_user'), {
        onboardingComplete: true,
        uid: 'legacy_auth_provider_user',
        username: 'legacyauthprovider',
        displayName: 'Legacy Auth Provider',
        displayNameLower: 'legacy auth provider',
        authProvider: 'google.com',
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'publicUsers', 'legacy_email_auth_user'), {
        onboardingComplete: true,
        uid: 'legacy_email_auth_user',
        username: 'legacyemailauth',
        displayName: 'Legacy Email Auth',
        displayNameLower: 'legacy email auth',
        email: 'legacy-auth@example.com',
        authProvider: 'google.com',
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'publicUsers', 'legacy_cleanup_only_user'), {
        onboardingComplete: true,
        uid: 'legacy_cleanup_only_user',
        username: 'legacycleanuponly',
        email: 'cleanup-only@example.com',
        authProvider: 'google.com',
        updatedAt: new Date(),
      });
      for (const completedUid of ['authproviderleak', 'displaylowermissingname', 'displaynamemissinglower', 'legacy_auth_provider_user', 'legacy_cleanup_only_user', 'legacy_email_auth_user', 'ownerusernameonly', 'providerdataleak', 'publicdiditleak', 'publicemailleak', 'publiclegalleak']) {
        await setDoc(doc(db, 'users', completedUid), { uid: completedUid, onboardingComplete: true });
      }
      await setDoc(doc(db, 'users', 'legacy_step_5'), { uid: 'legacy_step_5', onboardingStep: '5' });
      await setDoc(doc(db, 'users', 'legacy_step_10'), { uid: 'legacy_step_10', onboardingStep: '10' });
      await setDoc(doc(db, 'users', 'legacy_step_11'), { uid: 'legacy_step_11', onboardingStep: '11' });
      await setDoc(doc(db, 'profiles', 'active_agency_profile'), {
        type: 'agency',
        displayName: 'Active Agency Profile',
        ownerUid,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'profiles', 'private_agency_profile'), {
        type: 'agency',
        displayName: 'Private Agency Profile',
        ownerUid,
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'profiles', ownerUid), {
        type: 'company',
        displayName: 'Collision Company Profile',
        ownerUid,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'profiles', 'legacy_codex_profile'), {
        type: 'agency', displayName: 'Legacy Codex Agency', ownerUid: 'codex-dev-user', status: 'active', createdAt: new Date(), updatedAt: new Date(),
      });
      await setDoc(doc(db, 'users', ownerUid), {
        onboardingComplete: true,
        uid: ownerUid,
        displayName: 'Owner One',
        ageVerified: true,
        isAdult: true,
        didit: { status: 'approved' },
        idv: { status: 'approved' },
      });
      await setDoc(doc(db, 'users', 'codex-dev-user'), {
        uid: 'codex-dev-user',
        onboardingComplete: true,
        onboardingStep: 5,
        isDevTestUser: true,
        devActor: 'codex',
      });
      await setDoc(doc(db, 'users', 'agency_owner'), {
        onboardingComplete: true,
        uid: 'agency_owner',
        username: 'agencyowner',
        displayName: 'Agency Owner',
        roles: ['agency'],
      });
      await setDoc(doc(db, 'users', 'company_owner'), {
        onboardingComplete: true,
        uid: 'company_owner',
        username: 'companyowner',
        displayName: 'Company Owner',
        roles: ['company'],
      });
      await setDoc(doc(db, 'users', 'agency_other'), {
        onboardingComplete: true,
        uid: 'agency_other',
        username: 'agencyother',
        displayName: 'Agency Other',
        roles: ['agency'],
      });
      await setDoc(doc(db, 'users', 'company_other'), {
        onboardingComplete: true,
        uid: 'company_other',
        username: 'companyother',
        displayName: 'Company Other',
        roles: ['company'],
      });
      await setDoc(doc(db, 'users', 'talent_pending'), {
        onboardingComplete: true,
        uid: 'talent_pending',
        username: 'talentpending',
        displayName: 'Talent Pending',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'team_pending'), {
        onboardingComplete: true,
        uid: 'team_pending',
        username: 'teampending',
        displayName: 'Team Pending',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'talent_pending'), {
        onboardingComplete: true,
        uid: 'talent_pending',
        username: 'talentpending',
        displayName: 'Talent Pending',
        displayNameLower: 'talent pending',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'team_pending'), {
        onboardingComplete: true,
        uid: 'team_pending',
        username: 'teampending',
        displayName: 'Team Pending',
        displayNameLower: 'team pending',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'talent_card'), {
        onboardingComplete: true,
        uid: 'talent_card',
        username: 'talentcard',
        displayName: 'Talent Card',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'talent_card'), {
        onboardingComplete: true,
        uid: 'talent_card',
        username: 'talentcard',
        displayName: 'Talent Card',
        displayNameLower: 'talent card',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'team_card'), {
        onboardingComplete: true,
        uid: 'team_card',
        username: 'teamcard',
        displayName: 'Team Card',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'team_card'), {
        onboardingComplete: true,
        uid: 'team_card',
        username: 'teamcard',
        displayName: 'Team Card',
        displayNameLower: 'team card',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'talent_batch_card'), {
        onboardingComplete: true,
        uid: 'talent_batch_card',
        username: 'talentbatchcard',
        displayName: 'Talent Batch Card',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'talent_batch_card'), {
        onboardingComplete: true,
        uid: 'talent_batch_card',
        username: 'talentbatchcard',
        displayName: 'Talent Batch Card',
        displayNameLower: 'talent batch card',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'team_batch_card'), {
        onboardingComplete: true,
        uid: 'team_batch_card',
        username: 'teambatchcard',
        displayName: 'Team Batch Card',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'team_batch_card'), {
        onboardingComplete: true,
        uid: 'team_batch_card',
        username: 'teambatchcard',
        displayName: 'Team Batch Card',
        displayNameLower: 'team batch card',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'talent_reject'), {
        onboardingComplete: true,
        uid: 'talent_reject',
        username: 'talentreject',
        displayName: 'Talent Reject',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'talent_reject'), {
        onboardingComplete: true,
        uid: 'talent_reject',
        username: 'talentreject',
        displayName: 'Talent Reject',
        displayNameLower: 'talent reject',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'team_reject'), {
        onboardingComplete: true,
        uid: 'team_reject',
        username: 'teamreject',
        displayName: 'Team Reject',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'team_reject'), {
        onboardingComplete: true,
        uid: 'team_reject',
        username: 'teamreject',
        displayName: 'Team Reject',
        displayNameLower: 'team reject',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'talent_remove'), {
        onboardingComplete: true,
        uid: 'talent_remove',
        username: 'talentremove',
        displayName: 'Talent Remove',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'approved',
        linkedAgencyApprovedBy: 'agency_owner',
        linkedAgencyApprovedAt: new Date(),
      });
      await setDoc(doc(db, 'publicUsers', 'talent_remove'), {
        onboardingComplete: true,
        uid: 'talent_remove',
        username: 'talentremove',
        displayName: 'Talent Remove',
        displayNameLower: 'talent remove',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'approved',
      });
      await setDoc(doc(db, 'users', 'team_remove'), {
        onboardingComplete: true,
        uid: 'team_remove',
        username: 'teamremove',
        displayName: 'Team Remove',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'approved',
        linkedCompanyApprovedBy: 'company_owner',
        linkedCompanyApprovedAt: new Date(),
      });
      await setDoc(doc(db, 'publicUsers', 'team_remove'), {
        onboardingComplete: true,
        uid: 'team_remove',
        username: 'teamremove',
        displayName: 'Team Remove',
        displayNameLower: 'team remove',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'approved',
      });
      await setDoc(doc(db, 'users', 'self_withdraw'), {
        onboardingComplete: true,
        uid: 'self_withdraw',
        username: 'selfwithdraw',
        displayName: 'Self Withdraw',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'approved',
        linkedAgencyApprovedBy: 'agency_owner',
        linkedAgencyApprovedAt: new Date(),
      });
      await setDoc(doc(db, 'publicUsers', 'self_withdraw'), {
        onboardingComplete: true,
        uid: 'self_withdraw',
        username: 'selfwithdraw',
        displayName: 'Self Withdraw',
        displayNameLower: 'self withdraw',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'approved',
      });


      await setDoc(doc(db, 'users', ownerUid, 'following', 'target_a'), {
        onboardingComplete: true,
        targetUid: 'target_a',
        createdAt: new Date(),
      });
      await setDoc(doc(db, 'config', 'moderation'), {
        moderatorEmails: ['mod_1@example.com'],
      });
      await setDoc(doc(db, 'announcements', 'active_update'), {
        type: 'appUpdate',
        title: 'Nieuwe versie',
        body: 'Welkom bij de nieuwe app update',
        status: 'active',
        isCurrent: true,
        version: 2,
      });
      await setDoc(doc(db, 'announcements', 'draft_update'), {
        type: 'appUpdate',
        title: 'Draft',
        body: 'Niet zichtbaar',
        status: 'draft',
        isCurrent: false,
        version: 1,
      });
      await setDoc(doc(db, 'contributors', 'claimed_contributor'), {
        displayName: 'Claimed Contributor',
        status: 'claimed',
        claimedByUid: ownerUid,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'contributors', 'unclaimed_contributor'), {
        displayName: 'Unclaimed Contributor',
        status: 'unclaimed',
        claimedByUid: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'contributors', 'other_claimed_contributor'), {
        displayName: 'Other Claimed Contributor',
        status: 'claimed',
        claimedByUid: otherUid,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'contributors', 'codex_claimed_contributor'), {
        displayName: 'Historical Codex Contributor', status: 'claimed', claimedByUid: 'codex-dev-user', createdAt: new Date(), updatedAt: new Date(),
      });
      await setDoc(doc(db, 'claimRequests', 'pending_vouch_request'), {
        requestedByUid: ownerUid,
        claimantUid: ownerUid,
        contributorId: 'unclaimed_contributor',
        status: 'pending',
        eligibleVoterUids: ['eligible_voter'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'claimRequests', 'legacy_claimant_vouch_request'), {
        claimantUid: ownerUid,
        contributorId: 'unclaimed_contributor',
        status: 'pending',
        eligibleVoterUids: ['eligible_voter'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'claimVouches', 'pending_vouch_request'), {
        claimRequestId: 'pending_vouch_request',
        voterUid: 'eligible_voter',
        vote: 'yes',
        createdAt: new Date(),
      });
      await setDoc(doc(db, 'claimVouches', 'pending_vouch_request', 'votes', 'eligible_voter'), {
        claimRequestId: 'pending_vouch_request',
        voterUid: 'eligible_voter',
        vote: 'yes',
        status: 'submitted',
        createdAt: new Date(),
      });
      await setDoc(doc(db, 'claimVouches', 'legacy_claimant_vouch_request', 'votes', 'eligible_voter'), {
        claimRequestId: 'legacy_claimant_vouch_request',
        voterUid: 'eligible_voter',
        vote: 'yes',
        status: 'submitted',
        createdAt: new Date(),
      });
      await setDoc(doc(db, 'users', 'eligible_voter'), {
        onboardingComplete: true,
        uid: 'eligible_voter',
        displayName: 'Eligible Voter',
        ageVerified: true,
        isAdult: true,
        didit: { status: 'approved' },
        idv: { status: 'approved' },
      });
      await setDoc(doc(db, 'posts', 'legacy_without_moderation'), {
        authorId: ownerUid,
        title: 'Legacy title',
        description: 'Legacy description',
        imageUrl: 'https://example.com/legacy.jpg',
        storagePath: 'uploads/legacy.jpg',
        uploadId: 'upload_legacy',
        makerTags: [],
        contributors: [],
        credits: [{ uid: 'credit_1', role: 'model' }],
        contributorIds: ['credit_1'],
        likes: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'posts', 'pre_consent_moderated'), {
        authorId: ownerUid,
        title: 'Pre-consent moderated title',
        description: 'Pre-consent moderated description',
        imageUrl: 'https://example.com/pre-consent.jpg',
        storagePath: 'uploads/pre-consent.jpg',
        uploadId: 'upload_pre_consent',
        makerTags: [],
        contributors: [],
        credits: [{ uid: ownerUid, role: 'photographer', name: 'Owner One', isSelf: true }],
        contributorIds: [ownerUid],
        outcome: 'allowed',
        shouldReview: false,
        reviewStatus: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    const publicDb = testEnv.unauthenticatedContext().firestore();
    const ownerDb = authedContext(testEnv, ownerUid, { email_verified: true }).firestore();
    const ownerEmailFalseAdultDb = authedContext(testEnv, ownerUid, { email_verified: false, idvVerified: true, isAdult: true }).firestore();
    const ownerEmailOnlyDb = authedContext(testEnv, ownerUid, { email_verified: true, __adultDefaults: false }).firestore();
    const ownerIdvFalseDb = authedContext(testEnv, ownerUid, { email_verified: true, idvVerified: false, isAdult: true }).firestore();
    const ownerAdultFalseDb = authedContext(testEnv, ownerUid, { email_verified: true, idvVerified: true, isAdult: false }).firestore();
    const ownerUnverifiedDb = authedContext(testEnv, ownerUid).firestore();
    const codexDevDb = authedContext(testEnv, 'codex-dev-user', { devCodex: true, devActor: 'codex', email_verified: false }).firestore();
    const otherDb = authedContext(testEnv, otherUid, { email_verified: true }).firestore();
    const publicUserDbFor = (uid) => authedContext(testEnv, uid, { email_verified: true }).firestore();
    const moderatorDb = authedContext(testEnv, 'mod_1', { email_verified: true, email: 'mod_1@example.com' }).firestore();
    const agencyOwnerDb = authedContext(testEnv, 'agency_owner', { email_verified: true }).firestore();
    const companyOwnerDb = authedContext(testEnv, 'company_owner', { email_verified: true }).firestore();
    const agencyOtherDb = authedContext(testEnv, 'agency_other', { email_verified: true }).firestore();
    const companyOtherDb = authedContext(testEnv, 'company_other', { email_verified: true }).firestore();
    const talentDb = authedContext(testEnv, 'talent_pending', { email_verified: true }).firestore();
    const talentCardDb = authedContext(testEnv, 'talent_card', { email_verified: true }).firestore();
    const talentBatchCardDb = authedContext(testEnv, 'talent_batch_card', { email_verified: true }).firestore();
    const teamDb = authedContext(testEnv, 'team_pending', { email_verified: true }).firestore();
    const teamCardDb = authedContext(testEnv, 'team_card', { email_verified: true }).firestore();
    const teamBatchCardDb = authedContext(testEnv, 'team_batch_card', { email_verified: true }).firestore();
    const selfWithdrawDb = authedContext(testEnv, 'self_withdraw', { email_verified: true }).firestore();
    const ownerUnverifiedRulesDb = authedContext(testEnv, ownerUid, { email_verified: false, __adultDefaults: false }).firestore();
    const eligibleVoterDb = authedContext(testEnv, 'eligible_voter', { email_verified: true }).firestore();

    await assertFails(updateDoc(doc(ownerDb, 'users', ownerUid), { isDevTestUser: true, devActor: 'codex' }));
    await assertFails(deleteDoc(doc(codexDevDb, 'users', 'codex-dev-user')));
    await assertFails(updateDoc(doc(codexDevDb, 'users', 'codex-dev-user'), { isDevTestUser: false, devActor: 'ordinary' }));
    await testEnv.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'users', 'deletable_ordinary'), { uid: 'deletable_ordinary' }));
    await assertSucceeds(deleteDoc(doc(publicUserDbFor('deletable_ordinary'), 'users', 'deletable_ordinary')));

    for (const uid of ['legacy_step_5', 'legacy_step_10']) {
      await assertSucceeds(setDoc(doc(publicUserDbFor(uid), 'publicUsers', uid), {
        uid,
        profileId: uid,
        ownerUid: uid,
        username: uid.replaceAll('_', ''),
        onboardingComplete: true,
      }));
    }
    await assertFails(setDoc(doc(publicUserDbFor('legacy_step_11'), 'publicUsers', 'legacy_step_11'), {
      uid: 'legacy_step_11',
      profileId: 'legacy_step_11',
      ownerUid: 'legacy_step_11',
      username: 'legacystep11',
      onboardingComplete: true,
    }));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'threads', 'dm_owner_other_rules'), {
        type: 'dm',
        participantUids: [ownerUid, otherUid],
        participants: [ownerUid, otherUid],
        dmKey: 'owner_1_other_1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'threads', 'dm_without_owner_rules'), {
        type: 'dm',
        userUid: ownerUid,
        participantUids: ['agency_owner', 'company_owner'],
        participants: [ownerUid, 'agency_owner'],
        dmKey: 'agency_owner_company_owner',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'threads', 'dm_without_owner_rules', 'messages', 'canonical_only_message'), {
        type: 'text',
        senderUid: 'agency_owner',
        text: 'Existing message in a malformed DM thread.',
        createdAt: new Date(),
      });
      await setDoc(doc(db, 'threads', 'dm_legacy_owner_other_rules'), {
        type: 'dm',
        participants: [ownerUid, otherUid],
        dmKey: 'legacy_owner_1_other_1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'threads', 'dm_codex_owner_legacy'), {
        type: 'dm', participantUids: ['codex-dev-user', ownerUid], dmKey: 'codex-dev-user_owner_1', createdAt: new Date(), updatedAt: new Date(),
      });
      await setDoc(doc(db, 'threads', 'support_owner_rules'), {
        type: 'support',
        userUid: ownerUid,
        threadKey: 'support_owner_rules',
        userCanSend: true,
        userMessageAllowance: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'threads', 'support_other_rules'), {
        type: 'support',
        userUid: otherUid,
        threadKey: 'support_other_rules',
        userCanSend: true,
        userMessageAllowance: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'threads', 'ordinary_private_dm'), { type: 'dm', participantUids: [ownerUid, otherUid] });
      await setDoc(doc(db, 'threads', 'ordinary_private_dm', 'messages', 'secret'), { senderUid: ownerUid, text: 'private' });
      await setDoc(doc(db, 'threads', 'support_other_rules', 'messages', 'secret'), { senderUid: otherUid, text: 'support private' });
    });

    await assertSucceeds(setDoc(doc(ownerDb, 'threads', 'dm_owner_other_rules', 'messages', 'owner_text'), {
      type: 'text',
      senderUid: ownerUid,
      text: 'Allowed DM message from a participant.',
      createdAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(ownerDb, 'threads', 'dm_owner_other_rules')));
    await assertSucceeds(getDoc(doc(ownerDb, 'threads', 'dm_owner_other_rules', 'messages', 'owner_text')));
    await assertFails(setDoc(doc(ownerDb, 'threads', 'dm_without_owner_rules', 'messages', 'owner_non_participant_text'), {
      type: 'text',
      senderUid: ownerUid,
      text: 'Blocked because owner_1 is not a participant.',
      createdAt: serverTimestamp(),
    }));
    await assertFails(getDoc(doc(ownerDb, 'threads', 'dm_without_owner_rules')));
    await assertFails(getDoc(doc(ownerDb, 'threads', 'dm_without_owner_rules', 'messages', 'canonical_only_message')));
    await assertFails(setDoc(doc(ownerDb, 'threads', 'dm_owner_other_rules', 'messages', 'spoofed_sender_text'), {
      type: 'text',
      senderUid: otherUid,
      text: 'Blocked because senderUid is spoofed.',
      createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ownerDb, 'threads', 'dm_without_owner_rules', 'messages', 'missing_participant_uid_text'), {
      type: 'text',
      senderUid: ownerUid,
      text: 'Blocked because participantUids does not include the sender.',
      createdAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ownerDb, 'threads', 'dm_without_owner_rules'), {
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageText: 'Blocked metadata update because participantUids is canonical.',
      lastSenderUid: ownerUid,
    }));
    await assertSucceeds(setDoc(doc(ownerDb, 'threads', 'dm_legacy_owner_other_rules', 'messages', 'legacy_owner_text'), {
      type: 'text',
      senderUid: ownerUid,
      text: 'Allowed legacy DM message when only participants exists.',
      createdAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(ownerDb, 'threads', 'dm_legacy_owner_other_rules')));
    await assertSucceeds(getDoc(doc(ownerDb, 'threads', 'dm_legacy_owner_other_rules', 'messages', 'legacy_owner_text')));
    await assertFails(setDoc(doc(ownerDb, 'threads', 'dm_codex_owner_legacy', 'messages', 'blocked_legacy_message'), {
      type: 'text', senderUid: ownerUid, text: 'Must stay retired', createdAt: serverTimestamp(),
    }));
    await assertFails(getDoc(doc(ownerDb, 'threads', 'dm_codex_owner_legacy')));
    await assertSucceeds(setDoc(doc(ownerDb, 'threads', 'dm_new_matching_participants_rules'), {
      type: 'dm',
      participantUids: [ownerUid, otherUid],
      participants: [otherUid, ownerUid],
      dmKey: 'owner_1_other_1_matching',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ownerDb, 'threads', 'dm_owner_codex_blocked'), {
      type: 'dm',
      participantUids: [ownerUid, 'codex-dev-user'],
      dmKey: 'codex-dev-user_owner_1',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(codexDevDb, 'threads', 'dm_codex_owner_blocked'), {
      type: 'dm',
      participantUids: ['codex-dev-user', ownerUid],
      dmKey: 'codex-dev-user_owner_1',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'codex-dev-user'), {
      targetUid: 'codex-dev-user',
      createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(codexDevDb, 'users', 'codex-dev-user', 'following', ownerUid), {
      targetUid: ownerUid,
      createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ownerDb, 'threads', 'dm_new_extra_participants_rules'), {
      type: 'dm',
      participantUids: [ownerUid, otherUid],
      participants: [ownerUid, otherUid, 'agency_owner'],
      dmKey: 'owner_1_other_1_extra',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ownerDb, 'threads', 'dm_new_different_participants_rules'), {
      type: 'dm',
      participantUids: [ownerUid, otherUid],
      participants: [ownerUid, 'agency_owner'],
      dmKey: 'owner_1_other_1_different',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(publicDb, 'threads', 'dm_owner_other_rules', 'messages', 'unauth_text'), {
      type: 'text',
      senderUid: ownerUid,
      text: 'Blocked because the request is unauthenticated.',
      createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ownerUnverifiedRulesDb, 'threads', 'dm_without_owner_rules', 'messages', 'unverified_non_participant_text'), {
      type: 'text',
      senderUid: ownerUid,
      text: 'Blocked because unverified non-participants cannot write messages.',
      createdAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(ownerDb, 'threads', 'support_owner_rules', 'messages', 'owner_support_text'), {
      type: 'text',
      senderUid: ownerUid,
      senderRole: 'user',
      text: 'Allowed support message from the thread owner.',
      createdAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(ownerDb, 'threads', 'support_owner_rules')));
    await assertSucceeds(getDoc(doc(ownerDb, 'threads', 'support_owner_rules', 'messages', 'owner_support_text')));
    await assertFails(setDoc(doc(ownerDb, 'threads', 'support_other_rules', 'messages', 'other_support_text'), {
      type: 'text',
      senderUid: ownerUid,
      senderRole: 'user',
      text: 'Blocked because owner_1 does not own this support thread.',
      createdAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(moderatorDb, 'threads', 'support_owner_rules', 'messages', 'moderator_support_text'), {
      type: 'text',
      senderUid: 'mod_1',
      senderRole: 'moderator',
      text: 'Allowed support message from a moderator.',
      createdAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(moderatorDb, 'threads', 'support_owner_rules')));
    await assertSucceeds(getDoc(doc(moderatorDb, 'threads', 'support_owner_rules', 'messages', 'owner_support_text')));
    await assertFails(getDoc(doc(codexDevDb, 'threads', 'ordinary_private_dm')));
    await assertFails(getDoc(doc(codexDevDb, 'threads', 'ordinary_private_dm', 'messages', 'secret')));
    await assertFails(getDoc(doc(codexDevDb, 'threads', 'support_other_rules')));
    await assertFails(getDoc(doc(codexDevDb, 'threads', 'support_other_rules', 'messages', 'secret')));
    await assertSucceeds(getDoc(doc(ownerDb, 'threads', 'ordinary_private_dm')));
    await assertFails(setDoc(doc(publicDb, 'threads', 'support_owner_rules', 'messages', 'unauth_support_text'), {
      type: 'text',
      senderUid: ownerUid,
      senderRole: 'user',
      text: 'Blocked because the support request is unauthenticated.',
      createdAt: serverTimestamp(),
    }));

    await assertSucceeds(getDoc(doc(ownerDb, 'announcements', 'active_update')));
    await assertFails(getDoc(doc(ownerDb, 'announcements', 'draft_update')));
    await assertFails(setDoc(doc(ownerDb, 'announcements', 'hacked'), { title: 'x' }));
    await assertSucceeds(setDoc(doc(moderatorDb, 'announcements', 'mod_update'), {
      type: 'appUpdate',
      title: 'Moderator update',
      body: 'Nieuwe release',
      status: 'active',
      isCurrent: true,
      version: 3,
    }));

    await assertSucceeds(getDoc(doc(publicDb, 'profiles', 'active_agency_profile')));
    await assertFails(getDoc(doc(publicDb, 'profiles', 'private_agency_profile')));
    await assertSucceeds(getDoc(doc(ownerDb, 'profiles', 'private_agency_profile')));
    await assertFails(setDoc(doc(ownerDb, 'profiles', ownerUid), {
      type: 'company',
      displayName: 'Collision Company Profile Write',
      ownerUid,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ownerDb, 'profiles', ownerUid), {
      displayName: 'Collision Company Profile Updated',
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(deleteDoc(doc(ownerDb, 'profiles', ownerUid)));
    await assertSucceeds(setDoc(doc(ownerDb, 'profiles', 'owner_company_profile'), {
      type: 'company',
      displayName: 'Owner Company Profile',
      ownerUid,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(ownerDb, 'profiles', 'owner_company_profile'), {
      displayName: 'Owner Company Profile Updated',
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(codexDevDb, 'profiles', 'codex_company_profile'), {
      type: 'company', displayName: 'Codex Company', ownerUid: 'codex-dev-user', status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(codexDevDb, 'profiles', 'legacy_codex_profile'), {
      displayName: 'Published Codex Agency', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(ownerDb, 'profiles', 'owner_company_profile'), {
      displayName: 'Owner Company Profile With Bio',
      bio: 'Korte omschrijving voor publiek profiel',
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(ownerDb, 'profiles', 'owner_company_profile'), {
      bio: '',
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(ownerDb, 'profiles', 'owner_company_profile'), {
      avatar: 'https://firebasestorage.googleapis.com/v0/b/demo/o/managedProfiles%2Fowner_uid%2Fowner_company_profile%2Favatar%2Favatar.jpg',
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(otherDb, 'profiles', 'owner_company_profile'), {
      avatar: 'https://example.test/hijack.jpg',
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ownerDb, 'profiles', 'owner_company_profile'), {
      bio: 'x'.repeat(501),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ownerDb, 'profiles', 'owner_company_profile'), {
      ownerUid: otherUid,
      avatar: 'https://example.test/spoof.jpg',
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ownerDb, 'profiles', 'owner_company_profile'), {
      type: 'agency',
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ownerDb, 'profiles', 'manager_uids_not_allowed_profile'), {
      type: 'agency',
      displayName: 'Manager Uids Not Allowed Profile',
      ownerUid,
      managerUids: [ownerUid],
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ownerDb, 'profiles', 'owner_company_profile'), {
      managerUids: [ownerUid],
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(ownerDb, 'profiles', 'owner_collective_profile'), {
      type: 'collective',
      displayName: 'Owner Collective Profile',
      bio: 'Collectief omschrijving',
      ownerUid,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(otherDb, 'profiles', 'spoofed_company_profile'), {
      type: 'company',
      displayName: 'Spoofed Company Profile',
      ownerUid,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(otherDb, 'profiles', 'owner_company_profile'), {
      displayName: 'Hijacked Company Profile',
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ownerDb, 'profiles', 'legal_identity_profile'), {
      type: 'agency',
      displayName: 'Legal Identity Profile',
      ownerUid,
      status: 'active',
      legalName: 'Private Legal BV',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ownerDb, 'profiles', 'personal_profile_not_allowed'), {
      type: 'personal',
      displayName: 'Personal Profile Not Allowed',
      ownerUid,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(deleteDoc(doc(otherDb, 'profiles', 'owner_company_profile')));
    await assertSucceeds(deleteDoc(doc(ownerDb, 'profiles', 'owner_company_profile')));

    await assertSucceeds(setDoc(doc(ownerDb, 'users', ownerUid, 'announcementReads', 'active_update'), {
      dismissedAt: serverTimestamp(),
      version: 2,
    }));
    await assertFails(setDoc(doc(otherDb, 'users', ownerUid, 'announcementReads', 'active_update'), {
      dismissedAt: serverTimestamp(),
      version: 2,
    }));

    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        displayName: 'Owner Prime',
      }),
    );

    // Compat: owner can still update normal public profile fields,
    // even when counter fields already exist on the doc.
    await assertSucceeds(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        displayName: 'Owner Prime',
        displayNameLower: 'owner prime',
        email: deleteField(),
      }),
    );

    await assertSucceeds(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        quickProfilePreviewMode: 'manual',
        quickProfilePostIds: ['post_1', 'post_2'],
      }),
    );

    await assertSucceeds(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        profileId: ownerUid,
        ownerUid,
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        profileId: 'other_profile',
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        ownerUid: otherUid,
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        quickProfilePreviewMode: 123,
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        quickProfilePostIds: 'post_1',
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        fansCount: 99,
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        fanOfCount: 99,
      }),
    );

    // Also deny mixed payloads where a normal field update attempts
    // to sneak in a counter write.
    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        displayName: 'Owner Prime 2',
        fansCount: 100,
      }),
    );

    await assertFails(
      updateDoc(doc(otherDb, 'publicUsers', ownerUid), {
        displayName: 'Impersonation Attempt',
      }),
    );

    await assertFails(
      setDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        onboardingComplete: true,
        uid: 'other_uid',
        username: 'owner1',
        displayName: 'Owner One',
        displayNameLower: 'owner one',
        updatedAt: new Date(),
      }, { merge: true }),
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        onboardingComplete: true,
        username: 'owner1',
        displayName: 'Owner No Uid',
        displayNameLower: 'owner no uid',
        updatedAt: new Date(),
      }, { merge: true }),
    );


    await assertSucceeds(
      setDoc(doc(publicUserDbFor('ownerusernameonly'), 'publicUsers', 'ownerusernameonly'), {
        onboardingComplete: true,
        uid: 'ownerusernameonly',
        profileId: 'ownerusernameonly',
        ownerUid: 'ownerusernameonly',
        username: 'ownerusernameonly',
        updatedAt: new Date(),
      }),
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        onboardingComplete: true,
        username: 'owner1',
        displayName: 'Owner With Display Name',
        displayNameLower: 'owner with display name',
        updatedAt: new Date(),
      }, { merge: true }),
    );

    await assertFails(
      setDoc(doc(publicUserDbFor('displaynamemissinglower'), 'publicUsers', 'displaynamemissinglower'), {
        onboardingComplete: true,
        username: 'missinglower',
        displayName: 'Missing Lower',
        updatedAt: new Date(),
      }),
    );

    await assertFails(
      setDoc(doc(publicUserDbFor('displaylowermissingname'), 'publicUsers', 'displaylowermissingname'), {
        onboardingComplete: true,
        username: 'missingname',
        displayNameLower: 'missing name',
        updatedAt: new Date(),
      }),
    );

    await assertFails(
      setDoc(doc(publicUserDbFor('publicemailleak'), 'publicUsers', 'publicemailleak'), {
        onboardingComplete: true,
        username: 'publicemailleak',
        email: 'private@example.com',
        updatedAt: new Date(),
      }),
    );

    await assertFails(
      setDoc(doc(publicUserDbFor('publiclegalleak'), 'publicUsers', 'publiclegalleak'), {
        onboardingComplete: true,
        username: 'publiclegalleak',
        legalName: 'Private Legal Name',
        updatedAt: new Date(),
      }),
    );

    await assertFails(
      setDoc(doc(publicUserDbFor('publicdiditleak'), 'publicUsers', 'publicdiditleak'), {
        onboardingComplete: true,
        username: 'publicdiditleak',
        didit: { status: 'approved' },
        updatedAt: new Date(),
      }),
    );

    await assertFails(
      setDoc(doc(publicUserDbFor('providerdataleak'), 'publicUsers', 'providerdataleak'), {
        onboardingComplete: true,
        username: 'providerdataleak',
        providerData: [{ providerId: 'google.com', displayName: 'Google Name' }],
        updatedAt: new Date(),
      }),
    );

    await assertSucceeds(
      updateDoc(doc(publicUserDbFor('legacy_auth_provider_user'), 'publicUsers', 'legacy_auth_provider_user'), {
        username: 'legacyauthclean',
        authProvider: deleteField(),
      }),
    );

    await assertSucceeds(
      updateDoc(doc(publicUserDbFor('legacy_email_auth_user'), 'publicUsers', 'legacy_email_auth_user'), {
        displayName: 'Legacy Cleaned Name',
        displayNameLower: 'legacy cleaned name',
        email: deleteField(),
        authProvider: deleteField(),
      }),
    );

    await assertSucceeds(
      updateDoc(doc(publicUserDbFor('legacy_cleanup_only_user'), 'publicUsers', 'legacy_cleanup_only_user'), {
        email: deleteField(),
        authProvider: deleteField(),
      }),
    );

    await assertFails(
      updateDoc(doc(publicUserDbFor('legacy_auth_provider_user'), 'publicUsers', 'legacy_auth_provider_user'), {
        username: 'legacyauthbad',
        authProvider: 'google.com',
      }),
    );

    await assertFails(
      setDoc(doc(publicUserDbFor('authproviderleak'), 'publicUsers', 'authproviderleak'), {
        onboardingComplete: true,
        username: 'authproviderleak',
        authProvider: 'google.com',
        updatedAt: new Date(),
      }),
    );

    await assertFails(
      setDoc(doc(otherDb, 'publicUsers', ownerUid), {
        onboardingComplete: true,
        username: 'otherowner',
        updatedAt: new Date(),
      }),
    );

    await assertFails(
      updateDoc(doc(otherDb, 'publicUsers', ownerUid), {
        username: 'otherowner',
      }),
    );

    await assertSucceeds(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        username: 'ownerprime',
      }),
    );

    await assertSucceeds(
      updateDoc(doc(publicUserDbFor('ownerusernameonly'), 'publicUsers', 'ownerusernameonly'), {
        username: 'ownerusernameonly2',
      }),
    );

    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid), {
        moderator: true,
      }, { merge: true }),
    );

    await assertFails(
      setDoc(doc(ownerUnverifiedDb, 'contributors', 'non_adult_contributor_create'), {
        displayName: 'Non Adult',
        displayNameLower: 'non adult',
        status: 'unclaimed',
        createdByUid: ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(ownerDb, 'contributors', 'adult_contributor_create'), {
        displayName: 'Adult Contributor',
        displayNameLower: 'adult contributor',
        roles: ['photographer'],
        socials: { instagram: 'adult' },
        status: 'unclaimed',
        createdByUid: ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        source: 'client',
        claimedByUid: null,
        mergedInto: null,
      }),
    );
    await assertFails(
      setDoc(doc(codexDevDb, 'contributors', 'codex_direct_without_creator'), {
        displayName: 'Codex Direct Contributor',
        displayNameLower: 'codex direct contributor',
        status: 'unclaimed',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(doc(codexDevDb, 'contributors', 'codex_claimed_contributor'), { bio: 'Codex production edit' }));
    await assertFails(
      setDoc(doc(ownerDb, 'contributors', 'email_contributor_create'), {
        displayName: 'Email Contributor',
        status: 'unclaimed',
        createdByUid: ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        email: 'leak@example.com',
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, 'contributors', 'spoofed_claimed_contributor_create'), {
        displayName: 'Spoofed Claimed Contributor',
        status: 'unclaimed',
        createdByUid: ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        claimedByUid: otherUid,
      }),
    );
    await assertSucceeds(
      updateDoc(doc(ownerDb, 'contributors', 'claimed_contributor'), {
        bio: 'Updated safe public bio',
        displayName: 'Claimed Contributor Public Name',
        displayNameLower: 'claimed contributor public name',
        socials: { instagram: 'claimed' },
      }),
    );
    await assertFails(
      updateDoc(doc(ownerDb, 'contributors', 'claimed_contributor'), {
        status: 'unclaimed',
      }),
    );
    await assertFails(
      updateDoc(doc(ownerDb, 'contributors', 'claimed_contributor'), {
        claimedByUid: otherUid,
      }),
    );
    await assertFails(
      updateDoc(doc(ownerDb, 'contributors', 'claimed_contributor'), {
        mergedInto: 'other_contributor',
      }),
    );
    await assertFails(
      setDoc(doc(ownerUnverifiedDb, 'claimRequests', 'non_adult_claim_request_create'), {
        claimantUid: ownerUid,
        contributorId: 'unclaimed_contributor',
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(ownerDb, 'claimRequests', 'adult_claim_request_create'), {
        claimantUid: ownerUid,
        contributorId: 'unclaimed_contributor',
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        proofMetadata: { method: 'vouch', note: 'public proof summary' },
      }),
    );
    await assertFails(setDoc(doc(codexDevDb, 'claimRequests', 'codex_claim_request_denied'), {
      claimantUid: 'codex-dev-user', contributorId: 'unclaimed_contributor', status: 'pending', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(
      setDoc(doc(ownerDb, 'claimRequests', 'approved_claim_request_create'), {
        claimantUid: ownerUid,
        contributorId: 'unclaimed_contributor',
        status: 'approved',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, 'claimRequests', 'eligible_voters_claim_request_create'), {
        claimantUid: ownerUid,
        contributorId: 'unclaimed_contributor',
        status: 'pending',
        eligibleVoterUids: ['eligible_voter'],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, 'claimRequests', 'eligible_vouchers_claim_request_create'), {
        claimantUid: ownerUid,
        contributorId: 'unclaimed_contributor',
        status: 'pending',
        eligibleVoucherUids: ['eligible_voter'],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, 'claimRequests', 'spoofed_claim_request_create'), {
        claimantUid: otherUid,
        contributorId: 'unclaimed_contributor',
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, 'claimRequests', 'claimed_by_other_request_create'), {
        claimantUid: ownerUid,
        contributorId: 'other_claimed_contributor',
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      getDoc(doc(ownerDb, 'claimRequests', 'pending_vouch_request')),
    );
    await assertSucceeds(
      getDoc(doc(ownerDb, 'claimRequests', 'legacy_claimant_vouch_request')),
    );
    await assertSucceeds(
      getDoc(doc(moderatorDb, 'claimRequests', 'pending_vouch_request')),
    );
    await assertFails(
      getDoc(doc(otherDb, 'claimRequests', 'pending_vouch_request')),
    );
    await assertFails(
      setDoc(doc(eligibleVoterDb, 'claimVouches', 'direct_top_level_vouch'), {
        claimRequestId: 'pending_vouch_request',
        voterUid: 'eligible_voter',
        vote: 'yes',
        status: 'submitted',
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(eligibleVoterDb, 'claimVouches', 'pending_vouch_request', 'votes', 'eligible_voter_direct'), {
        claimRequestId: 'pending_vouch_request',
        voterUid: 'eligible_voter',
        vote: 'yes',
        status: 'submitted',
        createdAt: serverTimestamp(),
      }),
    );
    // submitClaimVouch is intentionally not exercised through Firestore rules;
    // it writes these vote docs with the Admin SDK inside a transaction.
    await assertFails(
      setDoc(doc(otherDb, 'claimVouches', 'pending_vouch_request', 'votes', otherUid), {
        claimRequestId: 'pending_vouch_request',
        voterUid: otherUid,
        vote: 'yes',
        status: 'submitted',
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(eligibleVoterDb, 'claimVouches', 'pending_vouch_request', 'votes', 'eligible_voter_spoof'), {
        claimRequestId: 'pending_vouch_request',
        voterUid: otherUid,
        vote: 'yes',
        status: 'submitted',
        createdAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      getDoc(doc(eligibleVoterDb, 'claimVouches', 'pending_vouch_request', 'votes', 'eligible_voter')),
    );
    await assertSucceeds(
      getDoc(doc(ownerDb, 'claimVouches', 'pending_vouch_request', 'votes', 'eligible_voter')),
    );
    await assertSucceeds(
      getDoc(doc(ownerDb, 'claimVouches', 'legacy_claimant_vouch_request', 'votes', 'eligible_voter')),
    );
    await assertSucceeds(
      getDoc(doc(moderatorDb, 'claimVouches', 'pending_vouch_request', 'votes', 'eligible_voter')),
    );
    await assertFails(
      getDoc(doc(otherDb, 'claimVouches', 'pending_vouch_request', 'votes', 'eligible_voter')),
    );
    await assertSucceeds(
      getDoc(doc(ownerDb, 'claimVouches', 'pending_vouch_request')),
    );
    await assertFails(
      updateDoc(doc(eligibleVoterDb, 'claimVouches', 'pending_vouch_request', 'votes', 'eligible_voter'), {
        vote: 'no',
      }),
    );
    await assertFails(
      deleteDoc(doc(eligibleVoterDb, 'claimVouches', 'pending_vouch_request', 'votes', 'eligible_voter')),
    );
    await assertSucceeds(
      updateDoc(doc(moderatorDb, 'claimRequests', 'pending_vouch_request'), {
        status: 'approved',
      }),
    );
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid), {
        claims: { moderator: true },
      }, { merge: true }),
    );

    await assertFails(
      setDoc(doc(talentDb, 'users', 'talent_pending'), {
        linkedAgencyStatus: 'approved',
      }, { merge: true }),
    );
    await assertFails(
      setDoc(doc(teamDb, 'users', 'team_pending'), {
        linkedCompanyStatus: 'approved',
      }, { merge: true }),
    );
    await assertFails(
      setDoc(doc(talentDb, 'users', 'talent_pending'), {
        linkedAgencyStatus: 'verified',
      }, { merge: true }),
    );
    await assertFails(
      setDoc(doc(teamDb, 'users', 'team_pending'), {
        linkedCompanyStatus: 'verified',
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(talentDb, 'users', 'talent_pending'), {
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(teamDb, 'users', 'team_pending'), {
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(agencyOwnerDb, 'users', 'talent_pending'), {
        linkedAgencyStatus: 'approved',
        linkedAgencyStatusUpdatedAt: serverTimestamp(),
        linkedAgencyApprovedAt: serverTimestamp(),
        linkedAgencyApprovedBy: 'agency_owner',
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertFails(
      setDoc(doc(otherDb, 'users', 'talent_pending'), {
        linkedAgencyStatus: 'approved',
        linkedAgencyStatusUpdatedAt: serverTimestamp(),
        linkedAgencyApprovedAt: serverTimestamp(),
        linkedAgencyApprovedBy: otherUid,
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(companyOwnerDb, 'users', 'team_pending'), {
        linkedCompanyStatus: 'approved',
        linkedCompanyStatusUpdatedAt: serverTimestamp(),
        linkedCompanyApprovedAt: serverTimestamp(),
        linkedCompanyApprovedBy: 'company_owner',
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertFails(
      setDoc(doc(otherDb, 'users', 'team_pending'), {
        linkedCompanyStatus: 'approved',
        linkedCompanyStatusUpdatedAt: serverTimestamp(),
        linkedCompanyApprovedAt: serverTimestamp(),
        linkedCompanyApprovedBy: otherUid,
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertFails(
      setDoc(doc(agencyOtherDb, 'users', 'talent_pending'), {
        linkedAgencyStatus: 'approved',
        linkedAgencyStatusUpdatedAt: serverTimestamp(),
        linkedAgencyApprovedAt: serverTimestamp(),
        linkedAgencyApprovedBy: 'agency_other',
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertFails(
      setDoc(doc(companyOtherDb, 'users', 'team_pending'), {
        linkedCompanyStatus: 'approved',
        linkedCompanyStatusUpdatedAt: serverTimestamp(),
        linkedCompanyApprovedAt: serverTimestamp(),
        linkedCompanyApprovedBy: 'company_other',
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertFails(
      setDoc(doc(talentDb, 'publicUsers', 'talent_pending'), {
        onboardingComplete: true,
        linkedAgencyStatus: 'approved',
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(agencyOwnerDb, 'publicUsers', 'talent_pending'), {
        onboardingComplete: true,
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'approved',
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(agencyOwnerDb, 'users', 'talent_reject'), {
        linkedAgencyId: null,
        linkedAgencyName: '',
        linkedAgencyStatus: 'rejected',
        linkedAgencyStatusUpdatedAt: serverTimestamp(),
        linkedAgencyApprovedAt: deleteField(),
        linkedAgencyApprovedBy: deleteField(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(agencyOwnerDb, 'publicUsers', 'talent_reject'), {
        onboardingComplete: true,
        linkedAgencyId: null,
        linkedAgencyName: '',
        linkedAgencyStatus: deleteField(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(companyOwnerDb, 'users', 'team_reject'), {
        linkedCompanyId: null,
        linkedCompanyName: '',
        linkedCompanyStatus: 'rejected',
        linkedCompanyStatusUpdatedAt: serverTimestamp(),
        linkedCompanyApprovedAt: deleteField(),
        linkedCompanyApprovedBy: deleteField(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(companyOwnerDb, 'publicUsers', 'team_reject'), {
        onboardingComplete: true,
        linkedCompanyId: null,
        linkedCompanyName: '',
        linkedCompanyStatus: deleteField(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(agencyOwnerDb, 'users', 'talent_remove'), {
        linkedAgencyId: null,
        linkedAgencyName: '',
        linkedAgencyStatus: 'removed',
        linkedAgencyStatusUpdatedAt: serverTimestamp(),
        linkedAgencyApprovedAt: deleteField(),
        linkedAgencyApprovedBy: deleteField(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(agencyOwnerDb, 'publicUsers', 'talent_remove'), {
        onboardingComplete: true,
        linkedAgencyId: null,
        linkedAgencyName: '',
        linkedAgencyStatus: deleteField(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(companyOwnerDb, 'users', 'team_remove'), {
        linkedCompanyId: null,
        linkedCompanyName: '',
        linkedCompanyStatus: 'removed',
        linkedCompanyStatusUpdatedAt: serverTimestamp(),
        linkedCompanyApprovedAt: deleteField(),
        linkedCompanyApprovedBy: deleteField(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(companyOwnerDb, 'publicUsers', 'team_remove'), {
        onboardingComplete: true,
        linkedCompanyId: null,
        linkedCompanyName: '',
        linkedCompanyStatus: deleteField(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertFails(
      setDoc(doc(otherDb, 'users', 'talent_remove'), {
        linkedAgencyId: null,
        linkedAgencyName: '',
        linkedAgencyStatus: 'removed',
        linkedAgencyStatusUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(selfWithdrawDb, 'users', 'self_withdraw'), {
        linkedAgencyId: null,
        linkedAgencyName: '',
        linkedAgencyStatus: deleteField(),
        linkedAgencyStatusUpdatedAt: deleteField(),
        linkedAgencyApprovedAt: deleteField(),
        linkedAgencyApprovedBy: deleteField(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(selfWithdrawDb, 'publicUsers', 'self_withdraw'), {
        onboardingComplete: true,
        username: 'selfwithdraw',
        displayName: 'Self Withdraw',
        displayNameLower: 'self withdraw',
        linkedAgencyId: null,
        linkedAgencyName: '',
        linkedAgencyStatus: deleteField(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    );

    const agencyBatch = writeBatch(talentBatchCardDb);
    agencyBatch.set(doc(talentBatchCardDb, 'threads', 'dm_agency_owner_talent_batch_card'), {
      type: 'dm',
      participantUids: ['talent_batch_card', 'agency_owner'],
      participants: ['talent_batch_card', 'agency_owner'],
      dmKey: 'agency_owner_talent_batch_card',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageText: 'Talent Batch Card wil gekoppeld worden aan Agency Owner als Talent.',
      lastSenderUid: 'talent_batch_card',
    }, { merge: true });
    agencyBatch.set(doc(talentBatchCardDb, 'threads', 'dm_agency_owner_talent_batch_card', 'messages', 'affiliation_agency_talent_batch_card_agency_owner'), {
      type: 'affiliationRequest',
      affiliationType: 'agency',
      requesterUid: 'talent_batch_card',
      organizationUid: 'agency_owner',
      targetUid: 'talent_batch_card',
      statusSnapshot: 'pending',
      text: 'Talent Batch Card wil gekoppeld worden aan Agency Owner als Talent.',
      senderUid: 'talent_batch_card',
      senderId: 'talent_batch_card',
      senderRole: 'system',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    agencyBatch.set(doc(talentBatchCardDb, 'users', 'talent_batch_card', 'threadIndex', 'dm_agency_owner_talent_batch_card'), {
      threadId: 'dm_agency_owner_talent_batch_card',
      pinned: false,
      hidden: false,
      displayTitle: 'Agency Owner',
      lastMessageAt: serverTimestamp(),
    }, { merge: true });
    agencyBatch.set(doc(talentBatchCardDb, 'users', 'agency_owner', 'threadIndex', 'dm_agency_owner_talent_batch_card'), {
      threadId: 'dm_agency_owner_talent_batch_card',
      pinned: false,
      hidden: false,
      displayTitle: 'Talent Batch Card',
      lastMessageAt: serverTimestamp(),
      hasAffiliationRequest: true,
    }, { merge: true });
    await assertSucceeds(agencyBatch.commit());

    const companyBatch = writeBatch(teamBatchCardDb);
    companyBatch.set(doc(teamBatchCardDb, 'threads', 'dm_company_owner_team_batch_card'), {
      type: 'dm',
      participantUids: ['team_batch_card', 'company_owner'],
      participants: ['team_batch_card', 'company_owner'],
      dmKey: 'company_owner_team_batch_card',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageText: 'Team Batch Card wil gekoppeld worden aan Company Owner als Team.',
      lastSenderUid: 'team_batch_card',
    }, { merge: true });
    companyBatch.set(doc(teamBatchCardDb, 'threads', 'dm_company_owner_team_batch_card', 'messages', 'affiliation_company_team_batch_card_company_owner'), {
      type: 'affiliationRequest',
      affiliationType: 'company',
      requesterUid: 'team_batch_card',
      organizationUid: 'company_owner',
      targetUid: 'team_batch_card',
      statusSnapshot: 'pending',
      text: 'Team Batch Card wil gekoppeld worden aan Company Owner als Team.',
      senderUid: 'team_batch_card',
      senderId: 'team_batch_card',
      senderRole: 'system',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    companyBatch.set(doc(teamBatchCardDb, 'users', 'team_batch_card', 'threadIndex', 'dm_company_owner_team_batch_card'), {
      threadId: 'dm_company_owner_team_batch_card',
      pinned: false,
      hidden: false,
      displayTitle: 'Company Owner',
      lastMessageAt: serverTimestamp(),
    }, { merge: true });
    companyBatch.set(doc(teamBatchCardDb, 'users', 'company_owner', 'threadIndex', 'dm_company_owner_team_batch_card'), {
      threadId: 'dm_company_owner_team_batch_card',
      pinned: false,
      hidden: false,
      displayTitle: 'Team Batch Card',
      lastMessageAt: serverTimestamp(),
      hasAffiliationRequest: true,
    }, { merge: true });
    await assertSucceeds(companyBatch.commit());

    const fakeBatch = writeBatch(otherDb);
    fakeBatch.set(doc(otherDb, 'threads', 'dm_agency_owner_fake_batch_card'), {
      type: 'dm',
      participantUids: [otherUid, 'agency_owner'],
      participants: [otherUid, 'agency_owner'],
      dmKey: 'agency_owner_other_1',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageText: 'Fake batch request',
      lastSenderUid: otherUid,
    }, { merge: true });
    fakeBatch.set(doc(otherDb, 'threads', 'dm_agency_owner_fake_batch_card', 'messages', 'fake_batch_request'), {
      type: 'affiliationRequest',
      affiliationType: 'agency',
      requesterUid: otherUid,
      organizationUid: 'agency_owner',
      targetUid: otherUid,
      statusSnapshot: 'pending',
      text: 'Fake batch request',
      senderUid: otherUid,
      senderId: otherUid,
      senderRole: 'system',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    fakeBatch.set(doc(otherDb, 'users', 'agency_owner', 'threadIndex', 'dm_agency_owner_fake_batch_card'), {
      threadId: 'dm_agency_owner_fake_batch_card',
      pinned: false,
      hidden: false,
      displayTitle: 'Fake Batch',
      lastMessageAt: serverTimestamp(),
      hasAffiliationRequest: true,
    }, { merge: true });
    await assertFails(fakeBatch.commit());

    const unrelatedOrganizationBatch = writeBatch(talentBatchCardDb);
    unrelatedOrganizationBatch.set(doc(talentBatchCardDb, 'threads', 'dm_agency_other_talent_batch_card'), {
      type: 'dm',
      participantUids: ['talent_batch_card', 'agency_other'],
      participants: ['talent_batch_card', 'agency_other'],
      dmKey: 'agency_other_talent_batch_card',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageText: 'Fake unrelated organization request',
      lastSenderUid: 'talent_batch_card',
    }, { merge: true });
    unrelatedOrganizationBatch.set(doc(talentBatchCardDb, 'threads', 'dm_agency_other_talent_batch_card', 'messages', 'affiliation_agency_talent_batch_card_agency_other'), {
      type: 'affiliationRequest',
      affiliationType: 'agency',
      requesterUid: 'talent_batch_card',
      organizationUid: 'agency_other',
      targetUid: 'talent_batch_card',
      statusSnapshot: 'pending',
      text: 'Fake unrelated organization request',
      senderUid: 'talent_batch_card',
      senderId: 'talent_batch_card',
      senderRole: 'system',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    unrelatedOrganizationBatch.set(doc(talentBatchCardDb, 'users', 'agency_other', 'threadIndex', 'dm_agency_other_talent_batch_card'), {
      threadId: 'dm_agency_other_talent_batch_card',
      pinned: false,
      hidden: false,
      displayTitle: 'Talent Batch Card',
      lastMessageAt: serverTimestamp(),
      hasAffiliationRequest: true,
    }, { merge: true });
    await assertFails(unrelatedOrganizationBatch.commit());

    const arbitraryIndexBatch = writeBatch(talentBatchCardDb);
    arbitraryIndexBatch.set(doc(talentBatchCardDb, 'threads', 'dm_agency_owner_talent_batch_card_bad_index'), {
      type: 'dm',
      participantUids: ['talent_batch_card', 'agency_owner'],
      participants: ['talent_batch_card', 'agency_owner'],
      dmKey: 'agency_owner_talent_batch_card',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageText: 'Bad index request',
      lastSenderUid: 'talent_batch_card',
    }, { merge: true });
    arbitraryIndexBatch.set(doc(talentBatchCardDb, 'threads', 'dm_agency_owner_talent_batch_card_bad_index', 'messages', 'affiliation_agency_talent_batch_card_agency_owner'), {
      type: 'affiliationRequest',
      affiliationType: 'agency',
      requesterUid: 'talent_batch_card',
      organizationUid: 'agency_owner',
      targetUid: 'talent_batch_card',
      statusSnapshot: 'pending',
      text: 'Bad index request',
      senderUid: 'talent_batch_card',
      senderId: 'talent_batch_card',
      senderRole: 'system',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    arbitraryIndexBatch.set(doc(talentBatchCardDb, 'users', 'agency_owner', 'threadIndex', 'dm_agency_owner_talent_batch_card_bad_index'), {
      threadId: 'dm_agency_owner_talent_batch_card_bad_index',
      pinned: false,
      hidden: false,
      displayTitle: 'Talent Batch Card',
      lastMessageAt: serverTimestamp(),
      hasAffiliationRequest: true,
      arbitrary: 'not allowed',
    }, { merge: true });
    await assertFails(arbitraryIndexBatch.commit());

    await assertSucceeds(setDoc(doc(talentCardDb, 'threads', 'dm_agency_owner_talent_card'), {
      type: 'dm',
      participantUids: ['talent_card', 'agency_owner'],
      participants: ['talent_card', 'agency_owner'],
      dmKey: 'agency_owner_talent_card',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageText: 'Talent Card wil gekoppeld worden aan Agency Owner als Talent.',
      lastSenderUid: 'talent_card',
    }, { merge: true }));
    await assertSucceeds(setDoc(doc(talentCardDb, 'threads', 'dm_agency_owner_talent_card', 'messages', 'affiliation_agency_talent_card_agency_owner'), {
      type: 'affiliationRequest',
      affiliationType: 'agency',
      requesterUid: 'talent_card',
      organizationUid: 'agency_owner',
      targetUid: 'talent_card',
      statusSnapshot: 'pending',
      text: 'Talent Card wil gekoppeld worden aan Agency Owner als Talent.',
      senderUid: 'talent_card',
      senderId: 'talent_card',
      senderRole: 'system',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true }));
    await assertSucceeds(getDoc(doc(agencyOwnerDb, 'threads', 'dm_agency_owner_talent_card', 'messages', 'affiliation_agency_talent_card_agency_owner')));
    await assertFails(updateDoc(doc(otherDb, 'threads', 'dm_agency_owner_talent_card', 'messages', 'affiliation_agency_talent_card_agency_owner'), {
      statusSnapshot: 'approved',
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(agencyOwnerDb, 'threads', 'dm_agency_owner_talent_card', 'messages', 'affiliation_agency_talent_card_agency_owner'), {
      statusSnapshot: 'approved',
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(otherDb, 'threads', 'dm_agency_owner_talent_card', 'messages', 'fake_agency_request'), {
      type: 'affiliationRequest',
      affiliationType: 'agency',
      requesterUid: 'talent_card',
      organizationUid: 'agency_owner',
      targetUid: 'talent_card',
      statusSnapshot: 'pending',
      text: 'Fake request',
      senderUid: otherUid,
      senderId: otherUid,
      senderRole: 'system',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true }));

    await assertSucceeds(setDoc(doc(teamCardDb, 'threads', 'dm_company_owner_team_card'), {
      type: 'dm',
      participantUids: ['team_card', 'company_owner'],
      participants: ['team_card', 'company_owner'],
      dmKey: 'company_owner_team_card',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageText: 'Team Card wil gekoppeld worden aan Company Owner als Team.',
      lastSenderUid: 'team_card',
    }, { merge: true }));
    await assertSucceeds(setDoc(doc(teamCardDb, 'threads', 'dm_company_owner_team_card', 'messages', 'affiliation_company_team_card_company_owner'), {
      type: 'affiliationRequest',
      affiliationType: 'company',
      requesterUid: 'team_card',
      organizationUid: 'company_owner',
      targetUid: 'team_card',
      statusSnapshot: 'pending',
      text: 'Team Card wil gekoppeld worden aan Company Owner als Team.',
      senderUid: 'team_card',
      senderId: 'team_card',
      senderRole: 'system',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true }));
    await assertSucceeds(getDoc(doc(companyOwnerDb, 'threads', 'dm_company_owner_team_card', 'messages', 'affiliation_company_team_card_company_owner')));
    await assertFails(updateDoc(doc(otherDb, 'threads', 'dm_company_owner_team_card', 'messages', 'affiliation_company_team_card_company_owner'), {
      statusSnapshot: 'rejected',
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(companyOwnerDb, 'threads', 'dm_company_owner_team_card', 'messages', 'affiliation_company_team_card_company_owner'), {
      statusSnapshot: 'rejected',
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(otherDb, 'threads', 'dm_company_owner_team_card', 'messages', 'fake_company_request'), {
      type: 'affiliationRequest',
      affiliationType: 'company',
      requesterUid: 'team_card',
      organizationUid: 'company_owner',
      targetUid: 'team_card',
      statusSnapshot: 'pending',
      text: 'Fake company request',
      senderUid: otherUid,
      senderId: otherUid,
      senderRole: 'system',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true }));

    await assertSucceeds(
      setDoc(doc(ownerDb, 'users', ownerUid), {
        displayName: 'Owner Profile',
        bio: 'Allowed profile update',
        updatedAt: new Date(),
      }, { merge: true }),
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_b'), {
        targetUid: 'target_b',
        createdAt: serverTimestamp(),
      }),
    );

    await assertSucceeds(
      setDoc(doc(ownerUnverifiedDb, 'users', ownerUid, 'following', 'target_c'), {
        targetUid: 'target_c',
        createdAt: serverTimestamp(),
      }),
    );

    await assertSucceeds(getDoc(doc(ownerUnverifiedDb, 'users', ownerUid, 'following', 'target_a')));

    await assertFails(
      updateDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_b'), {
        createdAt: new Date(),
      }),
    );

    // following create deny: self-follow
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', ownerUid), {
        targetUid: ownerUid,
        createdAt: serverTimestamp(),
      }),
    );

    // following create deny: path/data mismatch
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_d'), {
        targetUid: 'other-target',
        createdAt: serverTimestamp(),
      }),
    );

    // following create deny: extra client key fanUid
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_e'), {
        targetUid: 'target_e',
        createdAt: serverTimestamp(),
        fanUid: ownerUid,
      }),
    );

    // following create deny: extra client key countersApplied
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_f'), {
        targetUid: 'target_f',
        createdAt: serverTimestamp(),
        countersApplied: true,
      }),
    );

    // following create deny: createdAt wrong type
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_g'), {
        targetUid: 'target_g',
        createdAt: 'not-a-timestamp',
      }),
    );

    // following create deny: client-selected timestamp (not request.time)
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_h'), {
        targetUid: 'target_h',
        createdAt: new Date(),
      }),
    );

    await assertFails(getDoc(doc(otherDb, 'users', ownerUid, 'following', 'target_a')));

    await assertFails(
      setDoc(doc(otherDb, 'users', ownerUid, 'following', 'target_z'), {
        targetUid: 'target_z',
        createdAt: serverTimestamp(),
      }),
    );

    await assertFails(deleteDoc(doc(otherDb, 'users', ownerUid, 'following', 'target_a')));

    await assertSucceeds(deleteDoc(doc(ownerUnverifiedDb, 'users', ownerUid, 'following', 'target_a')));

    await assertSucceeds(deleteDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_a')));

    const communityId = 'community_1';
    const topicId = 'topic_1';
    const commentId = 'comment_1';

    await assertSucceeds(
      setDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', commentId), {
        text: 'Legit owner comment',
        authorId: ownerUid,
        authorName: 'Owner One',
        createdAt: serverTimestamp(),
      }),
    );

    await assertFails(
      setDoc(doc(ownerUnverifiedDb, 'communities', communityId, 'topics', topicId, 'comments', 'non_adult'), {
        text: 'Non adult comment',
        authorId: ownerUid,
        authorName: 'Owner One',
        createdAt: serverTimestamp(),
      }),
    );

    await assertFails(
      setDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', 'spoofed'), {
        text: 'Spoofed author',
        authorId: otherUid,
        authorName: 'Bad Actor',
        createdAt: serverTimestamp(),
      }),
    );

    await assertSucceeds(
      updateDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', commentId), {
        text: 'Updated owner text',
        updatedAt: serverTimestamp(),
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', commentId), {
        authorId: otherUid,
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', commentId), {
        authorName: 'Tampered Name',
      }),
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', ownerUid), {
        uid: ownerUid,
        displayName: 'Owner One',
        ageVerified: false,
        isAdult: false,
        didit: { status: 'underage' },
        idv: { status: 'underage' },
      });
    });

    await assertFails(
      setDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', 'stale_claims'), {
        text: 'Stale claims comment',
        authorId: ownerUid,
        authorName: 'Owner One',
        createdAt: serverTimestamp(),
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', commentId), {
        text: 'Stale claims update denied',
        updatedAt: serverTimestamp(),
      }),
    );

    await assertFails(deleteDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', commentId)));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', ownerUid), {
        uid: ownerUid,
        displayName: 'Owner One',
        ageVerified: true,
        isAdult: true,
        didit: { status: 'approved' },
        idv: { status: 'approved' },
      });
    });

    await assertFails(deleteDoc(doc(otherDb, 'communities', communityId, 'topics', topicId, 'comments', commentId)));

    await assertSucceeds(deleteDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', commentId)));

    const acceptedAtTs = Timestamp.fromDate(new Date());
    const baseConsent = {
      version: 1,
      makerRoles: ['photographer', 'artist', 'videographer', 'retoucher', 'art_director'],
      makerCreditIndex: 0,
      consentStatuses: ['pending', 'accepted', 'rejected', 'notRequired', 'anonymous', 'pressOrStreetException'],
      hasMaker: true,
      hasVisibleSubject: false,
      aiPeoplePresent: false,
      subjectWarningAcknowledged: false,
      exception: { enabled: false, type: null, reason: '' },
    };
    const basePost = {
      authorId: ownerUid,
      title: 'Taxonomy post',
      imageUrl: 'https://example.com/test.jpg',
      styles: ['Portrait'],
      makerTags: [],
      appliedTriggers: [],
      outcome: 'allowed',
      shouldReview: false,
      credits: [{ uid: ownerUid, role: 'photographer', name: 'Owner One', isSelf: true, consentStatus: 'accepted' }],
      uploadConsent: baseConsent,
      consentAudit: [{ action: 'uploadConsentCaptured', actorUid: ownerUid, at: acceptedAtTs }],
      correction: {
        type: 'safeCorrection',
        requiresModeratorReview: false,
        publishBlocked: false,
        userAcceptedAt: acceptedAtTs,
      },
    };

    await assertSucceeds(setDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), basePost));
    await assertFails(setDoc(doc(codexDevDb, 'posts', 'codex_production_denied'), {
      ...basePost, authorId: 'codex-dev-user', credits: [{ ...basePost.credits[0], uid: 'codex-dev-user' }],
    }));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'posts', 'legacy_codex_production_post'), {
        ...basePost, authorId: 'codex-dev-user', credits: [{ ...basePost.credits[0], uid: 'codex-dev-user' }],
      });
    });
    await assertFails(updateDoc(doc(codexDevDb, 'posts', 'legacy_codex_production_post'), { title: 'blocked' }));
    await assertFails(deleteDoc(doc(codexDevDb, 'posts', 'legacy_codex_production_post')));
    await assertFails(setDoc(doc(codexDevDb, 'posts', 'safe_correction_ok', 'comments', 'codex_comment_denied'), {
      type: 'text', text: 'blocked', authorId: 'codex-dev-user', createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(codexDevDb, 'posts', 'safe_correction_ok', 'likes', 'codex-dev-user'), { createdAt: serverTimestamp() }));

    await assertFails(setDoc(doc(ownerEmailFalseAdultDb, 'posts', 'adult_gate_email_false_denied'), {
      ...basePost,
      title: 'Email false adult claims denied',
    }));
    await assertFails(setDoc(doc(ownerEmailOnlyDb, 'posts', 'adult_gate_email_only_denied'), {
      ...basePost,
      title: 'Email only denied',
    }));
    await assertFails(setDoc(doc(ownerIdvFalseDb, 'posts', 'adult_gate_idv_false_denied'), {
      ...basePost,
      title: 'IDV false denied',
    }));
    await assertFails(setDoc(doc(ownerAdultFalseDb, 'posts', 'adult_gate_adult_false_denied'), {
      ...basePost,
      title: 'Adult false denied',
    }));
    await assertSucceeds(setDoc(doc(codexDevDb, 'codexDevPosts', 'adult_gate_codex_dev_allowed'), {
      ...basePost,
      authorId: 'codex-dev-user',
      title: 'Codex dev allowed',
      credits: [{ uid: 'codex-dev-user', role: 'photographer', name: 'Codex', isSelf: true, consentStatus: 'accepted' }],
      createdAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(codexDevDb, 'codexDevPosts', 'adult_gate_codex_dev_allowed')));
    await assertFails(getDoc(doc(ownerDb, 'codexDevPosts', 'adult_gate_codex_dev_allowed')));
    await assertSucceeds(getDocs(query(
      collection(codexDevDb, 'codexDevPosts'),
      where('authorId', '==', 'codex-dev-user'),
    )));
    await assertFails(getDocs(query(
      collection(ownerDb, 'codexDevPosts'),
      where('authorId', '==', 'codex-dev-user'),
    )));
    await assertFails(setDoc(doc(codexDevDb, 'communities', communityId, 'topics', topicId, 'comments', 'codex_visible_denied'), {
      text: 'Codex must not be visible', authorId: 'codex-dev-user', createdAt: serverTimestamp(),
    }));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', ownerUid), {
        uid: ownerUid,
        displayName: 'Owner One',
        ageVerified: false,
        isAdult: true,
        didit: { status: 'approved' },
        idv: { status: 'approved' },
      });
    });
    await assertFails(setDoc(doc(ownerDb, 'posts', 'adult_gate_user_age_false_denied'), {
      ...basePost,
      title: 'User doc age false denied',
    }));
    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), { title: 'User doc age false update denied' }));
    await assertFails(deleteDoc(doc(ownerDb, 'posts', 'safe_correction_ok')));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', ownerUid), {
        uid: ownerUid,
        displayName: 'Owner One',
        ageVerified: true,
        isAdult: false,
        didit: { status: 'approved' },
        idv: { status: 'approved' },
      });
    });
    await assertFails(setDoc(doc(ownerDb, 'posts', 'adult_gate_user_adult_false_denied'), {
      ...basePost,
      title: 'User doc adult false denied',
    }));
    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), { title: 'User doc adult false update denied' }));
    await assertFails(deleteDoc(doc(ownerDb, 'posts', 'safe_correction_ok')));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', ownerUid), {
        uid: ownerUid,
        displayName: 'Owner One',
        ageVerified: true,
        isAdult: true,
        didit: { status: 'underage' },
        idv: { status: 'approved' },
      });
    });
    await assertFails(setDoc(doc(ownerDb, 'posts', 'adult_gate_user_didit_underage_denied'), {
      ...basePost,
      title: 'User doc Didit underage denied',
    }));
    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), { title: 'User doc Didit underage update denied' }));
    await assertFails(deleteDoc(doc(ownerDb, 'posts', 'safe_correction_ok')));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', ownerUid), {
        uid: ownerUid,
        displayName: 'Owner One',
        ageVerified: false,
        isAdult: false,
        didit: { status: 'underage' },
        idv: { status: 'underage' },
      });
    });
    await assertFails(setDoc(doc(ownerDb, 'posts', 'adult_gate_stale_claims_denied'), {
      ...basePost,
      title: 'Stale claims denied after downgrade',
    }));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', ownerUid), {
        uid: ownerUid,
        displayName: 'Owner One',
        ageVerified: true,
        isAdult: true,
        didit: { status: 'approved' },
        idv: { status: 'approved' },
      });
    });

    await assertFails(setDoc(doc(ownerUnverifiedDb, 'posts', 'safe_correction_ok', 'comments', 'non_adult_comment_denied'), {
      authorId: ownerUid,
      text: 'Non adult comment denied',
      createdAt: Timestamp.now(),
    }));
    await assertFails(setDoc(doc(ownerAdultFalseDb, 'posts', 'safe_correction_ok', 'comments', 'adult_false_comment_denied'), {
      authorId: ownerUid,
      text: 'Adult false comment denied',
      createdAt: Timestamp.now(),
    }));
    await assertSucceeds(setDoc(doc(ownerDb, 'posts', 'safe_correction_ok', 'comments', 'adult_comment_ok'), {
      authorId: ownerUid,
      text: 'Adult comment ok',
      createdAt: Timestamp.now(),
    }));
    await assertFails(setDoc(doc(ownerDb, 'posts', 'safe_correction_ok', 'comments', 'comment_impersonation_denied'), {
      authorId: otherUid,
      text: 'Impersonation denied',
      createdAt: Timestamp.now(),
    }));
    await assertFails(setDoc(doc(ownerUnverifiedDb, 'posts', 'safe_correction_ok', 'likes', ownerUid), {
      createdAt: Timestamp.now(),
    }));
    await assertFails(setDoc(doc(ownerAdultFalseDb, 'posts', 'safe_correction_ok', 'likes', ownerUid), {
      createdAt: Timestamp.now(),
    }));
    await assertSucceeds(setDoc(doc(ownerDb, 'posts', 'safe_correction_ok', 'likes', ownerUid), {
      createdAt: Timestamp.now(),
    }));

    await assertSucceeds(setDoc(doc(ownerDb, 'posts', 'profile_identity_ok'), {
      ...basePost,
      authorUid: ownerUid,
      authorProfileId: ownerUid,
      authorOwnerUid: ownerUid,
    }));

    await assertSucceeds(setDoc(doc(ownerDb, 'posts', 'profile_identity_external_ok'), {
      ...basePost,
      authorUid: ownerUid,
      authorProfileId: 'active_agency_profile',
      authorOwnerUid: ownerUid,
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'profile_identity_inactive_profile'), {
      ...basePost,
      authorUid: ownerUid,
      authorProfileId: 'private_agency_profile',
      authorOwnerUid: ownerUid,
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'profile_identity_spoof_profile'), {
      ...basePost,
      authorProfileId: otherUid,
      authorOwnerUid: ownerUid,
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'profile_identity_spoof_owner'), {
      ...basePost,
      authorProfileId: ownerUid,
      authorOwnerUid: otherUid,
    }));

    // P1: uploadConsent.hasMaker/makerRoles are not enough without an actual maker credit.
    await assertFails(setDoc(doc(ownerDb, 'posts', 'consent_fake_maker_model_only'), {
      ...basePost,
      credits: [
        { uid: 'model_1', role: 'model', name: 'Model One', consentStatus: 'accepted' },
        { uid: 'mua_1', role: 'mua', name: 'MUA One', consentStatus: 'accepted' },
      ],
      uploadConsent: { ...baseConsent, hasMaker: true },
    }));

    await assertSucceeds(setDoc(doc(ownerDb, 'posts', 'consent_actual_photographer'), {
      ...basePost,
      credits: [{ uid: 'photographer_1', role: 'photographer', name: 'Photo One', consentStatus: 'accepted' }],
    }));

    await assertSucceeds(setDoc(doc(ownerDb, 'posts', 'consent_model_self_portrait_explicit_maker'), {
      ...basePost,
      credits: [{ uid: ownerUid, role: 'model', name: 'Model Self Portrait', isSelf: true, isMaker: true, makerFunction: 'photographer', consentStatus: 'accepted' }],
      uploadConsent: { ...baseConsent, makerCreditIndex: 0 },
    }));

    await assertSucceeds(setDoc(doc(ownerDb, 'posts', 'consent_agency_rights_holder_maker'), {
      ...basePost,
      credits: [{ uid: 'agency_1', role: 'agency', name: 'Agency One', isMaker: true, makerFunction: 'rightsHolder', consentStatus: 'accepted' }],
      uploadConsent: { ...baseConsent, makerCreditIndex: 0 },
    }));

    await assertSucceeds(setDoc(doc(ownerDb, 'posts', 'consent_company_production_owner_maker'), {
      ...basePost,
      credits: [{ uid: 'company_1', role: 'company', name: 'Company One', isMaker: true, makerFunction: 'productionOwner', consentStatus: 'accepted' }],
      uploadConsent: { ...baseConsent, makerCreditIndex: 0 },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'consent_agency_unmarked_not_maker'), {
      ...basePost,
      credits: [{ uid: 'agency_unmarked', role: 'agency', name: 'Agency Unmarked', consentStatus: 'accepted' }],
      uploadConsent: { ...baseConsent, makerCreditIndex: 0 },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'consent_is_maker_without_function_denied'), {
      ...basePost,
      credits: [{ uid: 'model_flag_only', role: 'model', name: 'Model Flag Only', isMaker: true, consentStatus: 'accepted' }],
      uploadConsent: { ...baseConsent, makerCreditIndex: 0 },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'consent_function_without_is_maker_denied'), {
      ...basePost,
      credits: [{ uid: 'model_function_only', role: 'model', name: 'Model Function Only', makerFunction: 'photographer', consentStatus: 'accepted' }],
      uploadConsent: { ...baseConsent, makerCreditIndex: 0 },
    }));

    await assertSucceeds(setDoc(doc(ownerDb, 'posts', 'consent_late_maker_index'), {
      ...basePost,
      credits: Array.from({ length: 10 }, (_, index) => ({
        uid: `non_maker_${index}`,
        role: index % 2 === 0 ? 'model' : 'mua',
        name: `Non-maker ${index}`,
        consentStatus: 'accepted',
      })).concat({ uid: 'late_maker', role: 'photographer', name: 'Late Maker', consentStatus: 'accepted' }),
      uploadConsent: { ...baseConsent, makerCreditIndex: 10 },
    }));

    const { makerCreditIndex: _unusedMakerCreditIndex, ...baseConsentWithoutMakerCreditIndex } = baseConsent;
    await assertFails(setDoc(doc(ownerDb, 'posts', 'consent_missing_maker_credit_index'), {
      ...basePost,
      uploadConsent: baseConsentWithoutMakerCreditIndex,
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'consent_maker_credit_index_non_maker'), {
      ...basePost,
      credits: [
        { uid: 'model_index_0', role: 'model', name: 'Model Index 0', consentStatus: 'accepted' },
        { uid: 'photographer_index_1', role: 'photographer', name: 'Photographer Index 1', consentStatus: 'accepted' },
      ],
      uploadConsent: { ...baseConsent, makerCreditIndex: 0 },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'consent_maker_credit_index_out_of_range'), {
      ...basePost,
      uploadConsent: { ...baseConsent, makerCreditIndex: 1 },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'consent_maker_credit_index_negative'), {
      ...basePost,
      uploadConsent: { ...baseConsent, makerCreditIndex: -1 },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'consent_maker_credit_index_wrong_type'), {
      ...basePost,
      uploadConsent: { ...baseConsent, makerCreditIndex: '0' },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'consent_maker_credit_index_malformed_credit'), {
      ...basePost,
      credits: ['photographer'],
      uploadConsent: { ...baseConsent, makerCreditIndex: 0 },
    }));

    await assertSucceeds(setDoc(doc(ownerDb, 'posts', 'consent_anonymous_photographer'), {
      ...basePost,
      credits: [
        { uid: 'model_before_anonymous', role: 'model', name: 'Model Before Anonymous', consentStatus: 'accepted' },
        { role: 'photographer', name: 'Anonymous maker', isAnonymous: true, consentStatus: 'anonymous' },
      ],
      uploadConsent: { ...baseConsent, makerCreditIndex: 1 },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'consent_maker_roles_only'), {
      ...basePost,
      credits: [{ uid: 'model_2', role: 'model', name: 'Model Two', consentStatus: 'accepted' }],
      uploadConsent: { ...baseConsent, makerRoles: ['photographer', 'artist', 'videographer', 'retoucher', 'art_director'], makerCreditIndex: 0 },
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      credits: [
        { uid: 'model_3', role: 'model', name: 'Model Three', consentStatus: 'accepted' },
        { uid: 'photographer_moved', role: 'photographer', name: 'Moved Photographer', consentStatus: 'accepted' },
      ],
      uploadConsent: { ...baseConsent, hasMaker: true, makerCreditIndex: 0 },
    }));

    await assertSucceeds(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      credits: [
        { uid: 'model_3', role: 'model', name: 'Model Three', consentStatus: 'accepted' },
        { uid: 'photographer_moved', role: 'photographer', name: 'Moved Photographer', consentStatus: 'accepted' },
      ],
      uploadConsent: { ...baseConsent, hasMaker: true, makerCreditIndex: 1 },
    }));
    await assertFails(updateDoc(doc(ownerEmailFalseAdultDb, 'posts', 'safe_correction_ok'), {
      title: 'Email false update denied',
    }));
    await assertFails(updateDoc(doc(ownerIdvFalseDb, 'posts', 'safe_correction_ok'), {
      title: 'IDV false update denied',
    }));
    await assertFails(updateDoc(doc(ownerAdultFalseDb, 'posts', 'safe_correction_ok'), {
      title: 'Adult false update denied',
    }));
    await assertFails(deleteDoc(doc(ownerEmailFalseAdultDb, 'posts', 'safe_correction_ok')));
    await assertFails(deleteDoc(doc(ownerIdvFalseDb, 'posts', 'safe_correction_ok')));
    await assertFails(deleteDoc(doc(ownerAdultFalseDb, 'posts', 'safe_correction_ok')));

    await assertSucceeds(updateDoc(doc(ownerDb, 'posts', 'profile_identity_ok'), {
      title: 'Profile identity update ok',
      authorProfileId: ownerUid,
      authorOwnerUid: ownerUid,
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'profile_identity_ok'), {
      authorProfileId: otherUid,
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'profile_identity_ok'), {
      authorOwnerUid: otherUid,
    }));

    const { outcome: _unusedOutcome, ...postWithoutOutcome } = basePost;
    await assertFails(setDoc(doc(ownerDb, 'posts', 'missing_outcome'), postWithoutOutcome));

    const { shouldReview: _unusedShouldReview, ...postWithoutShouldReview } = basePost;
    await assertFails(setDoc(doc(ownerDb, 'posts', 'missing_should_review'), postWithoutShouldReview));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'missing_all_moderation'), {
      authorId: ownerUid,
      title: 'No moderation',
      imageUrl: 'https://example.com/test.jpg',
      styles: ['Portrait'],
      makerTags: [],
      appliedTriggers: [],
    }));

    const { correction: _unusedCorrection, ...postWithoutCorrection } = basePost;
    await assertSucceeds(setDoc(doc(ownerDb, 'posts', 'allowed_without_correction'), postWithoutCorrection));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'missing_maker_consent'), {
      ...postWithoutCorrection,
      uploadConsent: { ...baseConsent, hasMaker: false },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'missing_consent_audit'), {
      ...postWithoutCorrection,
      consentAudit: [],
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'safe_correction_missing_accept'), {
      ...basePost,
      correction: {
        type: 'safeCorrection',
        requiresModeratorReview: false,
        publishBlocked: false,
        userAcceptedAt: null,
      },
    }));
    await assertFails(setDoc(doc(ownerDb, 'posts', 'safe_correction_iso_accept_denied'), {
      ...basePost,
      correction: {
        ...basePost.correction,
        userAcceptedAt: new Date().toISOString(),
      },
    }));
    await assertFails(setDoc(doc(ownerDb, 'posts', 'empty_correction_denied'), {
      ...basePost,
      correction: {},
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'sensitive_correction_blocked'), {
      ...basePost,
      correction: {
        type: 'sensitiveCorrection',
        requiresModeratorReview: true,
        publishBlocked: true,
        userAcceptedAt: new Date(),
      },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'review_required_correction_blocked'), {
      ...basePost,
      correction: {
        type: 'reviewRequiredCorrection',
        requiresModeratorReview: true,
        publishBlocked: true,
      },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'forbidden_correction_blocked'), {
      ...basePost,
      outcome: 'forbidden',
      correction: {
        type: 'noCorrectionForbidden',
        requiresModeratorReview: true,
        publishBlocked: true,
      },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'should_review_blocked'), {
      ...basePost,
      shouldReview: true,
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'needs_correction_outcome_blocked'), {
      ...basePost,
      outcome: 'needsCorrection',
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'review_outcome_blocked'), {
      ...basePost,
      outcome: 'review',
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'safe_correction_publish_blocked_true'), {
      ...basePost,
      correction: {
        ...basePost.correction,
        publishBlocked: true,
      },
    }));

    await assertFails(setDoc(doc(ownerDb, 'posts', 'safe_correction_requires_review_true'), {
      ...basePost,
      correction: {
        ...basePost.correction,
        requiresModeratorReview: true,
      },
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      outcome: deleteField(),
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      shouldReview: deleteField(),
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      correction: {
        type: 'sensitiveCorrection',
        requiresModeratorReview: true,
        publishBlocked: true,
      },
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      correction: null,
    }));
    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      correction: deleteField(),
    }));
    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      correction: {},
    }));
    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      correction: {
        ...basePost.correction,
        userAcceptedAt: new Date().toISOString(),
      },
    }));

    // P2: pre-consent moderated posts keep a narrow metadata-only owner edit path.
    await assertSucceeds(updateDoc(doc(ownerDb, 'posts', 'pre_consent_moderated'), {
      title: 'Pre-consent moderated title updated',
      description: 'Pre-consent moderated description updated',
      updatedAt: serverTimestamp(),
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'pre_consent_moderated'), {
      imageUrl: 'https://example.com/pre-consent-hijack.jpg',
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'pre_consent_moderated'), {
      outcome: 'review',
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'pre_consent_moderated'), {
      credits: [{ uid: 'model_4', role: 'model', name: 'Model Four' }],
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'pre_consent_moderated'), {
      uploadConsent: baseConsent,
      consentAudit: [{ action: 'clientBackfillAttempt', actorUid: ownerUid, at: acceptedAtTs }],
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      title: 'Consented post cannot carry invalid consent mutation',
      uploadConsent: { ...baseConsent, hasMaker: false },
    }));

    await assertSucceeds(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      title: 'Legacy title updated',
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      imageUrl: 'https://example.com/hijack.jpg',
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      authorId: otherUid,
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      outcome: 'allowed',
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      shouldReview: false,
    }));


    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      visibility: 'private',
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      randomField: 'not-allowed',
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      likes: deleteField(),
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      credits: deleteField(),
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      contributorIds: deleteField(),
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      imageUrl: deleteField(),
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      credits: [{ uid: 'credit_2', role: 'mua' }],
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      contributorIds: ['credit_2'],
    }));

    await assertSucceeds(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      description: 'Legacy description updated',
      updatedAt: serverTimestamp(),
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'legacy_without_moderation'), {
      correction: {
        type: 'safeCorrection',
        requiresModeratorReview: false,
        publishBlocked: false,
        userAcceptedAt: new Date(),
      },
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      outcome: 'review',
    }));

    await assertFails(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      shouldReview: true,
    }));

    await assertSucceeds(updateDoc(doc(ownerDb, 'posts', 'safe_correction_ok'), {
      title: 'Taxonomy post retitled',
      description: 'Updated description with valid moderation fields preserved.',
    }));

    await assertSucceeds(setDoc(doc(ownerDb, 'contributorContentRequests', 'hide_request'), {
      contributorId: 'claimed_contributor',
      postId: 'safe_correction_ok',
      requestType: 'hide',
      reason: 'I claimed this contributor profile and want this hidden.',
      status: 'pending',
      requesterUid: ownerUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));

    await assertFails(setDoc(doc(codexDevDb, 'contributorContentRequests', 'codex_request'), {
      contributorId: 'claimed_contributor',
      postId: 'safe_correction_ok',
      requestType: 'hide',
      reason: 'Test traffic must stay isolated.',
      status: 'pending',
      requesterUid: 'codex-dev-user',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));

    await assertFails(setDoc(doc(otherDb, 'contributorContentRequests', 'spoofed_request'), {
      contributorId: 'claimed_contributor',
      postId: 'safe_correction_ok',
      requestType: 'remove',
      reason: 'Not my claimed contributor.',
      status: 'pending',
      requesterUid: otherUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));

    console.log('PASS firestore.publicUsers.rules.test');
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error('FAIL firestore.publicUsers.rules.test');
  console.error(error);
  process.exitCode = 1;
});
