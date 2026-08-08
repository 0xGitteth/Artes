import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viteConfigSource = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');

assert.match(viteConfigSource, /loadEnv\(mode,\s*process\.cwd\(\),\s*''\)/, 'Vite config loads non-VITE server-side env for the dev server');
assert.match(viteConfigSource, /server\.middlewares\.use\('\/__codex-dev-login'/, 'Vite dev server registers the local Codex login route');
assert.match(viteConfigSource, /apply:\s*'serve'/, 'Codex proxy plugin only applies to the Vite dev server');
assert.match(viteConfigSource, /env\.CODEX_DEV_LOGIN_SECRET\s*\|\|\s*process\.env\.CODEX_DEV_LOGIN_SECRET/, 'proxy reads CODEX_DEV_LOGIN_SECRET server-side');
assert.match(viteConfigSource, /'X-Codex-Dev-Secret':\s*secret/, 'proxy forwards the secret only from server-side code');
assert.doesNotMatch(viteConfigSource, /console\.(log|debug|info|warn|error)\([^)]*secret/i, 'proxy must not log the secret');
assert.doesNotMatch(viteConfigSource, /res\.end\([^)]*secret/i, 'proxy must not return the secret in responses');

console.log('PASS codexDevLoginViteProxy.source.test');
