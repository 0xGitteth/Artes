import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const localEnvExample = readFileSync(new URL('../.env.local.example', import.meta.url), 'utf8');

assert.match(appSource, /import\.meta\.env\.DEV\s*&&\s*debugAllowed\(\)/, 'Codex dev login button remains development-only');
assert.match(appSource, /VITE_CODEX_DEV_LOGIN_SECRET/, 'frontend reads the dev login secret from Vite env');
assert.match(appSource, /X-Codex-Dev-Secret/, 'frontend sends the dev login secret header');
assert.match(appSource, /VITE_CODEX_DEV_LOGIN_SECRET ontbreekt/, 'frontend explains when the dev login secret env var is missing');
assert.doesNotMatch(appSource, /codex[-_ ]?dev[-_ ]?login[-_ ]?secret\s*=\s*['"][^'"]+['"]/i, 'no hardcoded dev login secret assignment is present');
assert.doesNotMatch(envExample, /VITE_CODEX_DEV_LOGIN_SECRET\s*=\s*['"]?[^\s'"<>]+/i, '.env.example must not contain a real dev login secret');
assert.doesNotMatch(localEnvExample, /VITE_CODEX_DEV_LOGIN_SECRET\s*=\s*['"]?[^\s'"<>]+/i, '.env.local.example must not contain a real dev login secret');

console.log('PASS codexDevLoginFrontend.source.test');
