import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const artesSource = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');

assert.match(appSource, /lazy\(\(\) => import\('\.\/pages\/DebugPage\.jsx'\)\)/, 'Debug page stays out of the initial landing bundle');

for (const component of [
  'ChatPanel',
  'ModerationSupportChat',
  'PhotoDetailModal',
  'ProfileImageCropper',
]) {
  assert.match(
    artesSource,
    new RegExp(`const ${component} = lazy\\(\\(\\) => import\\('\\.\\/components\\/${component}'\\)\\)`),
    `${component} is lazily imported so it does not inflate startup JavaScript`
  );
}

assert.match(artesSource, /<Suspense\b/, 'Lazy startup components are rendered behind Suspense boundaries');

console.log('PASS startupCodeSplitting.source.test');
