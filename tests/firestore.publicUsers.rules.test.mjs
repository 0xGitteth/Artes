import fs from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  Timestamp,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'artes-rules-test';

const authedContext = (env, uid, token = {}) => env.authenticatedContext(uid, {
  email: `${uid}@example.com`,
  ...token,
});

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
        uid: ownerUid,
        username: 'owner1',
        displayName: 'Owner One',
        displayNameLower: 'owner one',
        email: 'legacy@example.com',
        fansCount: 1,
        fanOfCount: 2,
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'users', ownerUid), {
        uid: ownerUid,
        displayName: 'Owner One',
      });
      await setDoc(doc(db, 'users', 'agency_owner'), {
        uid: 'agency_owner',
        username: 'agencyowner',
        displayName: 'Agency Owner',
        roles: ['agency'],
      });
      await setDoc(doc(db, 'users', 'company_owner'), {
        uid: 'company_owner',
        username: 'companyowner',
        displayName: 'Company Owner',
        roles: ['company'],
      });
      await setDoc(doc(db, 'users', 'agency_other'), {
        uid: 'agency_other',
        username: 'agencyother',
        displayName: 'Agency Other',
        roles: ['agency'],
      });
      await setDoc(doc(db, 'users', 'company_other'), {
        uid: 'company_other',
        username: 'companyother',
        displayName: 'Company Other',
        roles: ['company'],
      });
      await setDoc(doc(db, 'users', 'talent_pending'), {
        uid: 'talent_pending',
        username: 'talentpending',
        displayName: 'Talent Pending',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'team_pending'), {
        uid: 'team_pending',
        username: 'teampending',
        displayName: 'Team Pending',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'talent_pending'), {
        uid: 'talent_pending',
        username: 'talentpending',
        displayName: 'Talent Pending',
        displayNameLower: 'talent pending',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'team_pending'), {
        uid: 'team_pending',
        username: 'teampending',
        displayName: 'Team Pending',
        displayNameLower: 'team pending',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'talent_card'), {
        uid: 'talent_card',
        username: 'talentcard',
        displayName: 'Talent Card',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'talent_card'), {
        uid: 'talent_card',
        username: 'talentcard',
        displayName: 'Talent Card',
        displayNameLower: 'talent card',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'team_card'), {
        uid: 'team_card',
        username: 'teamcard',
        displayName: 'Team Card',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'team_card'), {
        uid: 'team_card',
        username: 'teamcard',
        displayName: 'Team Card',
        displayNameLower: 'team card',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'talent_batch_card'), {
        uid: 'talent_batch_card',
        username: 'talentbatchcard',
        displayName: 'Talent Batch Card',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'talent_batch_card'), {
        uid: 'talent_batch_card',
        username: 'talentbatchcard',
        displayName: 'Talent Batch Card',
        displayNameLower: 'talent batch card',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'team_batch_card'), {
        uid: 'team_batch_card',
        username: 'teambatchcard',
        displayName: 'Team Batch Card',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'team_batch_card'), {
        uid: 'team_batch_card',
        username: 'teambatchcard',
        displayName: 'Team Batch Card',
        displayNameLower: 'team batch card',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'talent_reject'), {
        uid: 'talent_reject',
        username: 'talentreject',
        displayName: 'Talent Reject',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'talent_reject'), {
        uid: 'talent_reject',
        username: 'talentreject',
        displayName: 'Talent Reject',
        displayNameLower: 'talent reject',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'team_reject'), {
        uid: 'team_reject',
        username: 'teamreject',
        displayName: 'Team Reject',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'publicUsers', 'team_reject'), {
        uid: 'team_reject',
        username: 'teamreject',
        displayName: 'Team Reject',
        displayNameLower: 'team reject',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'pending',
      });
      await setDoc(doc(db, 'users', 'talent_remove'), {
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
        uid: 'talent_remove',
        username: 'talentremove',
        displayName: 'Talent Remove',
        displayNameLower: 'talent remove',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'approved',
      });
      await setDoc(doc(db, 'users', 'team_remove'), {
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
        uid: 'team_remove',
        username: 'teamremove',
        displayName: 'Team Remove',
        displayNameLower: 'team remove',
        linkedCompanyId: 'company_owner',
        linkedCompanyName: 'Company Owner',
        linkedCompanyStatus: 'approved',
      });
      await setDoc(doc(db, 'users', 'self_withdraw'), {
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
        uid: 'self_withdraw',
        username: 'selfwithdraw',
        displayName: 'Self Withdraw',
        displayNameLower: 'self withdraw',
        linkedAgencyId: 'agency_owner',
        linkedAgencyName: 'Agency Owner',
        linkedAgencyStatus: 'approved',
      });


      await setDoc(doc(db, 'users', ownerUid, 'following', 'target_a'), {
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

    const ownerDb = authedContext(testEnv, ownerUid, { email_verified: true }).firestore();
    const ownerUnverifiedDb = authedContext(testEnv, ownerUid).firestore();
    const otherDb = authedContext(testEnv, otherUid, { email_verified: true }).firestore();
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
        uid: 'other_uid',
        username: 'owner1',
        displayName: 'Owner One',
        displayNameLower: 'owner one',
        updatedAt: new Date(),
      }, { merge: true }),
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        username: 'owner1',
        displayName: 'Owner No Uid',
        displayNameLower: 'owner no uid',
        updatedAt: new Date(),
      }, { merge: true }),
    );

    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid), {
        moderator: true,
      }, { merge: true }),
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
        linkedAgencyStatus: 'approved',
      }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(agencyOwnerDb, 'publicUsers', 'talent_pending'), {
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
    await assertFails(fakeBatch.commit());

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
