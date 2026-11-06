
'use strict';

// Shared-password login helpers (zero dependencies).
//
//   * createPasswordChecker: timing-safe comparison. Both sides are hashed
//     with SHA-256 first, so the comparison always runs on equal-length
//     buffers and does not leak the password length.
//   * createRateLimiter: in-memory fixed window of failed attempts per client
//     key (default 10 failures per 15 minutes). Bounded number of tracked
//     clients so it cannot grow without limit.
//   * readBody / parseLoginBody: tiny request body reader with a hard byte cap
//     (default 2 KB) that accepts JSON or urlencoded forms only.
//   * isSameOrigin: refuses cross-site requests (Sec-Fetch-Site first, then an
//     Origin vs Host comparison).
//
// The password login only decides WHICH role a visitor gets. The session it
// issues is the same signed cookie as any other login, so the per-role data
// projection in lib/access.js stays the only source of truth.

const crypto = require('node:crypto');

const MIN_PASSWORD_LENGTH = 12;
const DEFAULT_MAX_FAILURES = 10;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_CLIENTS = 10000;
const MAX_BODY_BYTES = 2048;

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest();
}

function createPasswordChecker(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The access password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }
  const expected = digest(password);
  return function checkPassword(candidate) {
    const actual = digest(typeof candidate === 'string' ? candidate : '');
    const match = crypto.timingSafeEqual(actual, expected);
    return match && typeof candidate === 'string';
  };
}

function createRateLimiter(options = {}) {
  const maxFailures = Math.max(1, Math.floor(options.maxFailures || DEFAULT_MAX_FAILURES));
  const windowMs = Math.max(1000, Math.floor(options.windowMs || DEFAULT_WINDOW_MS));
  const maxClients = Math.max(1, Math.floor(options.maxClients || DEFAULT_MAX_CLIENTS));
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const entries = new Map();

  function current(key, time) {
    const entry = entries.get(key);
    if (!entry) return null;
    if (time - entry.start >= windowMs) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  function makeRoom(time) {
    for (const [key, entry] of entries) {
      if (time - entry.start >= windowMs) entries.delete(key);
    }
    while (entries.size >= maxClients) entries.delete(entries.keys().next().value);
  }

  return {
    check(key) {
      const time = now();
      const entry = current(String(key), time);
      if (entry && entry.count >= maxFailures) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.start + windowMs - time) / 1000)) };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
    fail(key) {
      const time = now();
      const id = String(key);
      let entry = current(id, time);
      if (!entry) {
        if (entries.size >= maxClients) makeRoom(time);
        entry = { start: time, count: 0 };
        entries.set(id, entry);
      }
      entry.count += 1;
      return entry.count;
    },
    reset(key) {
      entries.delete(String(key));
    },
    size() {
      return entries.size;
    },
  };
}

function bodyError(status, code) {
  const err = new Error(code);
  err.status = status;
  err.code = code;
  return err;
}

function readBody(req, { limit = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks = [];
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const declared = Number(req.headers && req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      finish(reject, bodyError(413, 'payload_too_large'));
    }

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        finish(reject, bodyError(413, 'payload_too_large'));
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => finish(resolve, Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(reject, bodyError(400, 'bad_request')));
  });
}

function parseLoginBody(raw, contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const text = typeof raw === 'string' ? raw : '';
  if (type === 'application/json') {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return {
      password: typeof parsed.password === 'string' ? parsed.password : '',
      role: typeof parsed.role === 'string' ? parsed.role : '',
    };
  }
  if (type === 'application/x-www-form-urlencoded') {
    const params = new URLSearchParams(text);
    return { password: params.get('password') || '', role: params.get('role') || '' };
  }
  return null;
}

// Browsers always send Sec-Fetch-Site on fetch(), and it reflects what the
// user actually sees, so it keeps working when a proxy rewrites Host. Older
// browsers fall back to Origin vs Host. Requests with neither header come
// from non-browser clients, which carry no ambient cookies to abuse.
function isSameOrigin(req, { trustProxy = false } = {}) {
  const headers = req.headers || {};
  const site = headers['sec-fetch-site'];
  if (typeof site === 'string') return site.trim().toLowerCase() === 'same-origin';

  const origin = headers.origin;
  if (origin === undefined) return true;
  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  if (!originHost) return false;

  const allowed = [];
  if (typeof headers.host === 'string') allowed.push(headers.host.trim().toLowerCase());
  if (trustProxy && typeof headers['x-forwarded-host'] === 'string') {
    allowed.push(headers['x-forwarded-host'].split(',')[0].trim().toLowerCase());
  }
  return allowed.includes(originHost);
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  DEFAULT_MAX_FAILURES,
  DEFAULT_WINDOW_MS,
  MAX_BODY_BYTES,
  createPasswordChecker,
  createRateLimiter,
  readBody,
  parseLoginBody,
  isSameOrigin,
};
