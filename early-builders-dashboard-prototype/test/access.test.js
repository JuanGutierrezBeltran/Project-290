'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const access = require('../lib/access');
const fixture = require('../data/dashboard.json');

const clone = () => JSON.parse(JSON.stringify(fixture));

test('the role registry exposes the five program roles', () => {
  assert.deepEqual(access.listRoles().map((r) => r.id).sort(), ['admin', 'executive', 'marketing', 'program_manager', 'research']);
});

test('getRole rejects unknown and prototype keys', () => {
  assert.equal(access.getRole('root'), null);
  assert.equal(access.getRole('constructor'), null);
  assert.equal(access.getRole('__proto__'), null);
  assert.equal(access.getRole(undefined), null);
  assert.throws(() => access.projectDashboard(clone(), 'root'));
});

for (const role of ['admin', 'program_manager']) {
  test(`${role} receives full builder records`, () => {
    const out = access.projectDashboard(clone(), role);
    assert.equal(out.builders.length, 8);
    assert.deepEqual(out.builders[0], fixture.builders[0]);
    assert.equal(out.access.recordAccess, 'full');
    assert.equal(out.restricted, undefined);
  });
}

test('research receives pseudonymous records without email or city', () => {
  const out = access.projectDashboard(clone(), 'research');
  assert.equal(out.builders.length, 8);
  for (const b of out.builders) {
    assert.equal('email' in b, false);
    assert.equal('city' in b, false);
    assert.ok(b.id && b.refKey);
  }
  assert.equal(JSON.stringify(out).includes('@example.test'), false);
});

for (const role of ['executive', 'marketing']) {
  test(`${role} receives aggregates only`, () => {
    const out = access.projectDashboard(clone(), role);
    assert.equal(out.builders, undefined);
    assert.equal(out.restricted, true);
    assert.equal(out.summary.active, 2);
    assert.equal(out.funnel.length, 6);
    assert.equal(out.program.signupTarget, 200);
    const json = JSON.stringify(out);
    assert.equal(json.includes('@example.test'), false);
    assert.equal(json.includes('DEMO-REF'), false);
    assert.equal(json.includes('EB-00'), false);
  });
}

test('only marketing gets the channel breakdown', () => {
  assert.equal(access.projectDashboard(clone(), 'marketing').channels[0].channel, 'LinkedIn');
  assert.equal(access.projectDashboard(clone(), 'executive').channels, undefined);
});

test('unknown fields never leak, even to admin (allowlist)', () => {
  const data = clone();
  data.builders[0].phone = '+57 300 000 0000';
  data.program.internalNote = 'secret';
  data.secretToken = 'abc';
  const json = JSON.stringify(access.projectDashboard(data, 'admin'));
  assert.equal(json.includes('+57 300'), false);
  assert.equal(json.includes('internalNote'), false);
  assert.equal(json.includes('secretToken'), false);
});

test('projection does not mutate the source data', () => {
  const data = clone();
  access.projectDashboard(data, 'research');
  assert.deepEqual(data, fixture);
});
