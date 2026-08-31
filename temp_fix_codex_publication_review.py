from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


index_path = Path('functions/index.js')
index = index_path.read_text(encoding='utf-8')
index = replace_once(
    index,
    "import { canManageApprovedUploadPrompt, canPublishUpload, canSaveDraftUpload, getUserPublicPostPublishDecision, requiresMessageIdForAction } from './userModerationActionPolicy.js';",
    "import { canManageApprovedUploadPrompt, canPublishUpload, canSaveDraftUpload, getServerPublicPostPublishDecision, requiresMessageIdForAction } from './userModerationActionPolicy.js';",
    'server publication policy import',
)
index = replace_once(
    index,
    "          const publishDecision = getUserPublicPostPublishDecision(latestUserSnap?.exists ? latestUserSnap.data() : null);",
    "          const publishDecision = getServerPublicPostPublishDecision({\n"
    "            user: latestUserSnap?.exists ? latestUserSnap.data() : null,\n"
    "            tokenClaims: decoded,\n"
    "          });",
    'transactional publication decision',
)
index_path.write_text(index, encoding='utf-8')

app_path = Path('src/ArtesApp.jsx')
app = app_path.read_text(encoding='utf-8')
app = replace_once(
    app,
    "import { resolvePersistedModerationPublicationUploadId } from './utils/moderationPublicationRouting';\n",
    "import { resolvePersistedModerationPublicationUploadId } from './utils/moderationPublicationRouting';\n"
    "import { resolveModerationApiBase } from './utils/moderationApiBase';\n",
    'client API base import',
)
start_marker = '  const moderationApiBase = useMemo(() => {'
start = app.find(start_marker)
if start < 0:
    raise AssertionError('moderationApiBase block start not found')
end_marker = '  }, []);'
end = app.find(end_marker, start)
if end < 0:
    raise AssertionError('moderationApiBase block end not found')
end += len(end_marker)
old_block = app[start:end]
if 'VITE_MODERATION_API_BASE' not in old_block or 'VITE_MODERATION_FUNCTION_URL' not in old_block:
    raise AssertionError('unexpected moderationApiBase block')
new_block = "  const moderationApiBase = useMemo(() => resolveModerationApiBase(import.meta.env), []);"
app = app[:start] + new_block + app[end:]
app_path.write_text(app, encoding='utf-8')

source_test = Path('tests/moderationCodexReviewFixesSource.test.mjs')
source_test.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const clientSource = fs.readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');

test('server publication requires decoded verified-adult claims inside the authoritative mutation', () => {
  const start = indexSource.indexOf('export const userModerationAction');
  const end = indexSource.indexOf('export const moderatorDecide', start);
  const source = indexSource.slice(start, end);
  const mutation = source.indexOf('runUserModerationActionMutation({');
  const decision = source.indexOf('getServerPublicPostPublishDecision({', mutation);
  const postCreate = source.indexOf('transaction.create(postRef', decision);
  assert.ok(mutation >= 0 && mutation < decision && decision < postCreate);
  assert.match(source.slice(decision, postCreate), /tokenClaims: decoded/);
  assert.match(source.slice(decision, postCreate), /latestUserSnap/);
});

test('client publication API base is resolved through the shared configuration helper', () => {
  assert.match(clientSource, /import \{ resolveModerationApiBase \} from '\.\/utils\/moderationApiBase'/);
  assert.match(clientSource, /const moderationApiBase = useMemo\(\(\) => resolveModerationApiBase\(import\.meta\.env\), \[\]\)/);
  assert.doesNotMatch(clientSource, /const explicitBase = import\.meta\.env\.VITE_MODERATION_API_BASE/);
});
''', encoding='utf-8')

print('Codex publication review fixes applied')
