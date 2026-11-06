'use strict';

// Stores one connector load ({ source, from, to, metrics, events, snapshots }) in MySQL and
// records sync runs and the per-source state shown on the Data sources screen.
//
// Privacy rule: no full email address is ever written. Any "local@domain" found in a stored
// string (metric dimensions, event attributes, snapshot rows, error text) is reduced to its
// domain, and an event's email is kept only as email_domain plus, when the connector computed
// it with EMAIL_HASH_KEY, an HMAC hash (email_hash, 64 hex characters, validated here).

const BATCH_SIZE = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /[^\s@<>"',;:()[\]]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const HASH_RE = /^[a-f0-9]{64}$/;
const EVENT_COLUMNS = new Set(['id', 'kind', 'date', 'site_host', 'channel', 'country', 'internal', 'domain_type', 'email', 'domain', 'email_hash']);

const SQL = Object.freeze({
  program: 'SELECT id FROM programs ORDER BY id LIMIT 1',
  metrics: 'INSERT INTO source_metrics (program_id, source, metric, metric_date, dim, dim_value, `value`) VALUES ? '
    + 'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = CURRENT_TIMESTAMP',
  events: 'INSERT INTO source_events (program_id, source, external_id, kind, event_date, site_host, channel, country, is_internal, domain_type, email_domain, email_hash, attributes) VALUES ? '
    + 'ON DUPLICATE KEY UPDATE event_date = VALUES(event_date), site_host = VALUES(site_host), channel = VALUES(channel), country = VALUES(country), '
    + 'is_internal = VALUES(is_internal), domain_type = VALUES(domain_type), email_domain = VALUES(email_domain), email_hash = VALUES(email_hash), attributes = VALUES(attributes), updated_at = CURRENT_TIMESTAMP',
  snapshots: 'INSERT INTO source_snapshots (program_id, source, snap_key, period_from, period_to, note, rows_json) VALUES ? '
    + 'ON DUPLICATE KEY UPDATE note = VALUES(note), rows_json = VALUES(rows_json), pulled_at = CURRENT_TIMESTAMP',
  startRun: "INSERT INTO sync_runs (program_id, source, status, started_at) VALUES (?, ?, 'running', UTC_TIMESTAMP(3))",
  finishRun: 'UPDATE sync_runs SET status = ?, finished_at = UTC_TIMESTAMP(3), duration_ms = ?, metrics_count = ?, events_count = ?, snapshots_count = ?, error = ? WHERE id = ?',
  sourceState: 'UPDATE data_sources SET state = ? WHERE program_id = ? AND name = ?',
  sourceStateSync: 'UPDATE data_sources SET state = ?, last_sync = ? WHERE program_id = ? AND name = ?',
});

function scrubEmails(value) {
  return String(value).replace(EMAIL_RE, (_, domain) => domain.toLowerCase());
}

function scrubDeep(value) {
  if (typeof value === 'string') return scrubEmails(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubDeep(v);
    return out;
  }
  return value;
}

const cut = (value, max) => scrubEmails(value === null || value === undefined ? '' : value).slice(0, max);
const orNull = (value) => (value === '' ? null : value);
const isoDate = (value) => {
  const s = String(value || '').slice(0, 10);
  return DATE_RE.test(s) ? s : null;
};
const todayIso = () => new Date().toISOString().slice(0, 10);

function emailDomain(event) {
  const raw = String(event.email || event.domain || '').trim().toLowerCase();
  if (!raw) return null;
  const domain = raw.includes('@') ? raw.slice(raw.lastIndexOf('@') + 1) : raw;
  return /^[a-z0-9.-]{1,191}$/.test(domain) ? domain : null;
}

function errorText(err) {
  const raw = (err && (err.message || err.code)) || err || 'unknown error';
  return scrubEmails(raw).slice(0, 500);
}

// Valid rows only, one per unique key (last wins, like the upsert itself).
function normalizeMetrics(metrics) {
  const byKey = new Map();
  for (const m of Array.isArray(metrics) ? metrics : []) {
    if (!m || !m.metric) continue;
    const date = isoDate(m.date);
    const value = Number(m.value);
    if (!date || !Number.isFinite(value)) continue;
    const row = { metric: cut(m.metric, 64), date, dim: cut(m.dim, 32), dim_value: cut(m.dim_value, 191), value };
    byKey.set(`${row.metric}|${row.date}|${row.dim}|${row.dim_value}`, row);
  }
  return [...byKey.values()];
}

function normalizeEvents(events) {
  const byKey = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || !e.id) continue;
    const attributes = {};
    for (const [k, v] of Object.entries(e)) {
      if (EVENT_COLUMNS.has(k) || v === '' || v === null || v === undefined) continue;
      attributes[k] = v;
    }
    const row = {
      external_id: cut(e.id, 64),
      kind: cut(e.kind || 'event', 40),
      date: isoDate(e.date),
      site_host: orNull(cut(e.site_host, 191)),
      channel: orNull(cut(e.channel, 100)),
      country: orNull(cut(e.country, 100)),
      internal: e.internal ? 1 : 0,
      domain_type: orNull(cut(e.domain_type, 16)),
      email_domain: emailDomain(e),
      email_hash: HASH_RE.test(String(e.email_hash || '')) ? String(e.email_hash) : null,
      attributes: scrubDeep(attributes),
    };
    byKey.set(`${row.external_id}|${row.kind}`, row);
  }
  return [...byKey.values()];
}

function normalizeSnapshots(snapshots, loadFrom, loadTo) {
  const from = isoDate(loadFrom) || todayIso();
  const to = isoDate(loadTo) || todayIso();
  const byKey = new Map();
  for (const s of Array.isArray(snapshots) ? snapshots : []) {
    if (!s || !s.key) continue;
    const row = {
      key: cut(s.key, 64),
      from: isoDate(s.from) || from,
      to: isoDate(s.to) || to,
      note: orNull(cut(s.note, 500)),
      rows: JSON.stringify(scrubDeep(Array.isArray(s.rows) ? s.rows : [])),
    };
    byKey.set(`${row.key}|${row.from}|${row.to}`, row);
  }
  return [...byKey.values()];
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// One transaction per load: either everything from this sync is stored or nothing is.
async function saveLoad(pool, programId, load) {
  const source = cut(load && load.source, 32);
  if (!source) throw new Error('load has no source');
  const metrics = normalizeMetrics(load.metrics);
  const events = normalizeEvents(load.events);
  const snapshots = normalizeSnapshots(load.snapshots, load.from, load.to);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const part of chunks(metrics, BATCH_SIZE)) {
      await conn.query(SQL.metrics, [part.map((r) => [programId, source, r.metric, r.date, r.dim, r.dim_value, r.value])]);
    }
    for (const part of chunks(events, BATCH_SIZE)) {
      await conn.query(SQL.events, [part.map((r) => [programId, source, r.external_id, r.kind, r.date, r.site_host, r.channel, r.country, r.internal, r.domain_type, r.email_domain, r.email_hash, JSON.stringify(r.attributes)])]);
    }
    for (const part of chunks(snapshots, 50)) {
      await conn.query(SQL.snapshots, [part.map((r) => [programId, source, r.key, r.from, r.to, r.note, r.rows])]);
    }
    await conn.commit();
  } catch (err) {
    await Promise.resolve().then(() => conn.rollback()).catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  return { metrics: metrics.length, events: events.length, snapshots: snapshots.length };
}

async function findProgramId(pool) {
  const [rows] = await pool.query(SQL.program);
  if (!rows || !rows[0]) throw new Error('No program row found in the database');
  return rows[0].id;
}

async function startRun(pool, programId, source) {
  const [result] = await pool.query(SQL.startRun, [programId, source]);
  return result.insertId;
}

async function finishRun(pool, runId, { status, durationMs = 0, counts = {}, error = null } = {}) {
  await pool.query(SQL.finishRun, [
    status, Math.max(0, Math.round(durationMs)),
    counts.metrics || 0, counts.events || 0, counts.snapshots || 0,
    error === null ? null : errorText(error), runId,
  ]);
}

async function setSourceState(pool, programId, name, { state, lastSync } = {}) {
  if (lastSync === undefined) return pool.query(SQL.sourceState, [state, programId, name]);
  return pool.query(SQL.sourceStateSync, [state, lastSync, programId, name]);
}

module.exports = {
  SQL, scrubEmails, errorText, normalizeMetrics, normalizeEvents, normalizeSnapshots,
  saveLoad, findProgramId, startRun, finishRun, setSourceState,
};
