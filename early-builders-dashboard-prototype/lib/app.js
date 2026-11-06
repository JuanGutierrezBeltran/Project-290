'use strict';

// Request handler factory. server.js wires it to http.createServer and the
// tests mount it on an ephemeral port.
//
// Security model:
//   * Every /api/* route requires a valid signed session cookie (401 otherwise).
//   * Unknown roles get 403. No session secret configured -> 503 (fail closed).
//   * Data is projected per role on the server (lib/access.js).
//   * auth/dev-login only exists when explicitly enabled AND the request comes
//     straight from loopback (no proxy headers).
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

function send(res, status, body, contentType = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': contentType, ...BASE_HEADERS, ...extra });
  res.end(body);
}

function sendJson(res, status, payload, extra = {}) {
  send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8', extra);
}

function isDirectLoopback(req) {
  const addr = (req.socket && req.socket.remoteAddress) || '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  return loopback && !PROXY_HEADERS.some((h) => req.headers[h] !== undefined);
}

function createApp(options = {}) {
  const publicDir = path.resolve(options.publicDir || path.join(__dirname, '..', 'public'));
  const fixturePath = options.fixturePath || path.join(__dirname, '..', 'data', 'dashboard.json');
  const secret = options.sessionSecret || '';
  const ttlSeconds = Math.max(60, Math.floor(options.sessionTtlSeconds || session.DEFAULT_TTL_SECONDS));
  const devLogin = Boolean(options.devLogin) && Boolean(secret);
  const cookieName = options.cookieName || 'eb_session';
  const cookieBase = { path: options.cookiePath || '/', secure: Boolean(options.secureCookies) };
  const now = typeof options.now === 'function' ? options.now : Date.now;

  function issueSessionCookie(claims) {
    if (!secret) throw new Error('Cannot issue a session without a session secret');
    if (!claims || !access.getRole(claims.role)) throw new Error('Cannot issue a session for an unknown role');
    const token = session.createToken(
      { sub: String(claims.sub || ''), role: claims.role, name: String(claims.name || '') },
      secret,
      { ttlSeconds, now: now() },
    );
    return session.serializeCookie(cookieName, token, { ...cookieBase, maxAge: ttlSeconds });
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
      if (devLogin) Object.assign(body, { devLogin: true, roles: access.listRoles() });
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
        expiresAt: new Date(claims.exp * 1000).toISOString(),
      });
    }
    if (pathname === '/api/dashboard') {
      let data;
      try {
        data = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
      } catch {
        return sendJson(res, 500, { error: 'Demo data unavailable' });
      }
      return sendJson(res, 200, access.projectDashboard(data, claims.role));
    }
    return sendJson(res, 404, { error: 'not_found' });
  }

  function handleDevLogin(req, res, url) {
    if (!devLogin) return send(res, 404, 'Not found');
    if (!isDirectLoopback(req)) return send(res, 403, 'Dev login is only available directly on loopback');
    const roleId = url.searchParams.get('role') || '';
    const role = access.getRole(roleId);
    if (!role) return send(res, 400, 'Unknown role');
    const cookie = issueSessionCookie({ sub: `dev-${roleId}`, role: roleId, name: `Dev ${role.label}` });
    return send(res, 302, 'Signed in', undefined, { 'Set-Cookie': cookie, Location: '../' });
  }

  function handleLogout(res) {
    const cookie = session.serializeCookie(cookieName, '', { ...cookieBase, maxAge: 0 });
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
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed', undefined, { Allow: 'GET' });

    if (pathname === '/health') return sendJson(res, 200, { status: 'ok', mode: 'demo' });
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(req, res, pathname);
    if (pathname === '/auth/dev-login') return handleDevLogin(req, res, url);
    if (pathname === '/auth/logout') return handleLogout(res);
    return serveStatic(res, pathname);
  }

  handler.issueSessionCookie = issueSessionCookie;
  return handler;
}

module.exports = { createApp };
