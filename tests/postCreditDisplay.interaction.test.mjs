import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const { default: PostCreditDisplay } = await server.ssrLoadModule('/src/components/PostCreditDisplay.jsx');

  const renderSingleCreditButton = (credit, handlers = {}) => {
    const element = PostCreditDisplay({
      post: {
        id: 'post_1',
        authorId: null,
        authorName: '',
        credits: [credit],
      },
      ...handlers,
    });

    const buttons = Array.isArray(element.props.children) ? element.props.children : [element.props.children];
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
