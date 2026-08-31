from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


path = Path('tests/codexDevIsolation.test.mjs')
source = path.read_text(encoding='utf-8')
source = replace_once(
    source,
    "  assert.match(moderate, /shouldCreateProductionReviewCase\\(\\{ isCodexActor/);\n",
    "  assert.match(moderate, /shouldFinalizeAutomaticReview = Boolean\\([\\s\\S]{0,420}?shouldCreateProductionReviewCase\\(\\{[\\s\\S]{0,180}?isCodexActor,/);\n",
    'moderateImage quarantine decision assertion',
)

old_serialization = r'''  assert.match(moderate, /runTransaction[^]*isKnownCodexDevActorUid\(\{ db, uid: userId, transaction \}\)[^]*transaction\.create\(reviewRef/);
  const mediaAnchor = moderate.slice(
    moderate.indexOf("const uploadRef = db.collection('uploads').doc();"),
    moderate.indexOf('if (reviewCaseId && uploadId)'),
  );
  const anchorTransaction = mediaAnchor.indexOf('await db.runTransaction');
  const anchorRegistryGuard = mediaAnchor.indexOf('await isKnownCodexDevActorUid({ db, uid: userId, transaction })', anchorTransaction);
  const anchorCreate = mediaAnchor.indexOf('transaction.create(uploadRef', anchorTransaction);
  assert.ok(anchorTransaction !== -1 && anchorTransaction < anchorRegistryGuard && anchorRegistryGuard < anchorCreate,
    'durable upload anchor serializes the historical-registry read before creation');
  const finalizationTransaction = mediaAnchor.indexOf('await db.runTransaction', anchorCreate);
  const finalizationRegistryGuard = mediaAnchor.indexOf('await isKnownCodexDevActorUid({ db, uid: userId, transaction })', finalizationTransaction);
  const suppressionCleanup = mediaAnchor.indexOf("mediaCleanupReason: 'historical_registry_suppressed'", finalizationRegistryGuard);
  const readyMutation = mediaAnchor.indexOf("mediaState: 'ready'", suppressionCleanup);
  assert.ok(finalizationTransaction < finalizationRegistryGuard && finalizationRegistryGuard < suppressionCleanup && suppressionCleanup < readyMutation,
    'post-Storage finalization rechecks the registry before either cleanup scheduling or ready state');
'''
new_serialization = r'''  const mediaAnchorStart = moderate.indexOf("const uploadRef = db.collection('uploads').doc();");
  const storageWrite = moderate.indexOf('persistModerationPreview({', mediaAnchorStart);
  const mediaAnchor = moderate.slice(mediaAnchorStart, storageWrite);
  const anchorTransaction = mediaAnchor.indexOf('await db.runTransaction');
  const anchorRegistryGuard = mediaAnchor.indexOf('await isKnownCodexDevActorUid({ db, uid: userId, transaction })', anchorTransaction);
  const anchorCreate = mediaAnchor.indexOf('transaction.create(uploadRef', anchorTransaction);
  assert.ok(anchorTransaction !== -1 && anchorTransaction < anchorRegistryGuard && anchorRegistryGuard < anchorCreate,
    'durable upload anchor serializes the historical-registry read before creation');

  const finalizationStart = moderate.indexOf('const finalizationResult = await db.runTransaction');
  const finalizationEnd = moderate.indexOf("if (finalizationOutcome === 'ready')", finalizationStart);
  const finalization = moderate.slice(finalizationStart, finalizationEnd);
  const finalizationRegistryGuard = finalization.indexOf('isKnownCodexDevActorUid({ db, uid: userId, transaction })');
  const suppressionCleanup = finalization.indexOf("mediaCleanupReason: 'historical_registry_suppressed'", finalizationRegistryGuard);
  const automaticReviewCreate = finalization.indexOf('transaction.create(automaticReviewRef', finalizationRegistryGuard);
  const readyMutation = finalization.indexOf("mediaState: 'ready'", finalizationRegistryGuard);
  assert.ok(finalizationStart !== -1 && finalizationRegistryGuard !== -1,
    'post-Storage finalization transaction rechecks historical registry');
  assert.ok(finalizationRegistryGuard < suppressionCleanup && suppressionCleanup < readyMutation,
    'registry denial is resolved before cleanup scheduling or ready state');
  assert.ok(automaticReviewCreate === -1 || finalizationRegistryGuard < automaticReviewCreate,
    'automatic review creation cannot precede the transactional historical-registry guard');
'''
source = replace_once(source, old_serialization, new_serialization, 'moderation claim serialization assertions')
path.write_text(source, encoding='utf-8')
print('Codex isolation assertions aligned with atomic automatic review finalization')
