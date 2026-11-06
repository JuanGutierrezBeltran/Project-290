
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, hashKeyConfigured, emailHash, builderCode } = require('../lib/email-hash');

test('normalizeEmail lowercases, trims and refuses anything that is not an address', () => {
  assert.equal(normalizeEmail('  Ana.Perez@Example.COM '), 'ana.perez@example.com');
  for (const bad of ['', null, undefined, 'ana', 'ana@', '@example.com', 'a b@example.com', 'ana@example']) assert.equal(normalizeEmail(bad), '', String(bad));
});

test('emailHash is an HMAC-SHA256 of the normalized email and depends on the key', () => {
  const a = emailHash('Ana.Perez@example.com ', 'key-one');
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(emailHash('ana.perez@EXAMPLE.com', 'key-one'), a, 'same person, same hash');
  assert.notEqual(emailHash('ana.perez@example.com', 'key-two'), a, 'another key gives another hash');
  assert.equal(a.includes('ana'), false);
});

test('without a key or a valid email nothing is hashed', () => {
  assert.equal(emailHash('ana@example.com', ''), null);
  assert.equal(emailHash('ana@example.com', undefined), null);
  assert.equal(emailHash('not-an-email', 'key'), null);
  assert.equal(hashKeyConfigured({}), false);
  assert.equal(hashKeyConfigured({ EMAIL_HASH_KEY: 'k' }), true);
});

test('builderCode is a stable pseudonym from a hex id', () => {
  assert.equal(builderCode('abcdef1234567890'), 'EB-ABCDEF12');
  assert.equal(builderCode('not-hex'), '');
  assert.equal(builderCode(''), '');
});
