'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { connectors, configured, REQUIRED } = require('../lib/connectors');
const catalog = require('../lib/sources-catalog');

const ALL_VARS = Object.values(REQUIRED).flat();

async function withEnv(vars, fn) {
  const saved = {};
  for (const name of ALL_VARS) { saved[name] = process.env[name]; delete process.env[name]; }
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const name of ALL_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

test('only HubSpot, GA4 and PostHog connectors exist', () => {
  assert.deepStrictEqual(Object.keys(connectors).sort(), ['ga4', 'hubspot', 'posthog']);
  assert.deepStrictEqual(Object.keys(REQUIRED).sort(), ['ga4', 'hubspot', 'posthog']);
});

test('a source counts as configured only when every required variable is set', async () => {
  await withEnv({}, () => {
    for (const key of ['hubspot', 'ga4', 'posthog']) assert.equal(configured(key), false);
  });
  await withEnv({ HUBSPOT_TOKEN: 'x', GA4_PROPERTY_ID: '123' }, () => {
    assert.equal(configured('hubspot'), true);
    assert.equal(configured('ga4'), false);
  });
  await withEnv({ POSTHOG_HOST: 'https://us.posthog.com', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'k' }, () => {
    assert.equal(configured('posthog'), true);
  });
  for (const key of ['meta', 'clarity', 'constructor', '']) assert.equal(configured(key), false);
});

test('the catalog lists the three synced sources with the same required variables, starting pending', () => {
  const synced = catalog.filter((c) => c.dashboard);
  assert.deepStrictEqual(synced.map((c) => c.key), ['hubspot', 'ga4', 'posthog']);
  for (const c of synced) assert.equal(c.dashboard.needs, REQUIRED[c.key].join(' + '));
  for (const c of catalog) assert.equal(c.state, 'pending');
  const gtm = catalog.find((c) => c.key === 'gtm');
  assert.equal(gtm.reference, true);
  assert.equal(gtm.dashboard, null);
});

test('hubspot keeps only sign-ups seen on the site and never returns a full email', async () => {
  const realFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    const body = String(url).includes('/analytics/v2/reports/sources/daily')
      ? { '2026-10-02': [{ breakdown: 'direct', visits: 5, visitors: 4, rawViews: 9, bounces: 1, contacts: 2 }] }
      : { results: [
        { id: '101', properties: { email: 'ana.perez@example.com', createdate: '2026-10-02T15:00:00Z', hs_analytics_first_url: 'https://go.think4ever.com/builders', company: 'Acme' } },
        { id: '102', properties: { email: 'luis@think4ever.com', createdate: '2026-10-03T15:00:00Z', hs_analytics_first_url: 'https://portal.think4ever.com/' } },
        { id: '103', properties: { email: 'off@site.com', createdate: '2026-10-03T15:00:00Z', hs_analytics_first_url: 'https://elsewhere.example/' } },
      ] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  try {
    const load = await withEnv({ HUBSPOT_TOKEN: 'test-token' }, () => connectors.hubspot());
    assert.equal(load.source, 'hubspot');
    assert.deepStrictEqual(load.events.map((e) => e.id), ['101', '102']);
    assert.equal(load.events[0].domain_type, 'external');
    assert.equal(load.events[1].internal, true);
    assert.ok(load.metrics.some((m) => m.metric === 'sessions' && m.value === 5 && m.dim_value === 'Direct'));
    assert.doesNotMatch(JSON.stringify(load), /ana\.perez@|luis@|off@/);
    assert.ok(urls.every((u) => u.startsWith('https://api.hubapi.com/')));
  } finally {
    global.fetch = realFetch;
  }
});

test('with EMAIL_HASH_KEY, hubspot form sign-ups carry only the HMAC hash, never the email', async () => {
  const { emailHash } = require('../lib/email-hash');
  const realFetch = global.fetch;
  const savedKey = process.env.EMAIL_HASH_KEY;
  const savedInvites = process.env.HUBSPOT_INVITE_EMAIL_IDS;
  process.env.EMAIL_HASH_KEY = 'unit-test-hash-key';
  delete process.env.HUBSPOT_INVITE_EMAIL_IDS;
  global.fetch = async (url) => {
    const body = String(url).includes('/analytics/v2/reports/sources/daily')
      ? { '2026-10-02': [{ breakdown: 'direct', visits: 5, visitors: 4, rawViews: 9, bounces: 1, contacts: 2 }] }
      : { results: [{ id: '101', properties: { email: 'Ana.Perez@example.com', createdate: '2026-10-02T15:00:00Z', hs_analytics_first_url: 'https://go.think4ever.com/builders' } }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  try {
    const load = await withEnv({ HUBSPOT_TOKEN: 'test-token' }, () => connectors.hubspot());
    assert.equal(load.events[0].email_hash, emailHash('ana.perez@example.com', 'unit-test-hash-key'));
    assert.doesNotMatch(JSON.stringify(load), /ana\.perez@/i);
    const coverage = load.snapshots.find((s) => s.key === 'invite_coverage');
    assert.equal(coverage.rows[0].available, false, 'no invitation ids configured: pending, not estimated');
  } finally {
    global.fetch = realFetch;
    if (savedKey === undefined) delete process.env.EMAIL_HASH_KEY; else process.env.EMAIL_HASH_KEY = savedKey;
    if (savedInvites !== undefined) process.env.HUBSPOT_INVITE_EMAIL_IDS = savedInvites;
  }
});

test('ga4 refuses a malformed service account without echoing it', async () => {
  await withEnv({ GA4_PROPERTY_ID: '123', GA4_SERVICE_ACCOUNT: '{"private_key":"SECRET-KEY-MATERIAL' }, async () => {
    await assert.rejects(() => connectors.ga4(), (err) => {
      assert.match(err.message, /GA4_SERVICE_ACCOUNT is not valid JSON/);
      assert.doesNotMatch(err.message, /SECRET-KEY-MATERIAL/);
      return true;
    });
  });
});
