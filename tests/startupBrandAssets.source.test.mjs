import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';

const appLogoSource = readFileSync(new URL('../src/components/branding/AppLogo.jsx', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const existingLogo = statSync(new URL('../public/brand/logo.png', import.meta.url));

assert.match(appLogoSource, /\/brand\/logo\.png/, 'AppLogo should use the existing startup-safe logo asset');
assert.doesNotMatch(appLogoSource, /logo square\.png/, 'AppLogo should not request the multi-megabyte source logo during startup');
assert.match(htmlSource, /\/brand\/logo\.png/, 'The browser favicon should use the existing logo asset');
assert.ok(existingLogo.size < 200_000, `existing logo should stay much smaller than the source logo, got ${existingLogo.size} bytes`);
assert.equal(existsSync(new URL('../public/brand/generated/startup-logo.svg', import.meta.url)), false, 'startup should not require a generated SVG asset');
assert.equal(existsSync(new URL('../public/brand/generated/favicon-64.png', import.meta.url)), false, 'startup should not require a generated PNG asset');

console.log('PASS startupBrandAssets.source.test');
