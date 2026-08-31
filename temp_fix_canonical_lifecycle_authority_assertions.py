from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


path = Path('tests/moderationPreviewStorageSource.test.mjs')
source = path.read_text(encoding='utf-8')
source = replace_once(
    source,
    "  assert.ok(indexSource.includes(\"afterStatus !== 'discarded'\"));\n",
    "  assert.ok(indexSource.includes('afterPublication = resolveUploadPublicationState(after)'));\n"
    "  assert.ok(indexSource.includes('afterPublication.state !== PUBLICATION_STATES.discarded'));\n"
    "  assert.ok(indexSource.includes(\"afterMediaState && afterMediaState !== 'ready'\"));\n",
    'discard cleanup source assertion',
)
source = replace_once(
    source,
    "  assert.ok(indexSource.includes(\"latestPublicationStatus === 'published' && !latestPostSnap?.exists\"));\n",
    "  assert.ok(indexSource.includes('latestPublicationLifecycle = resolveUploadPublicationState(latestUpload)'));\n"
    "  assert.ok(indexSource.includes('latestPublicationLifecycle.state === PUBLICATION_STATES.published'));\n"
    "  assert.ok(indexSource.includes('&& !latestPostSnap?.exists'));\n",
    'published-post resurrection source assertion',
)
path.write_text(source, encoding='utf-8')
print('media source assertions aligned with canonical lifecycle authority')
