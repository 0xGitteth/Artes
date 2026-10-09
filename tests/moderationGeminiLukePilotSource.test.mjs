import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scorePilot = readFileSync(new URL('../functions/scripts/runGeminiLukePilot.mjs', import.meta.url), 'utf8');
const wrapper = readFileSync(new URL('../vision-service/run_gemini_luke_12.sh', import.meta.url), 'utf8');

test('Gemini pilot requires explicit authorization and non-production staging project', () => {
  assert.match(scorePilot, /'--external-google-approved'/);
  assert.match(scorePilot, /ARTES_GEMINI_COMPARISON_AUTHORIZED !== 'YES'/);
  assert.match(scorePilot, /GOOGLE_CLOUD_PROJECT !== 'artes-staging'/);
  assert.match(scorePilot, /ENABLE_GEMINI_CLASSIFIER !== 'true'/);
  assert.match(wrapper, /GOOGLE_CLOUD_PROJECT=artes-staging/);
  assert.doesNotMatch(wrapper, /artes-media-app/);
});

test('Gemini pilot caps requests cumulatively across reruns rather than per execution', () => {
  assert.match(scorePilot, /const APPROVED_CUMULATIVE_CALL_CAP = 12;/);
  assert.match(scorePilot, /const remainingApprovedCalls = APPROVED_CUMULATIVE_CALL_CAP - cached\.size/);
  assert.match(scorePilot, /Math\.min\(maxNew, outstanding\.length, remainingApprovedCalls\)/);
  assert.match(scorePilot, /for \(const row of outstanding\.slice\(0, permittedCallsThisRun\)\)/);
  assert.match(wrapper, /--limit 12 --max-new 12/);
  assert.match(wrapper, /--external-google-approved/);
});

test('Gemini pilot aborts the paid batch when API fails or returns invalid contract', () => {
  assert.match(scorePilot, /record\.status === 'api_error' \|\| record\.status === 'invalid_response'/);
  assert.match(scorePilot, /Stopping on first API failure/);
  assert.match(scorePilot, /const cached = checkCache\(rows, targetModel, GEMINI_MODERATION_PROMPT_VERSION\)/);
  assert.match(scorePilot, /if \(preview\) \{/);
});

test('External Gemini wrapper does not modify production state or install new dependencies', () => {
  assert.match(wrapper, /git show "\$REF:functions\/scripts\/runGeminiLukePilot\.mjs"/);
  assert.match(wrapper, /functions\/node_modules\/@google-cloud\/vertexai/);
  assert.doesNotMatch(wrapper, /npm install|npm ci|git checkout|git switch|firebase deploy|gcloud run deploy/);
  assert.match(wrapper, /gemini-luke-aggregate\.json/);
});
