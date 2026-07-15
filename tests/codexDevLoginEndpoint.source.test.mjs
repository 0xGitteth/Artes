import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const functionSource = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const helperSource = readFileSync(new URL('../functions/codexDevLogin.js', import.meta.url), 'utf8');

assert.match(functionSource, /defineSecret\('CODEX_DEV_LOGIN_SECRET'\)/, 'CODEX_DEV_LOGIN_SECRET is defined as a Firebase secret');
assert.match(functionSource, /secrets:\s*\[codexDevLoginSecret\]/, 'secret is bound only to createDevCodexToken');
assert.match(functionSource, /req\.get\('x-codex-dev-secret'\)/, 'endpoint reads the X-Codex-Dev-Secret header');
assert.match(functionSource, /code:\s*'forbidden_secret'/, 'endpoint rejects missing or invalid dev login secrets before issuing tokens');
assert.ok(
  functionSource.indexOf('isValidCodexDevLoginSecret') < functionSource.indexOf('admin.auth().createCustomToken'),
  'secret validation must happen before custom token creation'
);
assert.match(helperSource, /timingSafeEqual/, 'secret comparison uses a timing-safe primitive');
assert.doesNotMatch(helperSource, /CODEX_DEV_LOGIN_SECRET\s*=\s*['"][^'"]+['"]/, 'helper does not hardcode the secret');

console.log('PASS codexDevLoginEndpoint.source.test');
