from pathlib import Path

path = Path('temp_apply_media_anchor_refactor.py')
source = path.read_text(encoding='utf-8')
old = "for path in ['functions/index.js', 'functions/moderationPreviewStorage.js', 'firestore.rules', 'tests/moderationPr378P2Source.test.mjs']:\n"
new = "for path in ['functions/index.js', 'functions/moderationPreviewStorage.js', 'firestore.rules', 'docs/moderation-state-machine.md']:\n"
if source.count(old) != 1:
    raise AssertionError(f'expected one cleanup-task postcondition list, found {source.count(old)}')
source = source.replace(old, new, 1)
path.write_text(source, encoding='utf-8')
print('temporary cleanup-task postcondition narrowed to product files')
