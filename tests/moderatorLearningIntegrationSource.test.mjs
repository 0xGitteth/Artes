import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const frontend = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');

test('moderator UI submits adaptive visual learning evidence without changing policy action', () => {
  assert.match(frontend, /import ModeratorLearningEvidenceFields from '\.\/components\/ModeratorLearningEvidenceFields';/);
  assert.match(frontend, /const \[moderatorLearningSubmission, setModeratorLearningSubmission\] = useState\(null\);/);
  assert.match(frontend, /<ModeratorLearningEvidenceFields[\s\S]*reasonCode=\{decisionReasonCode\}[\s\S]*value=\{moderatorLearningSubmission\}/);
  assert.match(frontend, /\.\.\.\(moderatorLearningSubmission \? \{ moderatorLearningSubmission \} : \{\}\),/);
});

test('moderatorDecide validates learning evidence server-side and persists it with moderator decisions', () => {
  assert.match(backend, /import \{ buildModeratorDecisionLearningFields \} from '\.\/moderationModeratorLearningSubmission\.js';/);
  const start = backend.indexOf('export const moderatorDecide');
  const end = backend.indexOf('export const moderatorQueueFreshEvaluation', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const section = backend.slice(start, end);
  assert.match(section, /const moderatorLearningSubmission = body\?\.moderatorLearningSubmission \?\? null;/);
  assert.match(section, /moderatorLearningFields = buildModeratorDecisionLearningFields\(\{/);
  assert.match(section, /submission: moderatorLearningSubmission,/);
  assert.match(section, /\.\.\.moderatorLearningFields,/);
});
