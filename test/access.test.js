'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const access = require('../lib/access');
const fixture = require('./fixtures/dashboard.json');

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

test('roles with the Invitations view get the landing channels, executive does not', () => {
  for (const role of ['admin', 'program_manager', 'research', 'marketing']) {
    assert.deepEqual(access.projectDashboard(clone(), role).channels[0], { channel: 'Paid social', sessions: 120, contacts: 4 });
  }
  assert.equal(access.projectDashboard(clone(), 'executive').channels, undefined);
  const data = clone();
  data.channels[0].secret = 'x';
  assert.equal('secret' in access.projectDashboard(data, 'marketing').channels[0], false);
});

test('invitation states are sent only with the Invitations view, as aggregates', () => {
  for (const role of ['admin', 'program_manager', 'research', 'marketing']) {
    const out = access.projectDashboard(clone(), role);
    assert.equal(out.invitations.available, true);
    assert.equal(out.invitations.enrolled, 3);
  }
  assert.equal(access.projectDashboard(clone(), 'executive').invitations, undefined);
  const data = clone();
  data.invitations.recipients = ['x@example.test'];
  assert.equal('recipients' in access.projectDashboard(data, 'marketing').invitations, false);
});

test('funnel steps keep their source and base; tracking flags reach every role', () => {
  const out = access.projectDashboard(clone(), 'executive');
  assert.deepEqual(out.funnel[5], { key: 'formToVerified', label: 'Formulario → cuenta verificada', value: 3, source: 'cross', base: 'formSignups', baseValue: 20, pending: false });
  assert.equal(out.tracking.creditsEvent, true);
});

test('only admin and program_manager may record published content', () => {
  assert.equal(access.canEditContent('admin'), true);
  assert.equal(access.canEditContent('program_manager'), true);
  for (const role of ['research', 'executive', 'marketing', 'root', 'constructor']) assert.equal(access.canEditContent(role), false, role);
  assert.equal(access.projectDashboard(clone(), 'admin').access.canEditContent, true);
  assert.equal(access.projectDashboard(clone(), 'research').access.canEditContent, false);
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

test('each role carries its view allowlist', () => {
  const all = ['overview', 'builders', 'invitations', 'sources'];
  for (const role of ['admin', 'program_manager', 'research']) {
    assert.deepEqual(access.projectDashboard(clone(), role).access.views, all);
  }
  assert.deepEqual(access.projectDashboard(clone(), 'executive').access.views, ['overview']);
  assert.deepEqual(access.projectDashboard(clone(), 'marketing').access.views, ['overview', 'invitations']);
});

test('canView follows the allowlist and rejects unknown roles', () => {
  assert.equal(access.canView('admin', 'sources'), true);
  assert.equal(access.canView('executive', 'builders'), false);
  assert.equal(access.canView('marketing', 'invitations'), true);
  assert.equal(access.canView('marketing', 'sources'), false);
  assert.equal(access.canView('root', 'overview'), false);
  assert.equal(access.canView('admin', 'settings'), false);
});

test('sources are only sent to roles with the sources view', () => {
  for (const role of ['admin', 'program_manager', 'research']) {
    assert.equal(access.projectDashboard(clone(), role).sources.length, 6);
  }
  for (const role of ['executive', 'marketing']) {
    const out = access.projectDashboard(clone(), role);
    assert.equal('sources' in out, false);
    assert.equal(JSON.stringify(out).includes('HubSpot'), false);
  }
});

test('the views array in the payload cannot mutate the role registry', () => {
  const out = access.projectDashboard(clone(), 'executive');
  out.access.views.push('sources');
  assert.deepEqual(access.projectDashboard(clone(), 'executive').access.views, ['overview']);
});

test('projection does not mutate the source data', () => {
  const data = clone();
  access.projectDashboard(data, 'research');
  assert.deepEqual(data, fixture);
});
