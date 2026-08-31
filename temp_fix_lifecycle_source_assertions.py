from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


anchor_path = Path('tests/moderationPr378P2Source.test.mjs')
anchor = anchor_path.read_text(encoding='utf-8')
anchor = replace_once(
    anchor,
    "  const end = indexSource.indexOf('if (reviewCaseId && uploadId)', start);\n",
    "  const end = indexSource.indexOf(\"const finalizationOutcome = finalizationResult?.outcome || 'pending';\", start);\n",
    'durable preview anchor source window',
)
anchor_path.write_text(anchor, encoding='utf-8')

retention_path = Path('tests/moderationPreviewRetentionSelfReviewSource.test.mjs')
retention = retention_path.read_text(encoding='utf-8')
retention = replace_once(
    retention,
    "const pendingSource = fs.readFileSync(new URL('../src/utils/pendingApprovedUpload.js', import.meta.url), 'utf8');\n",
    "const pendingSource = fs.readFileSync(new URL('../src/utils/pendingApprovedUpload.js', import.meta.url), 'utf8');\n"
    "const lifecycleSource = fs.readFileSync(new URL('../src/utils/moderationUploadLifecycle.js', import.meta.url), 'utf8');\n",
    'client lifecycle source fixture',
)
retention = replace_once(
    retention,
    "test('expired cleanup states cannot reappear as pending approved uploads', () => {\n"
    "  for (const status of ['expired', 'deleted', 'deleted_pending_cleanup']) {\n"
    "    assert.ok(pendingSource.includes(`'${status}'`));\n"
    "  }\n"
    "});\n",
    "test('expired cleanup states cannot reappear as pending approved uploads', () => {\n"
    "  assert.match(pendingSource, /isClientUploadAllowedPending/);\n"
    "  for (const status of ['expired', 'deleted', 'deleted_pending_cleanup']) {\n"
    "    assert.ok(lifecycleSource.includes(`'${status}'`));\n"
    "  }\n"
    "});\n",
    'cleanup-state authority source assertion',
)
retention_path.write_text(retention, encoding='utf-8')

print('lifecycle source assertions aligned with canonical authority')
