from pathlib import Path

path = Path('tests/moderationPreviewRetentionSource.test.mjs')
source = path.read_text(encoding='utf-8')
old = "  assert.ok(indexSource.includes(\"publicationStatus === 'draft'\"));\n"
new = (
    "  assert.ok(indexSource.includes('resolveUploadPublicationState(uploadData)'));\n"
    "  assert.ok(indexSource.includes('publicationStatus === PUBLICATION_STATES.draft'));\n"
)
if source.count(old) != 1:
    raise AssertionError(f'retention draft source assertion: expected 1 match, found {source.count(old)}')
source = source.replace(old, new, 1)
path.write_text(source, encoding='utf-8')
print('canonical retention source assertion aligned')
