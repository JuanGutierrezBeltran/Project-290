'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/dashboard-core.js');
const fixture = require('../data/dashboard.json');

const SNAPSHOT = fixture.snapshotAt;
const byId = (id) => fixture.builders.find((b) => b.id === id);
const ids = (list) => list.map((b) => b.id);

test('dayNumber counts whole days from credit grant (noon Bogotá) to the snapshot', () => {
  assert.equal(Core.dayNumber('2026-11-01', SNAPSHOT), 4);
  assert.equal(Core.dayNumber('2026-10-30', SNAPSHOT), 6);
  assert.equal(Core.dayNumber('2026-11-03', SNAPSHOT), 2);
  assert.equal(Core.dayNumber('2026-11-05', SNAPSHOT), 0);
});

test('dayNumber never goes negative and returns null for missing or invalid dates', () => {
  assert.equal(Core.dayNumber('2026-11-10', SNAPSHOT), 0);
  assert.equal(Core.dayNumber('', SNAPSHOT), null);
  assert.equal(Core.dayNumber(null, SNAPSHOT), null);
  assert.equal(Core.dayNumber('not-a-date', SNAPSHOT), null);
  assert.equal(Core.dayNumber('2026-11-01', ''), null);
});

test('dayProgress maps the 14-day window to 0..100', () => {
  assert.equal(Core.dayProgress(null), 0);
  assert.equal(Core.dayProgress(0), 0);
  assert.equal(Core.dayProgress(7), 50);
  assert.equal(Core.dayProgress(14), 100);
  assert.equal(Core.dayProgress(30), 100);
});

test('active = projects > 0 AND contentUrl AND contentAt', () => {
  assert.equal(Core.isActive(byId('EB-001')), true);
  assert.equal(Core.isActive(byId('EB-006')), true);
  assert.equal(Core.isActive(byId('EB-002')), false, 'project but no content');
  assert.equal(Core.isActive(byId('EB-003')), false, 'content but no project');
  assert.equal(Core.isActive({ projects: 1, contentUrl: 'https://x.test', contentAt: '' }), false);
  assert.equal(Core.isActive({ projects: 1, contentUrl: '', contentAt: '2026-11-01' }), false);
  assert.equal(Core.isActive({ projects: 0, contentUrl: 'https://x.test', contentAt: '2026-11-01' }), false);
});

test('summarizeBuilders reproduces the overview cards for the fixture', () => {
  assert.deepEqual(Core.summarizeBuilders(fixture.builders, SNAPSHOT), {
    total: 8,
    granted: 5,
    active: 2,
    within14: 5,
    missingContent: 2,
    missingProject: 1,
  });
});

test('summarizeBuilders only counts builders with a credit grant', () => {
  const s = Core.summarizeBuilders([{ projects: 1, contentUrl: 'u', contentAt: 'd', creditsGrantedAt: '' }], SNAPSHOT);
  assert.equal(s.active, 0);
  assert.equal(s.granted, 0);
});

test('followUps lists granted, not-yet-active builders in order', () => {
  assert.deepEqual(ids(Core.followUps(fixture.builders)), ['EB-002', 'EB-003', 'EB-008']);
});

test('followUps is capped at 5', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `X-${i}`, creditsGrantedAt: '2026-11-01', projects: 0, contentUrl: '', contentAt: '' }));
  const list = Core.followUps(many);
  assert.equal(Core.FOLLOW_UP_LIMIT, 5);
  assert.deepEqual(ids(list), ['X-0', 'X-1', 'X-2', 'X-3', 'X-4']);
});

test('filterBuilders searches id, refKey and email, case-insensitive and trimmed', () => {
  assert.deepEqual(ids(Core.filterBuilders(fixture.builders, { search: 'demo-ref-01' })), ['EB-001', 'EB-004']);
  assert.deepEqual(ids(Core.filterBuilders(fixture.builders, { search: '  eb-007 ' })), ['EB-007']);
  assert.deepEqual(ids(Core.filterBuilders(fixture.builders, { search: 'B***05' })), ['EB-005']);
  assert.equal(Core.filterBuilders(fixture.builders, { search: 'EB-00' }).length, 8);
  assert.equal(Core.filterBuilders(fixture.builders, { search: 'nope' }).length, 0);
});

test('filterBuilders filters by stage and combines with search', () => {
  assert.deepEqual(ids(Core.filterBuilders(fixture.builders, { stage: 'Activo' })), ['EB-001', 'EB-006']);
  assert.deepEqual(ids(Core.filterBuilders(fixture.builders, { stage: 'Invitado', search: 'ref-07' })), ['EB-007']);
  assert.equal(Core.filterBuilders(fixture.builders, { stage: 'all' }).length, 8);
  assert.equal(Core.filterBuilders(fixture.builders).length, 8);
});

test('filterBuilders works on pseudonymous records without email', () => {
  const noEmail = fixture.builders.map(({ email, ...rest }) => rest);
  assert.deepEqual(ids(Core.filterBuilders(noEmail, { search: 'demo-ref-01' })), ['EB-001', 'EB-004']);
});

test('stagesOf returns unique stages in first-seen order', () => {
  assert.deepEqual(Core.stagesOf(fixture.builders), ['Activo', 'En progreso', 'Inscrito', 'Invitado']);
});

test('funnelSteps computes share of start and step conversion', () => {
  const steps = Core.funnelSteps(fixture.funnel);
  assert.deepEqual(steps.map((s) => s.percentOfStart), [100, 75, 70, 21, 11, 4]);
  assert.deepEqual(steps.map((s) => s.conversion), [null, 75, 93, 30, 53, 33]);
});

test('funnelSteps is safe with zero values and empty input', () => {
  const steps = Core.funnelSteps([{ key: 'invited', value: 0 }, { key: 'sent', value: 0 }]);
  assert.deepEqual(steps.map((s) => s.conversion), [null, 0]);
  assert.deepEqual(steps.map((s) => s.percentOfStart), [0, 0]);
  assert.deepEqual(Core.funnelSteps(undefined), []);
});

test('signupProgress compares signed-up count to the target', () => {
  assert.deepEqual(Core.signupProgress(fixture.funnel, fixture.program.signupTarget), { total: 6, target: 200, percent: 3 });
  assert.equal(Core.signupProgress([{ key: 'signedUp', value: 500 }], 200).percent, 100);
  assert.equal(Core.signupProgress([], 200).total, 0);
  assert.equal(Core.signupProgress([{ key: 'signedUp', value: 5 }], 0).percent, 0);
});

test('channelBreakdown aggregates by channel', () => {
  const channels = Core.channelBreakdown(fixture.builders);
  assert.deepEqual(channels[0], { channel: 'LinkedIn', total: 3, signedUp: 3, active: 1 });
  assert.deepEqual(channels[1], { channel: 'Referido', total: 2, signedUp: 2, active: 1 });
  assert.equal(channels.reduce((n, c) => n + c.total, 0), 8);
});
