'use strict';

// HMAC of a normalized email, used to match the same person across HubSpot and PostHog
// without storing any address. The key lives only in the service variable EMAIL_HASH_KEY.
// Without the key nothing is hashed (null), so the cross-source match stays "pending".

const crypto = require('crypto');

const EMAIL_RE = /^[^\s@<>"',;:()[\]]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

function normalizeEmail(value) {
  const s = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  return s.length <= 254 && EMAIL_RE.test(s) ? s : '';
}

function hashKeyConfigured(env = process.env) {
  return Boolean(env && env.EMAIL_HASH_KEY);
}

function emailHash(value, key = process.env.EMAIL_HASH_KEY) {
  if (!key) return null;
  const email = normalizeEmail(value);
  if (!email) return null;
  return crypto.createHmac('sha256', String(key)).update(email).digest('hex');
}

// Stable pseudonymous builder code from a hex id (a hash of the PostHog person id, never the email).
function builderCode(id) {
  const hex = String(id || '').toLowerCase();
  return /^[a-f0-9]{8,}$/.test(hex) ? `EB-${hex.slice(0, 8).toUpperCase()}` : '';
}

module.exports = { normalizeEmail, hashKeyConfigured, emailHash, builderCode };
