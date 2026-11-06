
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const passwordAuth = require('../lib/password-auth');

const PASSWORD = 'correct-horse-battery-staple';

function fakeRequest(chunks, headers = {}) {
  const req = new PassThrough();
  req.headers = headers;
  process.nextTick(() => {
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
  return req;
}

test('password checker matches only the exact password', () => {
  const check = passwordAuth.createPasswordChecker(PASSWORD);
  assert.equal(check(PASSWORD), true);
  assert.equal(check(`${PASSWORD} `), false);
  assert.equal(check('correct-horse'), false);
  assert.equal(check(''), false);
  assert.equal(check(undefined), false);
  assert.equal(check(42), false);
});

test('password checker refuses short passwords', () => {
  assert.throws(() => passwordAuth.createPasswordChecker('short'), /at least 12/);
  assert.throws(() => passwordAuth.createPasswordChecker(''), /at least 12/);
  assert.throws(() => passwordAuth.createPasswordChecker(null), /at least 12/);
});

test('rate limiter blocks after max failures and reopens after the window', () => {
  let clock = 0;
  const limiter = passwordAuth.createRateLimiter({ maxFailures: 3, windowMs: 60000, now: () => clock });
  assert.equal(limiter.check('a').allowed, true);
  limiter.fail('a');
  limiter.fail('a');
  assert.equal(limiter.check('a').allowed, true);
  limiter.fail('a');

  clock = 15000;
  const blocked = limiter.check('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 45);
  assert.equal(limiter.check('b').allowed, true, 'other clients are not affected');

  clock = 60000;
  assert.equal(limiter.check('a').allowed, true, 'window expired');
});

test('rate limiter reset clears a client', () => {
  const limiter = passwordAuth.createRateLimiter({ maxFailures: 2, windowMs: 60000, now: () => 0 });
  limiter.fail('a');
  limiter.fail('a');
  assert.equal(limiter.check('a').allowed, false);
  limiter.reset('a');
  assert.equal(limiter.check('a').allowed, true);
});

test('rate limiter keeps a bounded number of clients', () => {
  const limiter = passwordAuth.createRateLimiter({ maxFailures: 5, windowMs: 60000, maxClients: 2, now: () => 0 });
  limiter.fail('a');
  limiter.fail('b');
  limiter.fail('c');
  assert.ok(limiter.size() <= 2);
});

test('readBody resolves small bodies', async () => {
  const body = await passwordAuth.readBody(fakeRequest([Buffer.from('{"a":'), Buffer.from('1}')]));
  assert.equal(body, '{"a":1}');
});

test('readBody rejects bodies over the 2 KB cap', async () => {
  const big = Buffer.alloc(passwordAuth.MAX_BODY_BYTES + 1, 'x');
  await assert.rejects(passwordAuth.readBody(fakeRequest([big])), (err) => err.status === 413);
  await assert.rejects(
    passwordAuth.readBody(fakeRequest([], { 'content-length': String(passwordAuth.MAX_BODY_BYTES + 10) })),
    (err) => err.status === 413,
  );
  await assert.rejects(passwordAuth.readBody(fakeRequest([Buffer.alloc(10)]), { limit: 5 }), (err) => err.code === 'payload_too_large');
});

test('parseLoginBody accepts JSON and urlencoded forms only', () => {
  assert.deepEqual(passwordAuth.parseLoginBody('{"password":"p","role":"admin"}', 'application/json; charset=utf-8'), { password: 'p', role: 'admin' });
  assert.deepEqual(passwordAuth.parseLoginBody('password=p%20q&role=research', 'application/x-www-form-urlencoded'), { password: 'p q', role: 'research' });
  assert.deepEqual(passwordAuth.parseLoginBody('{"password":1,"role":["x"]}', 'application/json'), { password: '', role: '' });
  assert.equal(passwordAuth.parseLoginBody('{bad', 'application/json'), null);
  assert.equal(passwordAuth.parseLoginBody('[]', 'application/json'), null);
  assert.equal(passwordAuth.parseLoginBody('password=p', 'text/plain'), null);
  assert.equal(passwordAuth.parseLoginBody('', undefined), null);
});

test('isSameOrigin refuses cross-site requests', () => {
  const same = passwordAuth.isSameOrigin;
  assert.equal(same({ headers: { 'sec-fetch-site': 'same-origin' } }), true);
  assert.equal(same({ headers: { 'sec-fetch-site': 'cross-site' } }), false);
  assert.equal(same({ headers: { 'sec-fetch-site': 'same-site' } }), false);
  assert.equal(same({ headers: { origin: 'http://a.test:3016', host: 'a.test:3016' } }), true);
  assert.equal(same({ headers: { origin: 'http://evil.test', host: 'a.test' } }), false);
  assert.equal(same({ headers: { origin: 'null', host: 'a.test' } }), false);
  assert.equal(same({ headers: {} }), true, 'non-browser clients send neither header');

  const proxied = { headers: { origin: 'https://pub.example', host: 'internal:3016', 'x-forwarded-host': 'pub.example' } };
  assert.equal(same(proxied, { trustProxy: true }), true);
  assert.equal(same(proxied, { trustProxy: false }), false);
});
