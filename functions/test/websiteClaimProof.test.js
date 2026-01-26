import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkWebsiteClaimToken,
  hashWebsiteProofToken,
  isPrivateIpAddress,
  isSafeRedirectTarget,
} from '../websiteClaimProof.js';

test('website claim token matches when token and expiry are valid', () => {
  const token = 'abc123token';
  const tokenHash = hashWebsiteProofToken(token);
  const result = checkWebsiteClaimToken({
    tokenHash,
    tokenExpiresAtMs: Date.now() + 1000,
    responseBody: token,
  });
  assert.equal(result.ok, true);
});

test('website claim token fails when token does not match', () => {
  const token = 'abc123token';
  const tokenHash = hashWebsiteProofToken(token);
  const result = checkWebsiteClaimToken({
    tokenHash,
    tokenExpiresAtMs: Date.now() + 1000,
    responseBody: 'wrong-token',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mismatch');
});

test('website claim token fails when expired', () => {
  const token = 'abc123token';
  const tokenHash = hashWebsiteProofToken(token);
  const result = checkWebsiteClaimToken({
    tokenHash,
    tokenExpiresAtMs: Date.now() - 1000,
    responseBody: token,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired');
});

test('private IPs are blocked for SSRF protection', () => {
  assert.equal(isPrivateIpAddress('127.0.0.1'), true);
  assert.equal(isPrivateIpAddress('10.0.0.5'), true);
  assert.equal(isPrivateIpAddress('192.168.1.10'), true);
  assert.equal(isPrivateIpAddress('8.8.8.8'), false);
});

test('unsafe redirects are rejected', () => {
  const baseHostname = 'example.com';
  assert.equal(
    isSafeRedirectTarget({ baseHostname, targetUrl: new URL('https://example.com/ok') }),
    true
  );
  assert.equal(
    isSafeRedirectTarget({ baseHostname, targetUrl: new URL('https://evil.com/') }),
    false
  );
  assert.equal(
    isSafeRedirectTarget({ baseHostname, targetUrl: new URL('http://example.com/') }),
    false
  );
});
