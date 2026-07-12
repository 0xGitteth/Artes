import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCodexDevLoginDecision,
  getCodexDevLoginDiagnostics,
  shouldExposeCodexDevLoginDiagnostics,
} from '../codexDevLogin.js';

const envFor = (overrides = {}) => ({
  CODEX_DEV_LOGIN_ENABLED: 'true',
  CODEX_DEV_ALLOWED_PROJECT_IDS: 'artes-dev,artes-staging',
  GCLOUD_PROJECT: 'artes-dev',
  ARTES_ENV: 'development',
  ...overrides,
});

test('Codex dev login is blocked when CODEX_DEV_LOGIN_ENABLED is missing', () => {
  assert.deepEqual(
    getCodexDevLoginDecision(envFor({ CODEX_DEV_LOGIN_ENABLED: undefined })),
    { allowed: false, code: 'disabled' }
  );
});

test('Codex dev login is blocked when ARTES_ENV is missing', () => {
  assert.deepEqual(
    getCodexDevLoginDecision(envFor({ ARTES_ENV: undefined })),
    { allowed: false, code: 'forbidden_environment' }
  );
});

test('Codex dev login is blocked when ARTES_ENV is production', () => {
  assert.deepEqual(
    getCodexDevLoginDecision(envFor({ ARTES_ENV: 'production' })),
    { allowed: false, code: 'forbidden_environment' }
  );
});

test('Codex dev login is blocked when ARTES_ENV is unknown', () => {
  assert.deepEqual(
    getCodexDevLoginDecision(envFor({ ARTES_ENV: 'qa' })),
    { allowed: false, code: 'forbidden_environment' }
  );
});

test('Codex dev login is blocked when CODEX_DEV_LOGIN_FORBIDDEN is true', () => {
  assert.deepEqual(
    getCodexDevLoginDecision(envFor({ CODEX_DEV_LOGIN_FORBIDDEN: 'true' })),
    { allowed: false, code: 'forbidden_environment' }
  );
});

test('Codex dev login is blocked when project id is not allowed', () => {
  assert.deepEqual(
    getCodexDevLoginDecision(envFor({ GCLOUD_PROJECT: 'artes-prod' })),
    { allowed: false, code: 'project_not_allowed' }
  );
});

test('Codex dev login is allowed when enabled, project allowed, and ARTES_ENV is development', () => {
  assert.deepEqual(getCodexDevLoginDecision(envFor({ ARTES_ENV: 'development' })), { allowed: true, code: 'allowed' });
});

test('Codex dev login is allowed when enabled, project allowed, and ARTES_ENV is staging', () => {
  assert.deepEqual(
    getCodexDevLoginDecision(envFor({ GCLOUD_PROJECT: 'artes-staging', ARTES_ENV: 'staging' })),
    { allowed: true, code: 'allowed' }
  );
});

test('NODE_ENV production alone does not block when explicit dev-login checks pass for staging', () => {
  assert.deepEqual(
    getCodexDevLoginDecision(envFor({ GCLOUD_PROJECT: 'artes-staging', ARTES_ENV: 'staging', NODE_ENV: 'production' })),
    { allowed: true, code: 'allowed' }
  );
});

test('Codex dev login diagnostics distinguish a missing ARTES_ENV without exposing values', () => {
  assert.deepEqual(
    getCodexDevLoginDiagnostics(envFor({ ARTES_ENV: undefined })),
    {
      artesEnvState: 'missing',
      loginForbidden: false,
      loginEnabled: true,
      projectIdState: 'present',
      projectAllowed: true,
      decisionCode: 'forbidden_environment',
    }
  );
});

test('Codex dev login diagnostics distinguish the explicit forbidden switch without exposing values', () => {
  assert.deepEqual(
    getCodexDevLoginDiagnostics(envFor({ CODEX_DEV_LOGIN_FORBIDDEN: 'true' })),
    {
      artesEnvState: 'allowed',
      loginForbidden: true,
      loginEnabled: true,
      projectIdState: 'present',
      projectAllowed: true,
      decisionCode: 'forbidden_environment',
    }
  );
});

test('Codex dev login diagnostics distinguish project allowlist failures without exposing project ids', () => {
  assert.deepEqual(
    getCodexDevLoginDiagnostics(envFor({ GCLOUD_PROJECT: 'artes-prod' })),
    {
      artesEnvState: 'allowed',
      loginForbidden: false,
      loginEnabled: true,
      projectIdState: 'present',
      projectAllowed: false,
      decisionCode: 'project_not_allowed',
    }
  );
});

test('Codex dev login diagnostics require both an env flag and request header', () => {
  const reqWithHeader = { get: (name) => (name === 'x-codex-dev-diagnostics' ? '1' : '') };
  const reqWithoutHeader = { get: () => '' };

  assert.equal(shouldExposeCodexDevLoginDiagnostics(reqWithHeader, envFor()), false);
  assert.equal(
    shouldExposeCodexDevLoginDiagnostics(reqWithoutHeader, envFor({ CODEX_DEV_LOGIN_DIAGNOSTICS_ENABLED: 'true' })),
    false
  );
  assert.equal(
    shouldExposeCodexDevLoginDiagnostics(reqWithHeader, envFor({ CODEX_DEV_LOGIN_DIAGNOSTICS_ENABLED: 'true' })),
    true
  );
});
