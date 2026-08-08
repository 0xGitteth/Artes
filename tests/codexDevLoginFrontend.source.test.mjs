import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
const viteSecretName = ['VITE', 'CODEX', 'DEV', 'LOGIN', 'SECRET'].join('_');
const serverSecretAssignmentPattern = new RegExp(`${['CODEX', 'DEV', 'LOGIN', 'SECRET'].join('_')}\\s*=\\s*['\"]?[^\\s'\"<>]+`, 'i');
const viteConfigSource = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const localEnvExample = readFileSync(new URL('../.env.local.example', import.meta.url), 'utf8');

assert.match(appSource, /import\.meta\.env\.DEV\s*&&\s*debugAllowed\(\)/, 'Codex dev login button remains development-only');
assert.match(appSource, /fetch\('\/__codex-dev-login'/, 'frontend calls the local dev proxy route');
assert.equal(appSource.includes(viteSecretName), false, 'frontend must not read a Vite-exposed dev login secret');
assert.doesNotMatch(appSource, /CODEX_DEV_LOGIN_SECRET/, 'frontend must not read any dev login secret');
assert.doesNotMatch(appSource, /X-Codex-Dev-Secret/i, 'browser request must not send the secret header');
assert.match(viteConfigSource, /CODEX_DEV_LOGIN_SECRET/, 'Vite dev proxy reads the non-VITE server-side secret');
assert.match(viteConfigSource, /X-Codex-Dev-Secret/, 'Vite dev proxy adds the secret header server-side');
assert.doesNotMatch(viteConfigSource, /define\s*:/, 'Vite config must not expose the secret through define');
assert.doesNotMatch(viteConfigSource, /import\.meta\.env\.CODEX_DEV_LOGIN_SECRET/, 'Vite config must not expose the secret to client env');
assert.equal(envExample.includes(viteSecretName), false, '.env.example must not mention the Vite-exposed dev login secret');
assert.doesNotMatch(envExample, serverSecretAssignmentPattern, '.env.example must not contain a real dev login secret');
assert.equal(localEnvExample.includes(viteSecretName), false, '.env.local.example must not mention the Vite-exposed dev login secret');
assert.doesNotMatch(localEnvExample, serverSecretAssignmentPattern, '.env.local.example must not contain a real dev login secret');

console.log('PASS codexDevLoginFrontend.source.test');
