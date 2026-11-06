'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FUNNEL, SQL, toDashboard, loadDashboard, validateContent, saveBuilderContent } = require('../lib/dashboard-repo');
const { readDbConfig } = require('../lib/db');
const Core = require('../public/dashboard-core.js');

const PROGRAM = {
  id: 1, name: 'Early Builders / Developer Network', signup_target: 200, account_capacity: 300,
  ceo_target: null, country: 'Colombia', mode: 'live', snapshot_at: '',
};
const TOTALS = {
  sessions: '2454.0000', formSignups: 17, formHashed: 15, registrationStarted: '51.0000',
  accountCreated: '12.0000', accountVerified: '7.0000', formToVerified: 3,
};

test('the funnel has six steps with source and comparable base', () => {
  const data = toDashboard({ program: PROGRAM, totals: TOTALS, lastSync: '2026-11-06T14:32:05Z', hashKey: true });
  assert.deepStrictEqual(FUNNEL.map((s) => s.key), ['sessions', 'formSignups', 'registrationStarted', 'accountCreated', 'accountVerified', 'formToVerified']);
  assert.deepStrictEqual(data.funnel.map((s) => [s.key, s.source, s.base, s.value]), [
    ['sessions', 'hubspot', null, 2454],
    ['formSignups', 'hubspot', 'sessions', 17],
    ['registrationStarted', 'posthog', null, 51],
    ['accountCreated', 'posthog', 'registrationStarted', 12],
    ['accountVerified', 'posthog', 'accountCreated', 7],
    ['formToVerified', 'cross', 'formSignups', 3],
  ]);
  assert.equal(data.funnel[5].baseValue, 15);
  assert.equal(data.funnel[5].pending, false);
  assert.equal(data.snapshotAt, '2026-11-06T14:32:05Z');
  assert.equal(Core.signupProgress(data.funnel, data.program.signupTarget).total, 7, 'the target counts account_verified');
  assert.deepStrictEqual(Core.funnelSteps(data.funnel).map((s) => s.conversion), [null, 1, null, 24, 58, 20]);
});

test('without EMAIL_HASH_KEY the cross is pending and shows no value', () => {
  const data = toDashboard({ program: PROGRAM, totals: TOTALS, hashKey: false });
  const cross = data.funnel.find((s) => s.key === 'formToVerified');
  assert.equal(cross.pending, true);
  assert.equal(cross.value, 0);
  assert.equal(data.tracking.emailHash, false);
  assert.equal(Core.funnelSteps(data.funnel)[5].reason, 'pending');
});

test('without synced data every step is 0 and invitations stay pending (nothing is estimated)', () => {
  const data = toDashboard({ program: PROGRAM });
  assert.deepStrictEqual(data.funnel.map((s) => s.value), [0, 0, 0, 0, 0, 0]);
  assert.equal(data.snapshotAt, '');
  assert.deepStrictEqual(data.builders, []);
  assert.deepStrictEqual(data.channels, []);
  assert.deepStrictEqual(data.sources, []);
  assert.equal(data.program.ceoTarget, null);
  assert.equal(data.invitations.available, false);
  assert.equal(data.invitations.reason, 'not_synced');
  assert.equal(data.invitations.sent, 0);
  assert.equal(data.tracking.creditsEvent, false);
});

test('invitation counts are only shown when the HubSpot coverage says they are available', () => {
  const counts = { invited: '20', sent: '20', delivered: '18', opened: '9', replied: '4', closed: '2', accepted: '5', enrolled: '3' };
  const live = toDashboard({ program: PROGRAM, invitations: counts, coverage: [{ snap_key: 'invite_coverage', rows_json: JSON.stringify([{ available: true }]) }] });
  assert.deepStrictEqual(live.invitations, { available: true, reason: '', invited: 20, sent: 20, delivered: 18, opened: 9, replied: 4, closed: 2, accepted: 5, enrolled: 3 });
  const off = toDashboard({ program: PROGRAM, invitations: counts, coverage: [{ snap_key: 'invite_coverage', rows_json: [{ available: false, reason: 'HUBSPOT_INVITE_EMAIL_IDS is not configured.' }] }] });
  assert.equal(off.invitations.available, false);
  assert.equal(off.invitations.invited, 0);
  assert.match(off.invitations.reason, /HUBSPOT_INVITE_EMAIL_IDS/);
});

test('channels are mapped to whole numbers', () => {
  const data = toDashboard({
    program: PROGRAM,
    channels: [{ channel: 'Paid social', sessions: '2092.0000', contacts: '6.0000' }, { channel: null, sessions: null, contacts: '1' }],
  });
  assert.deepStrictEqual(data.channels, [
    { channel: 'Paid social', sessions: 2092, contacts: 6 },
    { channel: '—', sessions: 0, contacts: 1 },
  ]);
});

const BUILDER_ROW = {
  external_id: 'abcdef12'.padEnd(64, '0'), email_domain: 'example.com', verified_on: '2026-11-04',
  attributes: JSON.stringify({ code: 'EB-ABCDEF12', projects: 1, sign_ins: 3, last_sign_in: '2026-11-05', verified_at: '2026-11-04', credits_granted_at: '' }),
};

test('builders come from PostHog verified people; active needs a project AND recorded content', () => {
  const withContent = toDashboard({
    program: PROGRAM, builders: [BUILDER_ROW],
    content: [{ builder_code: 'EB-ABCDEF12', url: 'https://example.test/p', platform: 'YouTube', published_at: '2026-11-05' }],
  }).builders[0];
  assert.equal(withContent.id, 'EB-ABCDEF12');
  assert.equal(withContent.email, '@example.com', 'only the domain');
  assert.equal(withContent.signedUpAt, '2026-11-04');
  assert.equal(withContent.contentUrl, 'https://example.test/p');
  assert.equal(withContent.contentPlatform, 'YouTube');
  assert.equal(withContent.stage, 'Activo');
  assert.equal(Core.isActive(withContent), true);

  const projectOnly = toDashboard({ program: PROGRAM, builders: [BUILDER_ROW] }).builders[0];
  assert.equal(projectOnly.stage, 'En progreso');
  assert.equal(Core.isActive(projectOnly), false, 'project_created alone is not enough');
  assert.equal(projectOnly.creditsGrantedAt, '');
});

test('Date objects are refused instead of being shifted across timezones', () => {
  const content = [{ builder_code: 'EB-ABCDEF12', url: 'https://x.test', published_at: new Date('2026-10-28T00:00:00Z') }];
  assert.throws(() => toDashboard({ program: PROGRAM, builders: [BUILDER_ROW], content }), /dateStrings/);
});

function fakePool(answers) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const key = Object.keys(SQL).find((k) => SQL[k] === sql);
      if (!key) throw new Error(`unexpected SQL: ${sql}`);
      return [answers[key] || []];
    },
  };
}

test('loadDashboard queries per program and builds the payload from synced data', async () => {
  const pool = fakePool({
    program: [PROGRAM],
    sources: [{ name: 'HubSpot', purpose: 'p', state: 'Conectado', method: 'm', last_sync: '2026-11-06 14:30 UTC', needs: 'HUBSPOT_TOKEN' }],
    lastSync: [{ last_ok: '2026-11-06T14:32:05Z' }],
    sessions: [{ total: '2454.0000' }],
    formSignups: [{ total: 17, hashed: '15' }],
    signups: [{ total: '51.0000' }],
    accountsCreated: [{ total: '12.0000' }],
    accountsVerified: [{ total: '7.0000' }],
    crossVerified: [{ total: 3 }],
    channels: [{ channel: 'Direct', sessions: '201.0000', contacts: '8.0000' }],
  });
  const data = await loadDashboard(pool, { EMAIL_HASH_KEY: 'k' });
  assert.deepStrictEqual(data.funnel.map((s) => s.value), [2454, 17, 51, 12, 7, 3]);
  assert.equal(data.funnel[5].baseValue, 15);
  assert.equal(data.snapshotAt, '2026-11-06T14:32:05Z');
  assert.equal(data.sources[0].state, 'Conectado');
  assert.deepStrictEqual(data.channels, [{ channel: 'Direct', sessions: 201, contacts: 8 }]);
  assert.equal(pool.calls.length, 14);
  for (const call of pool.calls.slice(1)) assert.deepStrictEqual(call.params, [1]);
  assert.equal(pool.calls.some((c) => /funnel_stages/.test(c.sql)), false, 'never reads the old hand-entered funnel');
});

test('loadDashboard fails when there is no program row', async () => {
  await assert.rejects(() => loadDashboard(fakePool({ program: [] }), {}), /No program row/);
});

test('every count excludes internal accounts', () => {
  assert.match(SQL.formSignups, /is_internal = 0/);
  for (const key of ['signups', 'accountsCreated', 'accountsVerified']) assert.match(SQL[key], /dim_value <> 'Internal'/);
  assert.match(SQL.accountsVerified, /ph_accounts_verified/);
  assert.match(SQL.crossVerified, /b\.is_internal = 0/);
  assert.match(SQL.crossVerified, /email_hash/);
  assert.match(SQL.builders, /is_internal = 0/);
});

const NOW = new Date('2026-11-05T12:00:00Z');

test('validateContent accepts an http(s) URL, a real date and an optional platform', () => {
  assert.deepStrictEqual(
    validateContent('eb-abcdef12', { url: ' https://example.test/post/1 ', publishedAt: '2026-11-03', platform: 'LinkedIn' }, NOW),
    { ok: true, value: { code: 'EB-ABCDEF12', url: 'https://example.test/post/1', platform: 'LinkedIn', publishedAt: '2026-11-03' } },
  );
  assert.equal(validateContent('EB-ABCDEF12', { url: 'http://x.test', publishedAt: '2026-11-06' }, NOW).ok, true, 'tomorrow is tolerated (time zones)');
});

test('validateContent rejects bad codes, unsafe URLs and invalid or future dates', () => {
  const fields = (code, body) => validateContent(code, body, NOW).errors || [];
  assert.deepStrictEqual(fields('xyz', { url: 'https://x.test', publishedAt: '2026-11-01' }), ['code']);
  for (const url of ['javascript:alert(1)', 'ftp://x.test/f', 'https://user:pw@x.test', 'not a url', `https://x.test/${'a'.repeat(600)}`]) {
    assert.deepStrictEqual(fields('EB-ABCDEF12', { url, publishedAt: '2026-11-01' }), ['url'], url);
  }
  for (const publishedAt of ['2026-02-30', '2026-11-20', '05/11/2026', '', '2019-12-31']) {
    assert.deepStrictEqual(fields('EB-ABCDEF12', { url: 'https://x.test', publishedAt }), ['publishedAt'], publishedAt);
  }
});

test('saveBuilderContent only saves for a builder present in the last sync', async () => {
  const value = { code: 'EB-ABCDEF12', url: 'https://x.test', platform: '', publishedAt: '2026-11-03' };
  const missing = fakePool({ program: [PROGRAM], builderExists: [] });
  assert.deepStrictEqual(await saveBuilderContent(missing, value, 'Admin'), { ok: false, error: 'builder_not_found' });
  assert.equal(missing.calls.some((c) => c.sql === SQL.saveContent), false);

  const found = fakePool({ program: [PROGRAM], builderExists: [{ found: 1 }], saveContent: { affectedRows: 1 } });
  const out = await saveBuilderContent(found, value, 'Admin');
  assert.equal(out.ok, true);
  const save = found.calls.find((c) => c.sql === SQL.saveContent);
  assert.deepStrictEqual(save.params, [1, 'EB-ABCDEF12', 'https://x.test', null, '2026-11-03', 'Admin']);
});

const DB_ENV = { DB_HOST: 'db.internal', DB_PORT: '3306', DB_USER: 'app', DB_PASSWORD: 'pw', DB_NAME: 'p290_project1' };

test('readDbConfig reads the injected DB_* variables', () => {
  assert.deepStrictEqual(readDbConfig(DB_ENV), { host: 'db.internal', port: 3306, user: 'app', password: 'pw', database: 'p290_project1' });
  assert.equal(readDbConfig({ ...DB_ENV, DB_PASSWORD: '' }).password, '');
});

test('readDbConfig fails loudly when variables are missing or invalid (no localhost fallback)', () => {
  assert.throws(() => readDbConfig({}), /missing DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME/);
  const { DB_HOST, ...noHost } = DB_ENV;
  assert.throws(() => readDbConfig(noHost), /missing DB_HOST/);
  assert.throws(() => readDbConfig({ ...DB_ENV, DB_NAME: '' }), /missing DB_NAME/);
  assert.throws(() => readDbConfig({ ...DB_ENV, DB_PORT: 'abc' }), /DB_PORT/);
});
