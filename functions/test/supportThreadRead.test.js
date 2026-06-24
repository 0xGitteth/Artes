import test from 'node:test';
import assert from 'node:assert/strict';
import { markSupportThreadReadForModeratorCore, resolveSupportThreadId } from '../supportThreadRead.js';

const createDb = ({ exists = true, data = { type: 'support' } } = {}) => {
  const writes = [];
  const ref = {
    async get() {
      return {
        exists,
        data: () => data,
      };
    },
    async set(payload, options) {
      writes.push({ payload, options });
    },
  };
  return {
    writes,
    collection(name) {
      assert.equal(name, 'threads');
      return {
        doc(id) {
          return { id, ...ref };
        },
      };
    },
  };
};

const expectReject = async (promise, status, message) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status);
    assert.match(error.message, message);
    return true;
  });
};

test('resolveSupportThreadId accepts threadId first and can derive support thread from userUid', () => {
  assert.equal(resolveSupportThreadId({ threadId: 'support_user1', userUid: 'user2' }), 'support_user1');
  assert.equal(resolveSupportThreadId({ userUid: 'user2' }), 'support_user2');
});

test('unauthenticated request is denied before writes', async () => {
  const db = createDb();
  await expectReject(markSupportThreadReadForModeratorCore({
    db,
    decoded: null,
    ensureModerator: async () => {},
    body: { threadId: 'support_user1' },
  }), 401, /Missing auth token/);
  assert.deepEqual(db.writes, []);
});

test('non-moderator request is denied before writes', async () => {
  const db = createDb();
  await expectReject(markSupportThreadReadForModeratorCore({
    db,
    decoded: { uid: 'viewer' },
    ensureModerator: async () => {
      const error = new Error('Not a moderator');
      error.status = 403;
      throw error;
    },
    body: { threadId: 'support_user1' },
  }), 403, /Not a moderator/);
  assert.deepEqual(db.writes, []);
});

test('moderator can mark a support thread read with only read metadata fields', async () => {
  const db = createDb({ data: { type: 'support', userUid: 'user1', unreadForModerator: 3 } });
  const result = await markSupportThreadReadForModeratorCore({
    db,
    decoded: { uid: 'mod1', email: 'mod@example.com' },
    ensureModerator: async () => ({ email: 'mod@example.com' }),
    body: { threadId: 'support_user1' },
  });

  assert.deepEqual(result, { ok: true, threadId: 'support_user1' });
  assert.equal(db.writes.length, 1);
  assert.deepEqual(Object.keys(db.writes[0].payload).sort(), ['moderatorLastReadAt', 'unreadForModerator']);
  assert.equal(db.writes[0].payload.unreadForModerator, 0);
  assert.deepEqual(db.writes[0].options, { merge: true });
});

test('function refuses non-support thread ids', async () => {
  const db = createDb();
  await expectReject(markSupportThreadReadForModeratorCore({
    db,
    decoded: { uid: 'mod1' },
    ensureModerator: async () => ({ email: 'mod@example.com' }),
    body: { threadId: 'dm_user1_user2' },
  }), 400, /Only support threads/);
  assert.deepEqual(db.writes, []);
});

test('function refuses documents whose type is not support', async () => {
  const db = createDb({ data: { type: 'dm' } });
  await expectReject(markSupportThreadReadForModeratorCore({
    db,
    decoded: { uid: 'mod1' },
    ensureModerator: async () => ({ email: 'mod@example.com' }),
    body: { threadId: 'support_user1' },
  }), 400, /Only support threads/);
  assert.deepEqual(db.writes, []);
});

test('missing support thread returns a clear not found error', async () => {
  const db = createDb({ exists: false });
  await expectReject(markSupportThreadReadForModeratorCore({
    db,
    decoded: { uid: 'mod1' },
    ensureModerator: async () => ({ email: 'mod@example.com' }),
    body: { threadId: 'support_missing' },
  }), 404, /Support thread not found/);
  assert.deepEqual(db.writes, []);
});
