'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createApp } = require('../lib/app');
const { createToken } = require('../lib/session');

const SECRET = 'integration-test-secret-0123456789abcdef';

async function withServer(options, fn) {
  const server = http.createServer(createApp(options));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function request(port, urlPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function sessionCookie(role, { secret = SECRET, ttlSeconds = 3600, now = Date.now() } = {}) {
  return `eb_session=${createToken({ sub: `test-${role}`, role, name: 'Test' }, secret, { ttlSeconds, now })}`;
}

test('GET /health responds 200 JSON', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const res = await request(port, '/health');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(JSON.parse(res.body).status, 'ok');
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

test('missing fixture returns 500 JSON', async () => {
  await withServer({ sessionSecret: SECRET, fixturePath: path.join(__dirname, 'does-not-exist.json') }, async (port) => {
    const res = await request(port, '/api/dashboard', { headers: { Cookie: sessionCookie('admin') } });
    assert.equal(res.status, 500);
    assert.equal(JSON.parse(res.body).error, 'Demo data unavailable');
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

test('path traversal never serves the fixture', async () => {
  const attempts = [
    '/../data/dashboard.json',
    '/%2e%2e/data/dashboard.json',
    '/%2E%2E/data/dashboard.json',
    '/..%2fdata%2fdashboard.json',
    '/%2e%2e%2fdata%2fdashboard.json',
    '/..%5cdata%5cdashboard.json',
    '/%2e%2e%5c%2e%2e%5cserver.js',
    '/public/../../data/dashboard.json',
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

test('static shell and shared core module are served', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const index = await request(port, '/');
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /text\/html/);
    assert.ok(index.body.includes('dashboard-core.js'));
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

test('logout clears the session cookie with a relative redirect', async () => {
  await withServer({ sessionSecret: SECRET }, async (port) => {
    const res = await request(port, '/auth/logout');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '../');
    assert.match(res.headers['set-cookie'][0], /Max-Age=0/);
  });
});
