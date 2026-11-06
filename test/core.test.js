'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/dashboard-core.js');
const fixture = require('./fixtures/dashboard.json');

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

test('funnelSteps only converts within one source or across the person-level match', () => {
  const steps = Core.funnelSteps(fixture.funnel);
  assert.deepEqual(steps.map((s) => s.conversion), [null, 25, null, 40, 50, 15]);
  assert.deepEqual(steps.map((s) => s.reason), [null, null, 'not_crossed', null, null, null]);
  assert.deepEqual(steps.map((s) => s.percentOfStart), [100, 25, null, null, null, null]);
  assert.deepEqual(steps.map((s) => s.percentOfSource), [100, 25, 100, 40, 20, 15]);
  assert.equal(steps[5].baseValue, 20, 'the cross compares with the hashed form submissions');
});

test('a pending cross has no conversion and no overall rate (never estimated)', () => {
  const funnel = fixture.funnel.map((s) => (s.key === 'formToVerified' ? { ...s, value: 0, pending: true } : s));
  const cross = Core.funnelSteps(funnel)[5];
  assert.equal(cross.conversion, null);
  assert.equal(cross.reason, 'pending');
  assert.equal(Core.funnelInsights(funnel).overall, null);
});

test('funnelSteps never yields a conversion above the comparable base across sources', () => {
  const funnel = [
    { key: 'sessions', source: 'hubspot', base: null, value: 2454 },
    { key: 'formSignups', source: 'hubspot', base: 'sessions', value: 17 },
    { key: 'registrationStarted', source: 'posthog', base: null, value: 51 },
  ];
  const steps = Core.funnelSteps(funnel);
  assert.equal(steps[2].conversion, null, 'no 300% from dividing PostHog by HubSpot');
  assert.equal(steps[2].reason, 'not_crossed');
});

test('funnelSteps keeps previous-step conversion for funnels without a base', () => {
  const legacy = [{ key: 'a', value: 160 }, { key: 'b', value: 120 }, { key: 'c', value: 112 }];
  const steps = Core.funnelSteps(legacy);
  assert.deepEqual(steps.map((s) => s.percentOfStart), [100, 75, 70]);
  assert.deepEqual(steps.map((s) => s.conversion), [null, 75, 93]);
});

test('funnelSteps is safe with zero values and empty input', () => {
  const steps = Core.funnelSteps([{ key: 'invited', value: 0 }, { key: 'sent', value: 0 }]);
  assert.deepEqual(steps.map((s) => s.conversion), [null, 0]);
  assert.deepEqual(steps.map((s) => s.percentOfStart), [0, 0]);
  assert.deepEqual(Core.funnelSteps(undefined), []);
});

test('signupProgress compares verified accounts to the target', () => {
  assert.deepEqual(Core.signupProgress(fixture.funnel, fixture.program.signupTarget), { total: 6, target: 200, percent: 3 });
  assert.equal(Core.signupProgress([{ key: 'accountVerified', value: 500 }], 200).percent, 100);
  assert.equal(Core.signupProgress([{ key: 'registrationStarted', value: 51 }], 200).total, 0, 'registrations do not count');
  assert.equal(Core.signupProgress([], 200).total, 0);
  assert.equal(Core.signupProgress([{ key: 'accountVerified', value: 5 }], 0).percent, 0);
});

test('channelBreakdown aggregates by channel', () => {
  const channels = Core.channelBreakdown(fixture.builders);
  assert.deepEqual(channels[0], { channel: 'LinkedIn', total: 3, signedUp: 3, active: 1 });
  assert.deepEqual(channels[1], { channel: 'Referido', total: 2, signedUp: 2, active: 1 });
  assert.equal(channels.reduce((n, c) => n + c.total, 0), 8);
});

test('sourceState normalises Spanish and English states and never guesses', () => {
  assert.equal(Core.sourceState('Pendiente'), 'pending');
  assert.equal(Core.sourceState('Manual'), 'manual');
  assert.equal(Core.sourceState('Conectado'), 'connected');
  assert.equal(Core.sourceState('Error'), 'error');
  assert.equal(Core.sourceState('connected'), 'connected');
  assert.equal(Core.sourceState('  PENDING '), 'pending');
  assert.equal(Core.sourceState(''), 'unknown');
  assert.equal(Core.sourceState(null), 'unknown');
  assert.equal(Core.sourceState('weird'), 'unknown');
  assert.equal(Core.sourceState('constructor'), 'unknown');
  assert.deepEqual(fixture.sources.map((s) => Core.sourceState(s.state)), ['pending', 'pending', 'manual', 'manual', 'manual', 'pending']);
});

test('funnelInsights uses the person-level cross as overall and ignores non-comparable steps', () => {
  const out = Core.funnelInsights(fixture.funnel);
  assert.equal(out.overall, 15);
  assert.equal(out.overallKey, 'formToVerified');
  assert.deepEqual(out.largestDrop, { from: 'sessions', to: 'formSignups', conversion: 25 });
});

test('funnelInsights is safe with empty input and a zero base', () => {
  assert.deepEqual(Core.funnelInsights([]), { overall: null, overallKey: null, largestDrop: null });
  assert.deepEqual(Core.funnelInsights(undefined), { overall: null, overallKey: null, largestDrop: null });
  const zero = Core.funnelInsights([{ key: 'invited', value: 0 }, { key: 'sent', value: 0 }]);
  assert.equal(zero.overall, null);
  assert.deepEqual(zero.largestDrop, { from: 'invited', to: 'sent', conversion: 0 });
  assert.equal(Core.funnelInsights([{ key: 'invited', value: 10 }]).largestDrop, null);
});

test('csvCell quotes special characters and blocks formula injection', () => {
  assert.equal(Core.csvCell(null), '');
  assert.equal(Core.csvCell(undefined), '');
  assert.equal(Core.csvCell('EB-001'), 'EB-001');
  assert.equal(Core.csvCell(2000), '2000');
  assert.equal(Core.csvCell(-5), '-5');
  assert.equal(Core.csvCell('a,b'), '"a,b"');
  assert.equal(Core.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(Core.csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(Core.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(Core.csvCell('+57 300'), "'+57 300");
  assert.equal(Core.csvCell('-cmd'), "'-cmd");
  assert.equal(Core.csvCell('@x'), "'@x");
  assert.equal(Core.csvCell('=1,2'), `"'=1,2"`);
});
