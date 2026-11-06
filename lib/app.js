'use strict';

// Request handler factory. server.js wires it to http.createServer and the
// tests mount it on an ephemeral port.
//
// Security model:
//   * Every /api/* route requires a valid signed session cookie (401 otherwise).
//   * Unknown roles get 403. No session secret configured -> 503 (fail closed).
//   * Data is projected per role on the server (lib/access.js).
//   * Dashboard data comes from the injected async loader (options.loadDashboard,
//     MySQL via lib/dashboard-repo.js). There is no file or sample fallback:
//     without a loader, or when it fails, api/dashboard answers the same 500 JSON
//     and the cause is reported through options.onError, never to the client.
//   * POST api/builders/:code/content records a builder's published content. It needs a
//     session whose role has editContent (lib/access.js), refuses cross-site requests, caps
//     the JSON body at 2 KB, validates code, URL and date (lib/dashboard-repo.js) and calls
//     options.saveContent. Without a saver it answers 500 without details.
//   * auth/dev-login only exists when explicitly enabled AND the request comes
//     straight from loopback (no proxy headers).
//   * auth/password-login (POST, the only non-GET route) only exists when an
//     access password is configured (ACCESS_PASSWORD). It refuses cross-site
//     requests, checks the shared password timing-safely, rate-limits failed
//     attempts per client and then issues the SAME signed session as any other
//     login, so the per-role projection is unchanged.
//   * trustProxy (TRUST_PROXY=1) is opt-in. When on, the client address is the
//     RIGHTMOST X-Forwarded-For entry (the one the trusted proxy appended), and
//     X-Forwarded-Proto=https adds Secure to cookies. Dev login still requires
//     that client to be loopback, so it never opens up through a public proxy.
//
// OIDC INTEGRATION POINT (go-live): implement the Think4Ever SSO callback as a
// route here (e.g. auth/callback). After validating the ID token (issuer,
// audience, nonce, signature) map the user's groups to one of the role ids in
// lib/access.js and call handler.issueSessionCookie({ sub, role, name }), then
// redirect with a RELATIVE Location. The access rules do not need to change.

const fs = require('node:fs');
const path = require('node:path');
const session = require('./session');
const access = require('./access');
const passwordAuth = require('./password-auth');
const { validateContent } = require('./dashboard-repo');

const CONTENT_ROUTE = /^\/api\/builders\/([^/]+)\/content$/;

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip'];
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function send(res, status, body, contentType = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': contentType, ...BASE_HEADERS, ...extra });
  res.end(body);
}

function sendJson(res, status, payload, extra = {}) {
  send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8', extra);
}

function socketAddress(req) {
  return (req.socket && req.socket.remoteAddress) || '';
}

function hasProxyHeaders(req) {
  return PROXY_HEADERS.some((h) => req.headers[h] !== undefined);
}

function isDirectLoopback(req) {
  return LOOPBACK.has(socketAddress(req)) && !hasProxyHeaders(req);
}

// Rightmost X-Forwarded-For entry: appended by the trusted proxy itself, so a
// client cannot spoof it by sending its own X-Forwarded-For header.
function forwardedClient(req) {
  const raw = req.headers['x-forwarded-for'];
  if (typeof raw !== 'string') return '';
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function isLoopbackClient(req, trustProxy) {
  if (!trustProxy) return isDirectLoopback(req);
  const forwarded = forwardedClient(req);
  if (forwarded) return LOOPBACK.has(forwarded);
  return isDirectLoopback(req);
}

function isForwardedHttps(req) {
  const raw = req.headers['x-forwarded-proto'];
  if (typeof raw !== 'string') return false;
  return raw.split(',')[0].trim().toLowerCase() === 'https';
}

// Rate-limit key. Without trustProxy every visitor behind a proxy shares the
// proxy's address (one bucket); with it, the proxy-appended address is used.
function clientKey(req, trustProxy) {
  if (trustProxy) return forwardedClient(req) || socketAddress(req);
  return socketAddress(req);
}

function createApp(options = {}) {
  const publicDir = path.resolve(options.publicDir || path.join(__dirname, '..', 'public'));
  const loadDashboard = typeof options.loadDashboard === 'function' ? options.loadDashboard : null;
  const saveContent = typeof options.saveContent === 'function' ? options.saveContent : null;
  const onError = typeof options.onError === 'function' ? options.onError : () => {};
  const secret = options.sessionSecret || '';
  const ttlSeconds = Math.max(60, Math.floor(options.sessionTtlSeconds || session.DEFAULT_TTL_SECONDS));
  const devLogin = Boolean(options.devLogin) && Boolean(secret);
  const cookieName = options.cookieName || 'eb_session';
  const cookieBase = { path: options.cookiePath || '/', secure: Boolean(options.secureCookies) };
  const trustProxy = Boolean(options.trustProxy);
  const now = typeof options.now === 'function' ? options.now : Date.now;

  // Password login needs both a password and a secret to sign sessions with.
  const pw = options.accessPassword && secret
    ? {
      checkPassword: passwordAuth.createPasswordChecker(options.accessPassword),
      limiter: passwordAuth.createRateLimiter({ ...(options.passwordRateLimit || {}), now }),
    }
    : null;

  function cookieOptions(req) {
    const secure = cookieBase.secure || (trustProxy && Boolean(req) && isForwardedHttps(req));
    return { ...cookieBase, secure };
  }

  function issueSessionCookie(claims, req) {
    if (!secret) throw new Error('Cannot issue a session without a session secret');
    if (!claims || !access.getRole(claims.role)) throw new Error('Cannot issue a session for an unknown role');
    const token = session.createToken(
      { sub: String(claims.sub || ''), role: claims.role, name: String(claims.name || '') },
      secret,
      { ttlSeconds, now: now() },
    );
    return session.serializeCookie(cookieName, token, { ...cookieOptions(req), maxAge: ttlSeconds });
  }

  function readSession(req) {
    const token = session.parseCookies(req.headers.cookie)[cookieName];
    if (!token) return null;
    return session.verifyToken(token, secret, now());
  }

  function handleApi(req, res, pathname) {
    if (!secret) return sendJson(res, 503, { error: 'auth_not_configured' });

    const claims = readSession(req);
    if (!claims) {
      const body = { error: 'authentication_required' };
      if (devLogin) body.devLogin = true;
      if (pw) body.passwordLogin = true;
      if (devLogin || pw) body.roles = access.listRoles();
      return sendJson(res, 401, body);
    }
    const role = access.getRole(claims.role);
    if (!role) return sendJson(res, 403, { error: 'forbidden' });

    if (pathname === '/api/session') {
      return sendJson(res, 200, {
        sub: claims.sub,
        name: claims.name,
        role: claims.role,
        label: role.label,
        recordAccess: role.recordAccess,
        canEditContent: access.canEditContent(claims.role),
        expiresAt: new Date(claims.exp * 1000).toISOString(),
      });
    }
    if (pathname === '/api/dashboard') {
      const fail = (err) => {
        try { onError(err); } catch { /* logging must never break the response */ }
        if (!res.headersSent) sendJson(res, 500, { error: 'Data unavailable' });
      };
      if (!loadDashboard) {
        fail(new Error('No dashboard data loader is configured'));
        return undefined;
      }
      Promise.resolve()
        .then(() => loadDashboard())
        .then((loaded) => access.projectDashboard(loaded, claims.role))
        .then((payload) => sendJson(res, 200, payload), fail);
      return undefined;
    }
    return sendJson(res, 404, { error: 'not_found' });
  }

  async function handleContent(req, res, rawCode) {
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', undefined, { Allow: 'POST' });
    if (!secret) return sendJson(res, 503, { error: 'auth_not_configured' });
    const claims = readSession(req);
    if (!claims) return sendJson(res, 401, { error: 'authentication_required' });
    if (!access.getRole(claims.role) || !access.canEditContent(claims.role)) return sendJson(res, 403, { error: 'forbidden' });
    if (!passwordAuth.isSameOrigin(req, { trustProxy })) return sendJson(res, 403, { error: 'cross_site_request' });

    let raw;
    try {
      raw = await passwordAuth.readBody(req);
    } catch (err) {
      return sendJson(res, err.status || 400, { error: err.code || 'bad_request' }, { Connection: 'close' });
    }
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return sendJson(res, 400, { error: 'bad_request' });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { error: 'bad_request' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { error: 'bad_request' });

    let code;
    try {
      code = decodeURIComponent(rawCode);
    } catch {
      return sendJson(res, 400, { error: 'invalid_content', fields: ['code'] });
    }
    const check = validateContent(code, body);
    if (!check.ok) return sendJson(res, 400, { error: 'invalid_content', fields: check.errors });

    const fail = (err) => {
      try { onError(err); } catch { /* logging must never break the response */ }
      if (!res.headersSent) sendJson(res, 500, { error: 'Data unavailable' });
    };
    if (!saveContent) return fail(new Error('No content saver is configured'));
    let result;
    try {
      result = await saveContent(check.value, claims.name || claims.sub);
    } catch (err) {
      return fail(err);
    }
    if (!result || !result.ok) return sendJson(res, 404, { error: (result && result.error) || 'builder_not_found' });
    return sendJson(res, 200, { ok: true, content: result.content });
  }

  function handleDevLogin(req, res, url) {
    if (!devLogin) return send(res, 404, 'Not found');
    if (!isLoopbackClient(req, trustProxy)) return send(res, 403, 'Dev login is only available directly on loopback');
    const roleId = url.searchParams.get('role') || '';
    const role = access.getRole(roleId);
    if (!role) return send(res, 400, 'Unknown role');
    const cookie = issueSessionCookie({ sub: `dev-${roleId}`, role: roleId, name: `Dev ${role.label}` }, req);
    return send(res, 302, 'Signed in', undefined, { 'Set-Cookie': cookie, Location: '../' });
  }

  async function handlePasswordLogin(req, res) {
    if (!pw) return send(res, 404, 'Not found');
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', undefined, { Allow: 'POST' });
    if (!passwordAuth.isSameOrigin(req, { trustProxy })) return sendJson(res, 403, { error: 'cross_site_request' });

    const client = clientKey(req, trustProxy);
    const gate = pw.limiter.check(client);
    if (!gate.allowed) {
      return sendJson(res, 429, { error: 'too_many_attempts', retryAfter: gate.retryAfterSeconds }, { 'Retry-After': String(gate.retryAfterSeconds) });
    }

    let raw;
    try {
      raw = await passwordAuth.readBody(req);
    } catch (err) {
      return sendJson(res, err.status || 400, { error: err.code || 'bad_request' }, { Connection: 'close' });
    }
    const form = passwordAuth.parseLoginBody(raw, req.headers['content-type']);
    if (!form) return sendJson(res, 400, { error: 'bad_request' });

    if (!pw.checkPassword(form.password)) {
      pw.limiter.fail(client);
      return sendJson(res, 401, { error: 'invalid_password' });
    }
    const role = access.getRole(form.role);
    if (!role) return sendJson(res, 400, { error: 'unknown_role' });

    pw.limiter.reset(client);
    const cookie = issueSessionCookie({ sub: `access-${form.role}`, role: form.role, name: role.label }, req);
    res.writeHead(204, { ...BASE_HEADERS, 'Set-Cookie': cookie });
    return res.end();
  }

  function handleLogout(req, res) {
    const cookie = session.serializeCookie(cookieName, '', { ...cookieOptions(req), maxAge: 0 });
    return send(res, 302, 'Signed out', undefined, { 'Set-Cookie': cookie, Location: '../' });
  }

  function serveStatic(res, pathname) {
    let relative;
    try {
      relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    } catch {
      return send(res, 400, 'Bad request');
    }
    if (relative.includes('\0')) return send(res, 400, 'Bad request');
    relative = path.normalize(relative).replace(/^([/\\]|\.\.(?:[/\\]|$))+/, '');
    const file = path.resolve(publicDir, relative);
    if (!file.startsWith(publicDir + path.sep)) return send(res, 403, 'Forbidden');

    fs.readFile(file, (err, contents) => {
      if (err) return send(res, 404, 'Not found');
      send(res, 200, contents, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  }

  function handler(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      return send(res, 400, 'Bad request');
    }
    const pathname = url.pathname;

    if (pathname === '/auth/password-login') {
      handlePasswordLogin(req, res).catch(() => {
        if (!res.headersSent) send(res, 500, 'Internal error');
        else res.destroy();
      });
      return undefined;
    }
    const contentMatch = CONTENT_ROUTE.exec(pathname);
    if (contentMatch) {
      handleContent(req, res, contentMatch[1]).catch(() => {
        if (!res.headersSent) send(res, 500, 'Internal error');
        else res.destroy();
      });
      return undefined;
    }
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed', undefined, { Allow: 'GET' });

    if (pathname === '/health') return sendJson(res, 200, { status: 'ok', mode: 'live' });
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(req, res, pathname);
    if (pathname === '/auth/dev-login') return handleDevLogin(req, res, url);
    if (pathname === '/auth/logout') return handleLogout(req, res);
    return serveStatic(res, pathname);
  }

  handler.issueSessionCookie = issueSessionCookie;
  return handler;
}

module.exports = { createApp };
