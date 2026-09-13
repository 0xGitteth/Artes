import test from 'node:test';
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
