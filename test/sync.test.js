'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSync, startScheduler, syncIntervalMs, describeSources } = require('../lib/sync');
const { saveLoad, normalizeMetrics } = require('../lib/metrics-repo');

function fakePool({ failOn } = {}) {
  const log = [];
  let nextId = 1;
  function run(sql, params) {
    log.push({ sql, params });
    if (failOn && failOn.test(sql)) throw new Error('db down');
    if (/^SELECT id FROM programs/.test(sql)) return [[{ id: 1 }]];
    if (/^INSERT INTO sync_runs/.test(sql)) return [{ insertId: nextId++ }];
    return [{ affectedRows: 1 }];
  }
  return {
    log,
    query: async (sql, params) => run(sql, params),
    getConnection: async () => ({
      beginTransaction: async () => { log.push({ sql: 'BEGIN' }); },
      commit: async () => { log.push({ sql: 'COMMIT' }); },
      rollback: async () => { log.push({ sql: 'ROLLBACK' }); },
      release: () => {},
      query: async (sql, params) => run(sql, params),
    }),
  };
}

const load = (source, extra = {}) => ({
  source, from: '2026-10-01', to: '2026-10-03',
  metrics: [{ metric: 'sessions', date: '2026-10-02', dim: 'source', dim_value: 'Direct', value: 5 }],
  events: [], snapshots: [{ key: 'coverage', rows: [{ available: true }] }],
  ...extra,
});

const sourceStates = (pool) => pool.log
  .filter((q) => /^UPDATE data_sources/.test(q.sql))
  .map((q) => [q.params[q.params.length - 1], q.params[0]]);

test('a failing connector does not stop the others, and each outcome is recorded', async () => {
  const pool = fakePool();
  const sync = createSync({
    pool,
    configured: () => true,
    connectors: {
      hubspot: async () => load('hubspot'),
      ga4: async () => { throw new Error('403 permission denied'); },
      posthog: async () => load('posthog'),
    },
    now: () => new Date('2026-10-03T12:00:00Z'),
  });
  const results = await sync.runOnce();
  assert.deepStrictEqual(results.map((r) => [r.source, r.status]), [['hubspot', 'ok'], ['ga4', 'error'], ['posthog', 'ok']]);
  assert.deepStrictEqual(sourceStates(pool), [['HubSpot', 'Conectado'], ['GA4', 'Error'], ['PostHog', 'Conectado']]);
  const connected = pool.log.find((q) => /^UPDATE data_sources/.test(q.sql) && q.params[0] === 'Conectado');
  assert.equal(connected.params[1], '2026-10-03 12:00 UTC');
  assert.deepStrictEqual(pool.log.filter((q) => /^UPDATE sync_runs/.test(q.sql)).map((q) => q.params[0]), ['ok', 'error', 'ok']);
  const failedRun = pool.log.find((q) => /^UPDATE sync_runs/.test(q.sql) && q.params[0] === 'error');
  assert.match(failedRun.params[5], /403 permission denied/);
  assert.equal(pool.log.filter((q) => q.sql === 'COMMIT').length, 2);
});

test('sources without their variables stay Pendiente and are never called', async () => {
  const pool = fakePool();
  const sync = createSync({
    pool,
    configured: (key) => key === 'posthog',
    connectors: {
      hubspot: async () => { throw new Error('must not be called'); },
      ga4: async () => { throw new Error('must not be called'); },
      posthog: async () => load('posthog'),
    },
  });
  const results = await sync.runOnce();
  assert.deepStrictEqual(results.map((r) => r.status), ['skipped', 'skipped', 'ok']);
  assert.deepStrictEqual(sourceStates(pool), [['HubSpot', 'Pendiente'], ['GA4', 'Pendiente'], ['PostHog', 'Conectado']]);
  assert.equal(pool.log.filter((q) => /^INSERT INTO sync_runs/.test(q.sql)).length, 1);
});

test('a database failure rolls the load back and marks the source as Error', async () => {
  const pool = fakePool({ failOn: /^INSERT INTO source_metrics/ });
  const sync = createSync({ pool, configured: (key) => key === 'hubspot', connectors: { hubspot: async () => load('hubspot') } });
  const [first] = await sync.runOnce();
  assert.equal(first.status, 'error');
  assert.ok(pool.log.some((q) => q.sql === 'ROLLBACK'));
  assert.ok(!pool.log.some((q) => q.sql === 'COMMIT'));
  assert.deepStrictEqual(sourceStates(pool)[0], ['HubSpot', 'Error']);
});

test('stored rows never contain a full email address', async () => {
  const pool = fakePool();
  await saveLoad(pool, 1, {
    source: 'hubspot', from: '2026-10-01', to: '2026-10-03',
    metrics: [{ metric: 'sessions', date: '2026-10-02', dim: 'contact', dim_value: 'zoe@leak.example', value: 1 }],
    events: [{ id: '7', kind: 'form_signup', date: '2026-10-02', email: 'ana@example.com', channel: 'Email', note: 'from bob@corp.io' }],
    snapshots: [{ key: 'debug', rows: [{ who: 'carla@example.org' }] }],
  });
  const stored = JSON.stringify(pool.log.map((q) => q.params));
  assert.doesNotMatch(stored, /zoe@|ana@|bob@|carla@/);
  assert.match(stored, /example\.com/);
});

test('metrics with invalid dates or values are dropped and duplicates collapse to one row', () => {
  const rows = normalizeMetrics([
    { metric: 'm', date: '2026-10-02', value: 1 },
    { metric: 'm', date: '2026-10-02', value: 2 },
    { metric: 'm', date: 'yesterday', value: 3 },
    { metric: 'm', date: '2026-10-03', value: 'n/a' },
    { date: '2026-10-03', value: 4 },
  ]);
  assert.deepStrictEqual(rows, [{ metric: 'm', date: '2026-10-02', dim: '', dim_value: '', value: 2 }]);
});

test('SYNC_INTERVAL_HOURS defaults to 6 hours and rejects bad values', () => {
  assert.equal(syncIntervalMs(undefined), 6 * 36e5);
  assert.equal(syncIntervalMs(''), 6 * 36e5);
  assert.equal(syncIntervalMs('12'), 12 * 36e5);
  for (const bad of ['0', '-1', 'abc', '500']) assert.throws(() => syncIntervalMs(bad), /SYNC_INTERVAL_HOURS/);
});

test('start-up summary names missing variables but never prints values', () => {
  const lines = describeSources(
    { hubspot: ['HUBSPOT_TOKEN'], ga4: ['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT'], posthog: ['POSTHOG_HOST'] },
    { HUBSPOT_TOKEN: 'super-secret-value', GA4_PROPERTY_ID: '123' },
  );
  assert.deepStrictEqual(lines, ['hubspot: configured', 'ga4: pending, missing GA4_SERVICE_ACCOUNT', 'posthog: pending, missing POSTHOG_HOST']);
  assert.doesNotMatch(lines.join('\n'), /super-secret-value|123/);
});

test('the scheduler runs once after the delay and stops cleanly', async () => {
  let calls = 0;
  const scheduler = startScheduler({ runOnce: async () => { calls += 1; } }, { intervalMs: 36e5, initialDelayMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  scheduler.stop();
  assert.equal(calls, 1);
});
