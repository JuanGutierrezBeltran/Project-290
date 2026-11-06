'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createToken, verifyToken, parseCookies, serializeCookie } = require('../lib/session');

const SECRET = 'unit-test-secret-0123456789abcdef0123456789';
const NOW = Date.parse('2026-11-05T12:00:00Z');

test('a signed token round-trips with iat/exp', () => {
  const token = createToken({ sub: 'u1', role: 'research' }, SECRET, { ttlSeconds: 3600, now: NOW });
  const claims = verifyToken(token, SECRET, NOW + 1000);
  assert.equal(claims.sub, 'u1');
  assert.equal(claims.role, 'research');
  assert.equal(claims.exp - claims.iat, 3600);
});

test('claims cannot override iat/exp', () => {
  const token = createToken({ role: 'admin', exp: 9999999999 }, SECRET, { ttlSeconds: 60, now: NOW });
  assert.equal(verifyToken(token, SECRET, NOW + 61000), null);
});

test('a tampered payload is rejected', () => {
  const token = createToken({ sub: 'u1', role: 'research' }, SECRET, { now: NOW });
  const [, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'u1', role: 'admin', iat: 0, exp: 9999999999 })).toString('base64url');
  assert.equal(verifyToken(`${forged}.${sig}`, SECRET, NOW), null);
});

test('a tampered signature is rejected', () => {
  const token = createToken({ role: 'research' }, SECRET, { now: NOW });
  const last = token.slice(-1) === 'A' ? 'B' : 'A';
  assert.equal(verifyToken(token.slice(0, -1) + last, SECRET, NOW), null);
});

test('a token signed with another secret is rejected', () => {
  const token = createToken({ role: 'research' }, 'another-secret-another-secret-123456', { now: NOW });
  assert.equal(verifyToken(token, SECRET, NOW), null);
});

test('an expired token is rejected', () => {
  const token = createToken({ role: 'research' }, SECRET, { ttlSeconds: 60, now: NOW });
  assert.ok(verifyToken(token, SECRET, NOW + 59000));
  assert.equal(verifyToken(token, SECRET, NOW + 60000), null);
});

test('malformed tokens and missing secrets fail closed', () => {
  for (const bad of ['', 'abc', 'a.b.c', '.', 'x.', '.y', null, undefined, 42]) {
    assert.equal(verifyToken(bad, SECRET, NOW), null);
  }
  const token = createToken({ role: 'research' }, SECRET, { now: NOW });
  assert.equal(verifyToken(token, '', NOW), null);
  assert.throws(() => createToken({ role: 'research' }, ''));
});

test('parseCookies handles multiple, encoded and malformed cookies', () => {
  assert.deepEqual(parseCookies('a=1; eb_session=x.y; c=hello%20world'), { a: '1', eb_session: 'x.y', c: 'hello world' });
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('bad; =x; d=%E0%A4%A'), { d: '%E0%A4%A' });
  assert.equal(parseCookies('a=1; a=2').a, '1');
});

test('serializeCookie sets hardened flags', () => {
  const cookie = serializeCookie('eb_session', 'x.y', { maxAge: 3600 });
  assert.match(cookie, /^eb_session=x\.y; /);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=3600/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, /Secure/);
  assert.match(serializeCookie('n', 'v', { secure: true }), /Secure/);
});
