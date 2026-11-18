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
    withProject: 4,
    recentActive: 0,
    recentAccounts: 0,
    recentPercent: null,
  });
});

test('summarizeBuilders only counts builders with a credit grant', () => {
  const s = Core.summarizeBuilders([{ projects: 1, contentUrl: 'u', contentAt: 'd', creditsGrantedAt: '' }], SNAPSHOT);
  assert.equal(s.active, 0);
  assert.equal(s.granted, 0);
});

test('activityWindow is the 14 Bogotá dates ending on the snapshot', () => {
  const days = Core.activityWindow(SNAPSHOT);
  assert.equal(days.length, 14);
  assert.equal(days[0], '2026-10-23');
  assert.equal(days[13], '2026-11-05');
  assert.deepEqual(Core.activityWindow('not-a-date'), []);
});

test('workedDays marks recorded days and never spreads a sign-in count', () => {
  const days = Core.activityWindow(SNAPSHOT);
  const marked = Core.workedDays({ activeDays: ['2026-11-05', '2026-10-01', 'nope'], signIns: 9, lastSignIn: '2026-11-04' }, days);
  assert.deepEqual(marked.filter((d) => d.on).map((d) => d.date), ['2026-11-05']);
  const fallback = Core.workedDays({ lastSignIn: '2026-11-04', signIns: 6 }, days);
  assert.deepEqual(fallback.filter((d) => d.on).map((d) => d.date), ['2026-11-04']);
  const none = Core.workedDays({ activeDays: [], lastSignIn: '2026-11-04', signIns: 6 }, days);
  assert.equal(none.some((d) => d.on), false);
});

test('recentActivity is the share of verified accounts that used credits in the last 7 days', () => {
  const recent = Core.recentActivity([
    { verifiedAt: '2026-11-01', activeDays: ['2026-11-05'], lastCreditUsedAt: '2026-11-05' },
    { verifiedAt: '2026-10-01', activeDays: ['2026-10-02'], lastCreditUsedAt: '2026-10-02' },
    { verifiedAt: '', activeDays: ['2026-11-05'] },
  ], SNAPSHOT, 7);
  assert.equal(recent.recentAccounts, 2);
  assert.equal(recent.recentActive, 1);
  assert.equal(recent.recentPercent, 50);
  assert.equal(Core.recentActivity(fixture.builders, SNAPSHOT, 7).recentAccounts, 0, 'a sign-up date is not a verified timestamp');
  assert.equal(Core.recentActivity([], 'not-a-date').recentPercent, null);
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

test('filterBuilders filters by plan as well as stage', () => {
  const rows = [
    { id: 'u-1', plan: 'free', channel: 'Paid media (Gmail Ads)', channelKey: 'paid_media' },
    { id: 'u-2', plan: 'premium', channel: 'WhatsApp', channelKey: 'whatsapp' },
  ];
  assert.deepEqual(ids(Core.filterBuilders(rows, { plan: 'premium' })), ['u-2']);
  assert.deepEqual(ids(Core.filterBuilders(rows, { search: 'gmail' })), ['u-1']);
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

test('referralSteps converts only along the invitee list and stays pending without the source', () => {
  const live = Core.funnelSteps(Core.referralSteps(fixture.invitations));
  assert.deepEqual(live.map((s) => s.key), ['emailsSent', 'delivered', 'opened', 'inviteSignedUp']);
  assert.deepEqual(live.map((s) => s.conversion), [null, 90, 50, 33]);
  assert.deepEqual(live.map((s) => s.reason), [null, null, null, null]);
  const pending = Core.funnelSteps(Core.referralSteps({ available: false, sent: 20, enrolled: 3 }));
  assert.equal(pending[0].value, 0);
  assert.equal(pending[3].reason, 'pending');
  assert.equal(pending[3].conversion, null);
});

test('productSteps stays inside Developer Network members', () => {
  const funnel = [
    { key: 'dnSignedUp', source: 'hubspot', base: null, value: 36 },
    { key: 'accountCreated', source: 'hubspot', base: 'dnSignedUp', value: 26 },
    { key: 'accountVerified', source: 'hubspot', base: 'accountCreated', value: 19 },
    { key: 'creditsUsed', source: 'hubspot', base: 'accountVerified', value: 8 },
  ];
  const steps = Core.funnelSteps(Core.productSteps(funnel));
  assert.deepEqual(steps.map((s) => [s.key, s.value, s.conversion]), [
    ['dnSignedUp', 36, null],
    ['accountCreated', 26, 72],
    ['accountVerified', 19, 73],
    ['creditsUsed', 8, 42],
  ]);
  const acquire = Core.funnelSteps(Core.acquisitionSteps(fixture.funnel));
  assert.deepEqual(acquire.map((s) => [s.key, s.conversion]), [['sessions', null], ['formSignups', 25]]);
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

test('signupProgress compares Developer Network members to the target', () => {
  assert.deepEqual(Core.signupProgress([{ key: 'dnSignedUp', value: 36 }, { key: 'accountVerified', value: 19 }], 200), { total: 36, target: 200, percent: 18 });
  assert.equal(Core.signupProgress([{ key: 'dnSignedUp', value: 500 }], 200).percent, 100);
  assert.equal(Core.signupProgress([{ key: 'accountVerified', value: 19 }], 200).total, 0, 'verified accounts are not the close target');
  assert.equal(Core.signupProgress([], 200).total, 0);
  assert.equal(Core.signupProgress([{ key: 'dnSignedUp', value: 5 }], 0).percent, 0);
});

test('member dates use Colombia time and credits granted is used plus remaining', () => {
  assert.equal(Core.bogotaDay('2026-11-13T04:30:00Z'), '2026-11-12');
  assert.equal(Core.bogotaDay('2026-11-13T05:00:00Z'), '2026-11-13');
  assert.equal(Core.bogotaDay(''), '');
  assert.equal(Core.creditsGranted(1600, -100), 1500);
  assert.equal(Core.creditsGranted(null, null), null);
  assert.equal(Core.planTier('think-free', 'Think Free', 'none'), 'free');
  assert.equal(Core.planTier('think-plus', 'Think Plus', 'active'), 'premium');
  assert.equal(Core.planTier('', '', 'active'), '');
  const member = Core.shapeMember({
    id: '501', domain: 'example.com',
    attributes: {
      user_id: 'u-9', plan: 'think-free', plan_name: 'Think Free', subscription_status: 'none',
      signup_at: '2026-11-13T06:00:00Z', verified_at: '2026-11-13T18:00:00Z',
      dn_origin: 'paid_media', dn_channel: 'paid_media', dn_signup_at: '2026-11-13T04:30:00Z',
      credits_used: '40', credits_remaining: '1460', last_credit_used_at: '2026-11-14T03:00:00Z',
      dn_credits_loaded: 'false',
    },
    projects: null,
  });
  assert.equal(member.id, 'u-9');
  assert.equal(member.plan, 'free');
  assert.equal(member.signedUpAt, '2026-11-13');
  assert.equal(member.verifiedAt, '2026-11-13');
  assert.equal(member.dnSignupAt, '2026-11-12');
  assert.equal(member.lastCreditUsedAt, '2026-11-13');
  assert.equal(member.credits, 1500);
  assert.equal(member.creditsPending, true);
  assert.equal(member.projects, null);
  assert.equal(member.channel, 'Paid media (Gmail Ads)');
  assert.equal(member.origin, 'paid_media');
  const days = Core.signupDays([
    { dnSignupAt: '2026-11-12' }, { dnSignupAt: '2026-11-12' }, { dnSignupAt: '2026-11-14' },
  ], '2026-11-15T18:00:00-05:00');
  assert.deepEqual(days, [
    { date: '2026-11-12', count: 2 }, { date: '2026-11-13', count: 0 }, { date: '2026-11-14', count: 1 }, { date: '2026-11-15', count: 0 },
  ]);
  assert.deepEqual(Core.signupChannels([
    { channelKey: 'paid_media' }, { channelKey: 'paid_media' }, { channelKey: 'direct' }, { channelKey: '' },
  ]), [
    { key: 'paid_media', label: 'Paid media (Gmail Ads)', count: 2 },
    { key: 'direct', label: 'Direct / no UTM', count: 1 },
  ]);
  const cards = Core.memberCards([
    { origin: 'builder_list', channelKey: 'direct', verifiedAt: '2026-11-01' },
    { origin: 'paid_media', channelKey: 'paid_media', verifiedAt: '' },
    { origin: 'own', channelKey: 'social', verifiedAt: '2026-11-02' },
  ]);
  assert.deepEqual(cards, { signedUp: 3, verified: 2, notOnBuilderList: 2, paidMedia: 1 });
  const utm = Core.utmResults([
    { landing_page: '/es/developer-network-co', source: 'google', medium: 'cpc', campaign: 'dn', sessions: 4 },
    { landing_page: '/es/developer-network-co', source: 'google', medium: 'cpc', campaign: 'dn', sessions: 1 },
    { landing_page: '/pricing', source: 'direct', medium: '(none)', campaign: '(not set)', sessions: 9 },
  ]);
  assert.equal(utm.available, true);
  assert.deepEqual(utm.rows, [{ source: 'google', medium: 'cpc', campaign: 'dn', sessions: 5 }]);
  assert.equal(Core.utmResults([{ landing_page: '/pricing', source: 'direct', medium: 'x', campaign: 'y', sessions: 1 }]).reason, 'no_landing');
  assert.equal(Core.utmResults([]).reason, 'not_synced');
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
