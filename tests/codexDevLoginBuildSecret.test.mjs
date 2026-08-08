import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const secret = process.env.CODEX_DEV_LOGIN_SECRET || '';
assert.ok(secret, 'CODEX_DEV_LOGIN_SECRET must be set to the recognizable build test value');

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else files.push(path);
  }
};
walk(new URL('../dist', import.meta.url).pathname);

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  assert.equal(content.includes(secret), false, `${file} must not contain CODEX_DEV_LOGIN_SECRET`);
}

console.log('PASS codexDevLoginBuildSecret.test');
