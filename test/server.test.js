
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../lib/app');
const { createToken } = require('../lib/session');
const { readConfig } = require('../server');
const FIXTURE = require('./fixtures/dashboard.json');

const SECRET = 'integration-test-secret-0123456789abcdef';
const fixtureLoader = async () => JSON.parse(JSON.stringify(FIXTURE));

// The app has no file or sample fallback, so every test server gets the
// fixture loader unless a test overrides loadDashboard.
async function withServer(options, fn) {
  const server = http.createServer(createApp({ loadDashboard: fixtureLoader, ...options }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function request(port, urlPath, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function sessionCookie(role, { secret = SECRET, ttlSeconds = 3600, now = Date.now() } = {}) {
  return `eb_session=${createToken({ sub: `test-${role}`, role, name: 'Test' }, secret, { ttlSeconds, now })}`;
}

test('GET /health responds 200 JSON in live mode', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const res = await request(port, '/health');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(JSON.parse(res.body).status, 'ok');
    assert.equal(JSON.parse(res.body).mode, 'live');
  });
});

test('api/dashboard without a session is 401 and leaks no data', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const res = await request(port, '/api/dashboard');
    assert.equal(res.status, 401);
    assert.equal(JSON.parse(res.body).error, 'authentication_required');
    assert.equal(res.body.includes('builders'), false);
    assert.equal(res.body.includes('example.test'), false);
    assert.equal(JSON.parse(res.body).devLogin, undefined);
  });
});

test('api/* fails closed (503) when no session secret is configured', async () => {
  await withServer({}, async (port) => {
    const res = await request(port, '/api/dashboard', { headers: { Cookie: sessionCookie('admin') } });
    assert.equal(res.status, 503);
    assert.equal(res.body.includes('example.test'), false);
  });
});

test('tampered, foreign-secret and expired sessions are rejected', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const valid = sessionCookie('research');
    const tampered = valid.slice(0, -2) + (valid.endsWith('AA') ? 'BB' : 'AA');
    const foreign = sessionCookie('admin', { secret: 'some-other-secret-some-other-secret-1' });
    const expired = sessionCookie('admin', { ttlSeconds: 60, now: Date.now() - 120000 });
    for (const cookie of [tampered, foreign, expired]) {
      assert.equal((await request(port, '/api/dashboard', { headers: { Cookie: cookie } })).status, 401);
    }
  });
});

test('a valid session with an unknown role is 403', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const res = await request(port, '/api/dashboard', { headers: { Cookie: sessionCookie('superuser') } });
    assert.equal(res.status, 403);
  });
});

test('admin session gets full records', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const res = await request(port, '/api/dashboard', { headers: { Cookie: sessionCookie('admin') } });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.access.role, 'admin');
    assert.equal(body.builders.length, 8);
    assert.ok(body.builders[0].email);
  });
});

test('research session gets records without email or city', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const res = await request(port, '/api/dashboard', { headers: { Cookie: sessionCookie('research') } });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.builders.length, 8);
    assert.equal(res.body.includes('@example.test'), false);
    assert.equal(body.builders.some((b) => 'city' in b), false);
  });
});

test('executive and marketing sessions get aggregates only', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    for (const role of ['executive', 'marketing']) {
      const res = await request(port, '/api/dashboard', { headers: { Cookie: sessionCookie(role) } });
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.builders, undefined);
      assert.equal(body.restricted, true);
      assert.equal(body.summary.active, 2);
      assert.equal(res.body.includes('@example.test'), false);
      assert.equal(Array.isArray(body.channels), role === 'marketing');
    }
  });
});

test('api/session reports the caller role; unknown api routes are 404', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const res = await request(port, '/api/session', { headers: { Cookie: sessionCookie('program_manager') } });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).label, 'Program Manager');
    assert.equal((await request(port, '/api/other', { headers: { Cookie: sessionCookie('admin') } })).status, 404);
    assert.equal((await request(port, '/api/other')).status, 401);
  });
});

test('without a data loader api/dashboard answers 500 JSON (no file or sample fallback)', async () => {
  const errors = [];
  await withServer({ sessionSecret: SECRET, loadDashboard: null, onError: (err) => errors.push(err) }, async (port) => {
    const res = await request(port, '/api/dashboard', { headers: { Cookie: sessionCookie('admin') } });
    assert.equal(res.status, 500);
    assert.equal(JSON.parse(res.body).error, 'Data unavailable');
    assert.equal(res.body.includes('builders'), false);
    assert.equal(errors.length, 1);
  });
});

test('non-GET requests get 405', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    for (const [method, urlPath] of [['POST', '/api/dashboard'], ['PUT', '/'], ['DELETE', '/health'], ['POST', '/auth/dev-login?role=admin']]) {
      const res = await request(port, urlPath, { method });
      assert.equal(res.status, 405, `${method} ${urlPath}`);
      assert.equal(res.headers.allow, 'GET');
    }
  });
});

test('path traversal never serves files outside public/', async () => {
  const attempts = [
    '/../test/fixtures/dashboard.json',
    '/%2e%2e/test/fixtures/dashboard.json',
    '/%2E%2E/test/fixtures/dashboard.json',
    '/..%2ftest%2ffixtures%2fdashboard.json',
    '/%2e%2e%2ftest%2ffixtures%2fdashboard.json',
    '/..%5ctest%5cfixtures%5cdashboard.json',
    '/%2e%2e%5c%2e%2e%5cserver.js',
    '/public/../../test/fixtures/dashboard.json',
    '/..%2f..%2fserver.js',
    '/..%2f',
    '/%2e%2e%2f',
  ];
  await withServer({ sessionSecret: SECRET }, async (port) => {
    for (const attempt of attempts) {
      const res = await request(port, attempt);
      assert.ok([400, 403, 404].includes(res.status), `${attempt} -> ${res.status}`);
      assert.equal(res.body.includes('"builders"'), false, attempt);
      assert.equal(res.body.includes('createApp'), false, attempt);
    }
  });
});

test('bare dot segments collapse to the public shell, never outside public/', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    for (const attempt of ['/..', '/%2e%2e', '/../..']) {
      const res = await request(port, attempt);
      assert.equal(res.status, 200, attempt);
      assert.match(res.headers['content-type'], /text\/html/, attempt);
      assert.ok(res.body.includes('dashboard-core.js'), attempt);
      assert.equal(res.body.includes('@example.test'), false, attempt);
      assert.equal(res.body.includes('createApp'), false, attempt);
    }
  });
});

test('encoded slash traversal to the public root itself is refused', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    assert.equal((await request(port, '/..%2f')).status, 403);
    assert.equal((await request(port, '/%2e%2e%2f')).status, 403);
  });
});

test('malformed encoding and NUL bytes get 400 and do not crash the server', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    assert.equal((await request(port, '/%E0%A4%A')).status, 400);
    assert.equal((await request(port, '/index.html%00.js')).status, 400);
    assert.equal((await request(port, '/health')).status, 200);
  });
});

test('static shell and shared core module are served, without any demo banner', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const index = await request(port, '/');
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /text\/html/);
    assert.ok(index.body.includes('dashboard-core.js'));
    assert.equal(/demo|PROTOTIPO/i.test(index.body), false);
    const core = await request(port, '/dashboard-core.js');
    assert.equal(core.status, 200);
    assert.match(core.headers['content-type'], /text\/javascript/);
    assert.equal((await request(port, '/missing.js')).status, 404);
  });
});

test('dev login is disabled by default and without a secret', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    assert.equal((await request(port, '/auth/dev-login?role=admin')).status, 404);
  });
  await withServer({ devLogin: true }, async (port) => {
    assert.equal((await request(port, '/auth/dev-login?role=admin')).status, 404);
  });
});

test('dev login (opt-in) issues a hardened cookie that unlocks the API', async () => {
  await withServer({ sessionSecret: SECRET, devLogin: true }, async (port) => {
    const unauth = JSON.parse((await request(port, '/api/dashboard')).body);
    assert.equal(unauth.devLogin, true);
    assert.equal(unauth.roles.length, 5);

    const login = await request(port, '/auth/dev-login?role=executive');
    assert.equal(login.status, 302);
    assert.equal(login.headers.location, '../');
    const setCookie = login.headers['set-cookie'][0];
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);

    const res = await request(port, '/api/dashboard', { headers: { Cookie: setCookie.split(';')[0] } });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).access.role, 'executive');

    assert.equal((await request(port, '/auth/dev-login?role=root')).status, 400);
    assert.equal((await request(port, '/auth/dev-login?role=admin', { headers: { 'X-Forwarded-For': '203.0.113.9' } })).status, 403);
  });
});

const PORT_ENV = { PORT: '4321' };

test('readConfig honours PORT and HOST, with platform-friendly defaults', () => {
  const custom = readConfig({ PORT: '4321', HOST: '127.0.0.1' });
  assert.equal(custom.port, 4321);
  assert.equal(custom.host, '127.0.0.1');

  const defaults = readConfig({ ...PORT_ENV });
  assert.equal(defaults.port, 4321);
  assert.equal(defaults.host, '0.0.0.0');

  assert.equal(readConfig({ ...PORT_ENV, AUTH_DEV_LOGIN: '1' }).host, '127.0.0.1');
  assert.equal(readConfig({ ...PORT_ENV, AUTH_DEV_LOGIN: '1', HOST: '0.0.0.0' }).host, '0.0.0.0');
  assert.throws(() => readConfig({ PORT: 'abc' }), /PORT/);
  assert.throws(() => readConfig({ PORT: '70000' }), /PORT/);
});

test('readConfig fails fast when PORT is missing (the runtime must inject it)', () => {
  assert.throws(() => readConfig({}), /PORT is not set/);
  assert.throws(() => readConfig({ PORT: '' }), /PORT is not set/);
});

test('readConfig scopes the session cookie to BASE_PATH', () => {
  assert.equal(readConfig({ ...PORT_ENV }).cookiePath, '/');
  assert.equal(readConfig({ ...PORT_ENV, BASE_PATH: '/run/290' }).cookiePath, '/run/290/');
  assert.equal(readConfig({ ...PORT_ENV, BASE_PATH: '/run/290/' }).cookiePath, '/run/290/');
  assert.throws(() => readConfig({ ...PORT_ENV, BASE_PATH: '/run/290; Domain=evil' }), /BASE_PATH/);
});

test('TRUST_PROXY is off by default and only "1" turns it on', () => {
  assert.equal(readConfig({ ...PORT_ENV }).trustProxy, false);
  assert.equal(readConfig({ ...PORT_ENV, TRUST_PROXY: 'true' }).trustProxy, false);
  assert.equal(readConfig({ ...PORT_ENV, TRUST_PROXY: '1' }).trustProxy, true);
});

test('forwarded headers are ignored unless trustProxy is enabled', async () => {
  const headers = { 'X-Forwarded-Proto': 'https' };
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const res = await request(port, '/auth/logout', { headers });
    assert.doesNotMatch(res.headers['set-cookie'][0], /Secure/);
  });
  await withServer({ sessionSecret: SECRET, trustProxy: true }, async (port) => {
    const res = await request(port, '/auth/logout', { headers });
    assert.match(res.headers['set-cookie'][0], /Secure/);
  });
});

test('with trustProxy, dev login uses the proxy-appended client address', async () => {
  await withServer({ sessionSecret: SECRET, devLogin: true, trustProxy: true }, async (port) => {
    const local = await request(port, '/auth/dev-login?role=admin', {
      headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Proto': 'https' },
    });
    assert.equal(local.status, 302);
    assert.equal(local.headers.location, '../');
    assert.match(local.headers['set-cookie'][0], /Secure/);

    const remote = await request(port, '/auth/dev-login?role=admin', { headers: { 'X-Forwarded-For': '203.0.113.9' } });
    assert.equal(remote.status, 403);

    const spoofed = await request(port, '/auth/dev-login?role=admin', { headers: { 'X-Forwarded-For': '127.0.0.1, 203.0.113.9' } });
    assert.equal(spoofed.status, 403);
  });
});

const PASSWORD = 'correct-horse-battery-staple';

function passwordLogin(port, payload, headers = {}) {
  return request(port, '/auth/password-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers },
    body: JSON.stringify(payload),
  });
}

test('password login is off by default and without a secret', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    assert.equal((await passwordLogin(port, { password: PASSWORD, role: 'admin' })).status, 404);
    assert.equal(JSON.parse((await request(port, '/api/dashboard')).body).passwordLogin, undefined);
  });
  await withServer({ accessPassword: PASSWORD }, async (port) => {
    assert.equal((await passwordLogin(port, { password: PASSWORD, role: 'admin' })).status, 404);
  });
});

test('the old demo-login route no longer exists', async () => {
  await withServer({ sessionSecret: SECRET, accessPassword: PASSWORD }, async (port) => {
    const res = await request(port, '/auth/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ password: PASSWORD, role: 'admin' }),
    });
    assert.equal(res.status, 405);
    assert.equal(res.headers['set-cookie'], undefined);
  });
});

test('password login: wrong password is 401, right password unlocks the API with the chosen role', async () => {
  await withServer({ sessionSecret: SECRET, accessPassword: PASSWORD }, async (port) => {
    const unauth = JSON.parse((await request(port, '/api/dashboard')).body);
    assert.equal(unauth.passwordLogin, true);
    assert.equal(unauth.devLogin, undefined);
    assert.equal(unauth.roles.length, 5);

    const wrong = await passwordLogin(port, { password: 'not-the-access-password', role: 'admin' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers['set-cookie'], undefined);

    const ok = await passwordLogin(port, { password: PASSWORD, role: 'research' });
    assert.equal(ok.status, 204);
    const setCookie = ok.headers['set-cookie'][0];
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);

    const res = await request(port, '/api/dashboard', { headers: { Cookie: setCookie.split(';')[0] } });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).access.role, 'research');
    assert.equal(res.body.includes('@example.test'), false);

    const who = JSON.parse((await request(port, '/api/session', { headers: { Cookie: setCookie.split(';')[0] } })).body);
    assert.equal(/demo/i.test(who.name), false);
  });
});

test('password login accepts a urlencoded form and rejects bad input', async () => {
  await withServer({ sessionSecret: SECRET, accessPassword: PASSWORD }, async (port) => {
    const form = await request(port, '/auth/password-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: PASSWORD, role: 'executive' }).toString(),
    });
    assert.equal(form.status, 204);

    const unknownRole = await passwordLogin(port, { password: PASSWORD, role: 'root' });
    assert.equal(unknownRole.status, 400);
    assert.equal(JSON.parse(unknownRole.body).error, 'unknown_role');

    const plain = await request(port, '/auth/password-login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: PASSWORD });
    assert.equal(plain.status, 400);

    const big = await request(port, '/auth/password-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(3000) });
    assert.equal(big.status, 413);

    const get = await request(port, '/auth/password-login');
    assert.equal(get.status, 405);
    assert.equal(get.headers.allow, 'POST');
  });
});

test('password login rate-limits repeated failures with 429 and Retry-After', async () => {
  await withServer({ sessionSecret: SECRET, accessPassword: PASSWORD, passwordRateLimit: { maxFailures: 3, windowMs: 60000 } }, async (port) => {
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await passwordLogin(port, { password: 'wrong-password-123', role: 'admin' })).status, 401);
    }
    const limited = await passwordLogin(port, { password: PASSWORD, role: 'admin' });
    assert.equal(limited.status, 429);
    const retryAfter = Number(limited.headers['retry-after']);
    assert.ok(retryAfter >= 1 && retryAfter <= 60, `Retry-After ${retryAfter}`);
    assert.equal(limited.headers['set-cookie'], undefined);
  });
});

test('password login refuses cross-site requests', async () => {
  await withServer({ sessionSecret: SECRET, accessPassword: PASSWORD }, async (port) => {
    assert.equal((await passwordLogin(port, { password: PASSWORD, role: 'admin' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);

    const evil = await request(port, '/auth/password-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://evil.example' },
      body: new URLSearchParams({ password: PASSWORD, role: 'admin' }).toString(),
    });
    assert.equal(evil.status, 403);
    assert.equal(evil.headers['set-cookie'], undefined);

    const sameOrigin = await request(port, '/auth/password-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ password: PASSWORD, role: 'admin' }),
    });
    assert.equal(sameOrigin.status, 204);
  });
});

test('other POST routes stay 405 when password login is enabled', async () => {
  await withServer({ sessionSecret: SECRET, accessPassword: PASSWORD }, async (port) => {
    for (const urlPath of ['/api/dashboard', '/auth/logout', '/auth/dev-login?role=admin', '/']) {
      const res = await request(port, urlPath, { method: 'POST' });
      assert.equal(res.status, 405, urlPath);
      assert.equal(res.headers.allow, 'GET');
    }
  });
});

test('readConfig reads ACCESS_PASSWORD and still accepts DEMO_PASSWORD', () => {
  assert.equal(readConfig({ ...PORT_ENV }).passwordLogin, false);
  assert.throws(() => readConfig({ ...PORT_ENV, ACCESS_PASSWORD: 'short' }), /ACCESS_PASSWORD/);
  assert.throws(() => readConfig({ ...PORT_ENV, DEMO_PASSWORD: 'short' }), /DEMO_PASSWORD/);

  const cfg = readConfig({ ...PORT_ENV, ACCESS_PASSWORD: PASSWORD });
  assert.equal(cfg.passwordLogin, true);
  assert.equal(cfg.accessPassword, PASSWORD);
  assert.equal(cfg.ephemeralSecret, true);
  assert.ok(cfg.sessionSecret.length >= 32);
  assert.equal(cfg.host, '0.0.0.0');

  assert.equal(readConfig({ ...PORT_ENV, DEMO_PASSWORD: PASSWORD }).accessPassword, PASSWORD);
  assert.equal(readConfig({ ...PORT_ENV, ACCESS_PASSWORD: PASSWORD, DEMO_PASSWORD: 'another-long-password' }).accessPassword, PASSWORD);

  const withSecret = readConfig({ ...PORT_ENV, ACCESS_PASSWORD: PASSWORD, SESSION_SECRET: SECRET });
  assert.equal(withSecret.ephemeralSecret, false);
  assert.equal(withSecret.sessionSecret, SECRET);
});

const VALID_CONTENT = { url: 'https://example.test/post/9', platform: 'LinkedIn', publishedAt: '2024-06-01' };

function postContent(port, code, payload, headers = {}) {
  return request(port, `/api/builders/${code}/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

test('content endpoint enforces session, role, origin and method', async () => {
  const saved = [];
  const saveContent = async (value, by) => { saved.push({ value, by }); return { ok: true, content: { id: value.code } }; };
  await withServer({ sessionSecret: SECRET, saveContent }, async (port) => {
    assert.equal((await postContent(port, 'EB-ABCDEF12', VALID_CONTENT)).status, 401);
    for (const role of ['research', 'executive', 'marketing']) {
      assert.equal((await postContent(port, 'EB-ABCDEF12', VALID_CONTENT, { Cookie: sessionCookie(role) })).status, 403, role);
    }
    const cross = await postContent(port, 'EB-ABCDEF12', VALID_CONTENT, { Cookie: sessionCookie('admin'), 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(cross.status, 403);
    const get = await request(port, '/api/builders/EB-ABCDEF12/content', { headers: { Cookie: sessionCookie('admin') } });
    assert.equal(get.status, 405);
    assert.equal(get.headers.allow, 'POST');
    assert.equal(saved.length, 0);
  });
});

test('content endpoint validates input and saves for admin and program_manager', async () => {
  const saved = [];
  const saveContent = async (value, by) => { saved.push({ value, by }); return { ok: true, content: { id: value.code, contentUrl: value.url } }; };
  await withServer({ sessionSecret: SECRET, saveContent }, async (port) => {
    const admin = { Cookie: sessionCookie('admin') };
    const badUrl = await postContent(port, 'EB-ABCDEF12', { ...VALID_CONTENT, url: 'javascript:alert(1)' }, admin);
    assert.equal(badUrl.status, 400);
    assert.deepEqual(JSON.parse(badUrl.body).fields, ['url']);
    const badCode = await postContent(port, 'xyz', VALID_CONTENT, admin);
    assert.deepEqual(JSON.parse(badCode.body).fields, ['code']);
    assert.equal((await postContent(port, 'EB-ABCDEF12', 'not json', admin)).status, 400);

    const ok = await postContent(port, 'eb-abcdef12', VALID_CONTENT, admin);
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).ok, true);
    assert.deepEqual(saved[0], { value: { code: 'EB-ABCDEF12', url: 'https://example.test/post/9', platform: 'LinkedIn', publishedAt: '2024-06-01' }, by: 'Test' });

    assert.equal((await postContent(port, 'EB-ABCDEF12', VALID_CONTENT, { Cookie: sessionCookie('program_manager') })).status, 200);
    assert.equal(saved.length, 2);
  });
});

test('content endpoint: unknown builder is 404, a failing saver is 500 without details', async () => {
  const errors = [];
  await withServer({ sessionSecret: SECRET, saveContent: async () => ({ ok: false, error: 'builder_not_found' }) }, async (port) => {
    const res = await postContent(port, 'EB-ABCDEF12', VALID_CONTENT, { Cookie: sessionCookie('admin') });
    assert.equal(res.status, 404);
    assert.equal(JSON.parse(res.body).error, 'builder_not_found');
  });
  const failing = async () => { throw new Error('connect ECONNREFUSED db.internal'); };
  await withServer({ sessionSecret: SECRET, saveContent: failing, onError: (e) => errors.push(e) }, async (port) => {
    const res = await postContent(port, 'EB-ABCDEF12', VALID_CONTENT, { Cookie: sessionCookie('admin') });
    assert.equal(res.status, 500);
    assert.equal(res.body.includes('ECONNREFUSED'), false);
    assert.equal(errors.length, 1);
    assert.equal((await request(port, '/health')).status, 200);
  });
});

test('logout clears the session cookie with a relative redirect', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const res = await request(port, '/auth/logout');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '../');
    assert.match(res.headers['set-cookie'][0], /Max-Age=0/);
  });
});

test('api/dashboard uses the injected async loader and still projects per role', async () => {
  let calls = 0;
  const loadDashboard = async () => { calls += 1; return fixtureLoader(); };
  await withServer({ sessionSecret: SECRET, loadDashboard }, async (port) => {
    const admin = await request(port, '/api/dashboard', { headers: { Cookie: sessionCookie('admin') } });
    assert.equal(admin.status, 200);
    assert.equal(JSON.parse(admin.body).builders.length, 8);
    assert.ok(JSON.parse(admin.body).builders[0].email);

    const research = await request(port, '/api/dashboard', { headers: { Cookie: sessionCookie('research') } });
    assert.equal(research.status, 200);
    assert.equal(research.body.includes('@example.test'), false);
    assert.equal(JSON.parse(research.body).builders.some((b) => 'city' in b), false);

    const executive = await request(port, '/api/dashboard', { headers: { Cookie: sessionCookie('executive') } });
    const body = JSON.parse(executive.body);
    assert.equal(body.builders, undefined);
    assert.equal(body.summary.active, 2);
    assert.equal(calls, 3);
  });
});

test('the loader is never called without a valid session', async () => {
  let calls = 0;
  await withServer({ sessionSecret: SECRET, loadDashboard: async () => { calls += 1; return {}; } }, async (port) => {
    assert.equal((await request(port, '/api/dashboard')).status, 401);
    assert.equal((await request(port, '/api/dashboard', { headers: { Cookie: sessionCookie('superuser') } })).status, 403);
    assert.equal(calls, 0);
  });
});

test('a failing loader returns the same 500 JSON, leaks no details and keeps serving', async () => {
  const errors = [];
  const options = {
    sessionSecret: SECRET,
    loadDashboard: async () => { throw Object.assign(new Error('connect ECONNREFUSED db.internal'), { code: 'ECONNREFUSED' }); },
    onError: (err) => errors.push(err),
  };
  await withServer(options, async (port) => {
    const res = await request(port, '/api/dashboard', { headers: { Cookie: sessionCookie('admin') } });
    assert.equal(res.status, 500);
    assert.equal(JSON.parse(res.body).error, 'Data unavailable');
    assert.equal(res.body.includes('ECONNREFUSED'), false);
    assert.equal(errors.length, 1);
    assert.equal((await request(port, '/health')).status, 200);
  });
});
