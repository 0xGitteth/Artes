from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


index_path = Path('functions/index.js')
index = index_path.read_text(encoding='utf-8')

old_preflight = '''    if ((action === 'publishNow' || action === 'repairPublished') && !canPublishUpload(upload)) {
      res.status(409).json({ error: 'Upload is not approved' });
      return;
    }
    if (action === 'saveDraft' && upload?.reviewStatus !== 'approved') {
      res.status(409).json({ error: 'Upload is not approved' });
      return;
    }
    if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload') && upload?.reviewStatus !== 'approved') {
      res.status(409).json({ error: 'Upload is not approved' });
      return;
    }
    const initialPublicationStatus = String(upload?.publicationStatus || upload?.publishStatus || '').trim();
    if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload') && initialPublicationStatus === 'published') {
      res.status(409).json({ error: 'Upload is already published' });
      return;
    }
'''
new_preflight = '''    if ((action === 'publishNow' || action === 'repairPublished') && !canPublishUpload(upload)) {
      res.status(409).json({ error: 'Upload is not approved' });
      return;
    }
    if (action === 'saveDraft' && !canSaveDraftUpload(upload)) {
      res.status(409).json({ error: 'Upload is not approved for draft persistence' });
      return;
    }
    if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload')
      && !canManageApprovedUploadPrompt(upload)) {
      res.status(409).json({ error: 'Upload publication prompt is no longer actionable' });
      return;
    }
'''
index = replace_once(index, old_preflight, new_preflight, 'preflight lifecycle authority')

old_missing_post = '''        const latestPublicationStatus = String(latestUpload?.publicationStatus || latestUpload?.publishStatus || '').trim();
        if (postRef && latestPublicationStatus === 'published' && !latestPostSnap?.exists) {
          const error = new Error('Published post was deleted and cannot be recreated from stale upload state');
          error.status = 409;
          error.code = 'published_post_deleted';
          throw error;
        }
'''
new_missing_post = '''        const latestPublicationLifecycle = resolveUploadPublicationState(latestUpload);
        if (postRef
          && latestPublicationLifecycle.valid
          && latestPublicationLifecycle.state === PUBLICATION_STATES.published
          && !latestPostSnap?.exists) {
          const error = new Error('Published post was deleted and cannot be recreated from stale upload state');
          error.status = 409;
          error.code = 'published_post_deleted';
          throw error;
        }
'''
index = replace_once(index, old_missing_post, new_missing_post, 'published post missing lifecycle authority')

old_discard_trigger = '''  const before = event.data?.before?.data?.() || {};
  const after = event.data?.after?.data?.() || {};
  const beforeStatus = String(before?.publicationStatus || before?.publishStatus || '').trim();
  const afterStatus = String(after?.publicationStatus || after?.publishStatus || '').trim();
  if (afterStatus !== 'discarded' || beforeStatus === 'discarded') return;

  const cleanup = await cleanupModerationPreviewForUpload({
'''
new_discard_trigger = '''  const before = event.data?.before?.data?.() || {};
  const after = event.data?.after?.data?.() || {};
  const beforePublication = resolveUploadPublicationState(before);
  const afterPublication = resolveUploadPublicationState(after);
  const afterMediaState = String(after?.mediaState || '').trim();
  if (!afterPublication.valid || afterPublication.state !== PUBLICATION_STATES.discarded) return;
  if (beforePublication.valid && beforePublication.state === PUBLICATION_STATES.discarded) return;
  // User-discard cleanup should only claim media that is still ready (or a
  // legacy upload without mediaState). Post-deletion cleanup failures already
  // use cleanup_pending and must stay on the upload-owned retry path.
  if (afterMediaState && afterMediaState !== 'ready') return;

  const cleanup = await cleanupModerationPreviewForUpload({
'''
index = replace_once(index, old_discard_trigger, new_discard_trigger, 'discard cleanup canonical lifecycle trigger')
index_path.write_text(index, encoding='utf-8')

source_path = Path('tests/moderationCanonicalLifecycleSource.test.mjs')
source = source_path.read_text(encoding='utf-8')
old_user_test = '''test('user actions no longer make direct reviewStatus approval decisions', () => {
  const start = indexSource.indexOf('export const userModerationAction');
  const end = indexSource.indexOf('export const getContributorByAliasCallable', start);
  const actionSource = indexSource.slice(start, end);
  assert.match(actionSource, /canPublishUpload\\(latestUpload\\)/);
  assert.match(actionSource, /canSaveDraftUpload\\(latestUpload\\)/);
  assert.match(actionSource, /canManageApprovedUploadPrompt\\(latestUpload\\)/);
  assert.doesNotMatch(actionSource, /latestUpload\\?\\.reviewStatus !== 'approved'/);
});
'''
new_user_test = '''test('user actions use canonical lifecycle helpers in preflight and authoritative transaction', () => {
  const start = indexSource.indexOf('export const userModerationAction');
  const end = indexSource.indexOf('export const getContributorByAliasCallable', start);
  const actionSource = indexSource.slice(start, end);
  assert.match(actionSource, /canPublishUpload\\(upload\\)/);
  assert.match(actionSource, /canSaveDraftUpload\\(upload\\)/);
  assert.match(actionSource, /canManageApprovedUploadPrompt\\(upload\\)/);
  assert.match(actionSource, /canPublishUpload\\(latestUpload\\)/);
  assert.match(actionSource, /canSaveDraftUpload\\(latestUpload\\)/);
  assert.match(actionSource, /canManageApprovedUploadPrompt\\(latestUpload\\)/);
  assert.match(actionSource, /latestPublicationLifecycle = resolveUploadPublicationState\\(latestUpload\\)/);
  assert.match(actionSource, /latestPublicationLifecycle\\.state === PUBLICATION_STATES\\.published/);
  assert.doesNotMatch(actionSource, /upload\\?\\.reviewStatus !== 'approved'/);
  assert.doesNotMatch(actionSource, /latestUpload\\?\\.reviewStatus !== 'approved'/);
  assert.doesNotMatch(actionSource, /initialPublicationStatus/);
  assert.doesNotMatch(actionSource, /latestPublicationStatus/);
});
'''
source = replace_once(source, old_user_test, new_user_test, 'user action source invariant')
source += '''\n\ntest('discard cleanup trigger follows canonical publication state without bypassing media cleanup authority', () => {\n  const start = indexSource.indexOf('export const onModerationUploadDiscarded');\n  const end = indexSource.indexOf('export const onProductionPostDeleted', start);\n  const triggerSource = indexSource.slice(start, end);\n  assert.match(triggerSource, /resolveUploadPublicationState\\(before\\)/);\n  assert.match(triggerSource, /resolveUploadPublicationState\\(after\\)/);\n  assert.match(triggerSource, /afterPublication\\.state !== PUBLICATION_STATES\\.discarded/);\n  assert.match(triggerSource, /afterMediaState && afterMediaState !== 'ready'/);\n  assert.doesNotMatch(triggerSource, /beforeStatus/);\n  assert.doesNotMatch(triggerSource, /afterStatus/);\n});\n'''
source_path.write_text(source, encoding='utf-8')

print('canonical lifecycle authority hardening applied')
