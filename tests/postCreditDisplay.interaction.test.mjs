import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { creditMatchesShadowProfile, getCanClaimShadowProfile } from '../src/utils/shadowProfile.js';

assert.equal(
  getCanClaimShadowProfile({ isAnonymousDisplayOnly: false, contributorId: null }),
  false,
  'name-only shadow profiles open display-only without claim UI when contributorId is missing',
);
assert.equal(
  getCanClaimShadowProfile({ isAnonymousDisplayOnly: false, contributorId: 'temp_mara' }),
  true,
  'temporary contributors with contributorId remain claimable',
);
assert.equal(
  getCanClaimShadowProfile({ isAnonymousDisplayOnly: true, contributorId: 'anon_mara' }),
  false,
  'anonymous shadow profiles remain display-only even with a contributorId',
);
assert.equal(
  creditMatchesShadowProfile(
    { role: 'model', displayName: 'Mara Eliza', instagramHandle: '@mara' },
    { name: 'Mara Eliza', contributorId: null },
  ),
  true,
  'displayName-only credits match a name-only shadow profile',
);
assert.equal(
  creditMatchesShadowProfile(
    { role: 'model', name: 'Other Person', contributorId: 'temp_mara' },
    { name: 'Mara Eliza', contributorId: 'temp_mara' },
  ),
  true,
  'contributorId match still wins for temporary contributors',
);

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const { default: PostCreditDisplay } = await server.ssrLoadModule('/src/components/PostCreditDisplay.jsx');

  const renderPostButtons = (post, handlers = {}) => {
    const element = PostCreditDisplay({
      post: {
        id: 'post_1',
        authorId: null,
        authorName: '',
        ...post,
      },
      ...handlers,
    });

    return Array.isArray(element.props.children) ? element.props.children : [element.props.children];
  };

  const renderSingleCreditButton = (credit, handlers = {}) => {
    const buttons = renderPostButtons({ credits: [credit] }, handlers);
    assert.equal(buttons.length, 1, 'fixture renders exactly one credit button');
    return buttons[0];
  };

  let shadowPayload = null;
  const nameOnlyButton = renderSingleCreditButton(
    { role: 'model', name: 'Mara Eliza' },
    { onShadowClick: (payload) => { shadowPayload = payload; } },
  );
  assert.equal(nameOnlyButton.props.disabled, false, 'non-anonymous name-only shadow row stays clickable');
  assert.equal(typeof nameOnlyButton.props.onClick, 'function', 'non-anonymous name-only shadow row has a click handler');
  nameOnlyButton.props.onClick();
  assert.deepEqual(
    shadowPayload,
    { name: 'Mara Eliza', contributorId: null, isAnonymous: false },
    'non-anonymous name-only shadow row emits the expected payload',
  );

  shadowPayload = null;
  const displayNameOnlyButton = renderSingleCreditButton(
    { role: 'model', displayName: 'Mara Eliza' },
    { onShadowClick: (payload) => { shadowPayload = payload; } },
  );
  assert.equal(displayNameOnlyButton.props.disabled, false, 'non-anonymous displayName-only shadow row stays clickable');
  displayNameOnlyButton.props.onClick();
  assert.deepEqual(
    shadowPayload,
    { name: 'Mara Eliza', contributorId: null, isAnonymous: false },
    'non-anonymous displayName-only shadow row emits the expected payload',
  );

  shadowPayload = null;
  const anonymousButton = renderSingleCreditButton(
    { role: 'model', name: 'Anonieme bijdrager', isAnonymous: true },
    { onShadowClick: (payload) => { shadowPayload = payload; } },
  );
  assert.equal(anonymousButton.props.disabled, true, 'anonymous name-only row is not clickable');
  assert.equal(anonymousButton.props.onClick, undefined, 'anonymous name-only row has no click handler');
  assert.equal(shadowPayload, null, 'anonymous name-only row does not emit a shadow payload');

  shadowPayload = null;
  const temporaryContributorButton = renderSingleCreditButton(
    { role: 'model', name: 'Mara Eliza', contributorId: 'temp_mara' },
    { onShadowClick: (payload) => { shadowPayload = payload; } },
  );
  assert.equal(temporaryContributorButton.props.disabled, false, 'named temporary contributor stays clickable');
  temporaryContributorButton.props.onClick();
  assert.deepEqual(
    shadowPayload,
    { name: 'Mara Eliza', contributorId: 'temp_mara', isAnonymous: false },
    'named temporary contributor emits the expected shadow payload',
  );

  shadowPayload = null;
  const roleOnlyButton = renderSingleCreditButton(
    { role: 'model' },
    { onShadowClick: (payload) => { shadowPayload = payload; } },
  );
  assert.equal(roleOnlyButton.props.disabled, true, 'role-only row with fallback name is not clickable');
  assert.equal(roleOnlyButton.props.onClick, undefined, 'role-only row with fallback name has no click handler');
  assert.equal(shadowPayload, null, 'role-only row with fallback name does not emit a shadow payload');

  let clickedUid = null;

  shadowPayload = null;
  const legacyAuthorNameOnlyButton = renderPostButtons(
    { authorName: 'Legacy Author', authorRole: 'photographer' },
    { onShadowClick: (payload) => { shadowPayload = payload; } },
  )[0];
  assert.equal(legacyAuthorNameOnlyButton.props.disabled, true, 'legacy author fallback with only authorName is not shadow-clickable');
  assert.equal(legacyAuthorNameOnlyButton.props.onClick, undefined, 'legacy author fallback with only authorName has no click handler');
  assert.equal(shadowPayload, null, 'legacy author fallback with only authorName does not emit a shadow payload');

  shadowPayload = null;
  const synthesizedFallbackButtons = renderPostButtons(
    {
      authorName: 'Legacy Author',
      authorRole: 'photographer',
      credits: [{ role: 'model', name: 'Mara Eliza' }],
    },
    { onShadowClick: (payload) => { shadowPayload = payload; } },
  );
  assert.equal(synthesizedFallbackButtons.length, 2, 'fixture renders synthesized author fallback plus explicit credit');
  assert.equal(synthesizedFallbackButtons[0].props.disabled, true, 'synthesized fallback author row is not shadow-clickable by name');
  assert.equal(synthesizedFallbackButtons[0].props.onClick, undefined, 'synthesized fallback author row has no click handler');
  assert.equal(synthesizedFallbackButtons[1].props.disabled, false, 'explicit credit after synthesized fallback remains shadow-clickable');
  assert.equal(shadowPayload, null, 'synthesized fallback author row does not emit a shadow payload');

  clickedUid = null;
  const legacyAuthorWithUidButton = renderPostButtons(
    { authorName: 'Legacy Author', authorId: 'author_1', authorRole: 'photographer' },
    { onUserClick: (uid) => { clickedUid = uid; }, onShadowClick: () => assert.fail('legacy author with uid should not use shadow click') },
  )[0];
  assert.equal(legacyAuthorWithUidButton.props.disabled, false, 'legacy author fallback with uid stays clickable through onUserClick');
  legacyAuthorWithUidButton.props.onClick();
  assert.equal(clickedUid, 'author_1', 'legacy author fallback with uid opens through onUserClick');

  const realProfileButton = renderSingleCreditButton(
    { role: 'model', name: 'Mara Eliza', uid: 'user_mara' },
    { onUserClick: (uid) => { clickedUid = uid; }, onShadowClick: () => assert.fail('real profile should not use shadow click') },
  );
  assert.equal(realProfileButton.props.disabled, false, 'real profile row stays clickable');
  realProfileButton.props.onClick();
  assert.equal(clickedUid, 'user_mara', 'real profile row opens through onUserClick');
} finally {
  await server.close();
}

console.log('PASS postCreditDisplay.interaction.test.mjs');
