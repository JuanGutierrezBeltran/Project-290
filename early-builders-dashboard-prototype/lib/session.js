
'use strict';

// Dependency-free signed session tokens (HMAC-SHA256) and cookie helpers.
// Token format: base64url(JSON payload) + "." + base64url(HMAC(payload)).
// The payload always carries iat/exp (seconds); verification is timing-safe.

const crypto = require('node:crypto');

const DEFAULT_TTL_SECONDS = 8 * 3600;

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createToken(claims, secret, { ttlSeconds = DEFAULT_TTL_SECONDS, now = Date.now() } = {}) {
  if (!secret) throw new Error('Session secret is required to issue a session');
  const iat = Math.floor(now / 1000);
  const payload = { ...claims, iat, exp: iat + Math.max(1, Math.floor(ttlSeconds)) };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

function verifyToken(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const expected = Buffer.from(sign(parts[0], secret));
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || typeof payload.exp !== 'number') return null;
  if (payload.exp <= Math.floor(now / 1000)) return null;
  return payload;
}

function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    if (!name || Object.prototype.hasOwnProperty.call(out, name)) continue;
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

function serializeCookie(name, value, { maxAge, path = '/', secure = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (typeof maxAge === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  parts.push('HttpOnly', 'SameSite=Strict');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

module.exports = { DEFAULT_TTL_SECONDS, createToken, verifyToken, parseCookies, serializeCookie };
