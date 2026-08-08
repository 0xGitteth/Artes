import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viteConfigSource = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');

assert.match(viteConfigSource, /loadEnv\(mode,\s*process\.cwd\(\),\s*''\)/, 'Vite config loads non-VITE server-side env for the dev server');
assert.match(viteConfigSource, /server\.middlewares\.use\('\/__codex-dev-login'/, 'Vite dev server registers the local Codex login route');
assert.match(viteConfigSource, /apply:\s*'serve'/, 'Codex proxy plugin only applies to the Vite dev server');
assert.match(viteConfigSource, /env\.CODEX_DEV_LOGIN_SECRET\s*\|\|\s*process\.env\.CODEX_DEV_LOGIN_SECRET/, 'proxy reads CODEX_DEV_LOGIN_SECRET server-side');
for (const envName of [
  'VITE_FUNCTIONS_BASE_URL',
  'VITE_FUNCTIONS_BASE',
  'VITE_MODERATION_API_BASE',
  'VITE_MODERATION_FUNCTION_URL',
]) {
  assert.match(viteConfigSource, new RegExp(`getEnv\\('${envName}'\\)`), `proxy supports ${envName}`);
}
assert.match(viteConfigSource, /env\[name\]\s*\|\|\s*process\.env\[name\]/, 'each functions-base fallback supports loadEnv and process.env values');
assert.match(viteConfigSource, /getEnv\('VITE_MODERATION_FUNCTION_URL'\)\.replace\(\/\\\/moderateImage\\\/\?\$\//, 'proxy strips a trailing /moderateImage from the moderation function URL');
assert.doesNotMatch(viteConfigSource, /Set CODEX_DEV_LOGIN_SECRET and VITE_FUNCTIONS_BASE_URL/, 'configuration error does not claim only one functions-base variable is supported');
assert.match(viteConfigSource, /'X-Codex-Dev-Secret':\s*secret/, 'proxy forwards the secret only from server-side code');
assert.doesNotMatch(viteConfigSource, /console\.(log|debug|info|warn|error)\([^)]*secret/i, 'proxy must not log the secret');
assert.doesNotMatch(viteConfigSource, /res\.end\([^)]*secret/i, 'proxy must not return the secret in responses');

console.log('PASS codexDevLoginViteProxy.source.test');
