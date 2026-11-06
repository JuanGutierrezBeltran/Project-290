'use strict';

// Builds the dashboard payload from MySQL with REAL data only:
//   * program targets (programs),
//   * the funnel: HubSpot landing sessions and form submissions, then PostHog
//     registration_started, account_created and account_verified (first event per person,
//     internal accounts excluded), plus the person-level cross "form -> verified account"
//     matched by the HMAC email hash (pending while EMAIL_HASH_KEY is not set),
//   * the invitation states from HubSpot marketing emails (HUBSPOT_INVITE_EMAIL_IDS),
//   * builders = PostHog people with a verified account (pseudonymous code + email domain),
//     joined with the published content recorded by hand (builder_content),
//   * the HubSpot channel table, the source states and snapshotAt = last successful sync.
// Every funnel step carries its source and the step it is compared with (base): conversion
// is only computed inside one source or across a person-level match. Nothing is estimated.

const FUNNEL = Object.freeze([
  Object.freeze({ key: 'sessions', label: 'Sesiones en la landing', source: 'hubspot', base: null }),
  Object.freeze({ key: 'formSignups', label: 'Envíos del formulario', source: 'hubspot', base: 'sessions' }),
  Object.freeze({ key: 'registrationStarted', label: 'Inicio de registro', source: 'posthog', base: null }),
  Object.freeze({ key: 'accountCreated', label: 'Cuenta creada', source: 'posthog', base: 'registrationStarted' }),
  Object.freeze({ key: 'accountVerified', label: 'Cuenta verificada', source: 'posthog', base: 'accountCreated' }),
  Object.freeze({ key: 'formToVerified', label: 'Formulario → cuenta verificada', source: 'cross', base: 'formSignups' }),
]);
const CROSS_KEY = 'formToVerified';
const INVITE_FIELDS = Object.freeze(['invited', 'sent', 'delivered', 'opened', 'replied', 'closed', 'accepted', 'enrolled']);
const CODE_RE = /^EB-[A-F0-9]{8}$/;

const flag = (k) => `COALESCE(SUM(COALESCE(i.attributes->>'$.${k}', '0') = '1'), 0) AS ${k}`;

const SQL = Object.freeze({
  program: 'SELECT id, name, signup_target, account_capacity, ceo_target, country, `mode`, snapshot_at FROM programs ORDER BY id LIMIT 1',
  builders: "SELECT external_id, email_domain, DATE_FORMAT(event_date, '%Y-%m-%d') AS verified_on, attributes FROM source_events WHERE program_id = ? AND source = 'posthog' AND kind = 'builder' AND is_internal = 0 ORDER BY event_date, external_id",
  content: "SELECT builder_code, url, platform, DATE_FORMAT(published_at, '%Y-%m-%d') AS published_at FROM builder_content WHERE program_id = ?",
  sources: 'SELECT name, purpose, state, method, last_sync, needs FROM data_sources WHERE program_id = ? ORDER BY sort_order, id',
  lastSync: "SELECT DATE_FORMAT(MAX(finished_at), '%Y-%m-%dT%H:%i:%sZ') AS last_ok FROM sync_runs WHERE program_id = ? AND status = 'ok'",
  sessions: "SELECT COALESCE(SUM(`value`), 0) AS total FROM source_metrics WHERE program_id = ? AND source = 'hubspot' AND metric = 'sessions' AND dim = 'source'",
  formSignups: "SELECT COUNT(*) AS total, COALESCE(SUM(email_hash IS NOT NULL), 0) AS hashed FROM source_events WHERE program_id = ? AND source = 'hubspot' AND kind = 'form_signup' AND is_internal = 0",
  signups: "SELECT COALESCE(SUM(`value`), 0) AS total FROM source_metrics WHERE program_id = ? AND source = 'posthog' AND metric = 'ph_signups' AND dim = 'account_type' AND dim_value <> 'Internal'",
  accountsCreated: "SELECT COALESCE(SUM(`value`), 0) AS total FROM source_metrics WHERE program_id = ? AND source = 'posthog' AND metric = 'ph_accounts_created' AND dim = 'account_type' AND dim_value <> 'Internal'",
  accountsVerified: "SELECT COALESCE(SUM(`value`), 0) AS total FROM source_metrics WHERE program_id = ? AND source = 'posthog' AND metric = 'ph_accounts_verified' AND dim = 'account_type' AND dim_value <> 'Internal'",
  crossVerified: "SELECT COUNT(DISTINCT f.email_hash) AS total FROM source_events f JOIN source_events b ON b.program_id = f.program_id AND b.source = 'posthog' AND b.kind = 'builder' AND b.is_internal = 0 AND b.email_hash = f.email_hash WHERE f.program_id = ? AND f.source = 'hubspot' AND f.kind = 'form_signup' AND f.is_internal = 0 AND f.email_hash IS NOT NULL",
  invitations: `SELECT COUNT(*) AS invited, ${flag('sent')}, ${flag('delivered')}, ${flag('opened')}, ${flag('replied')}, `
    + "COALESCE(SUM(COALESCE(i.attributes->>'$.replied', '0') <> '1' AND (COALESCE(i.attributes->>'$.bounced', '0') = '1' OR COALESCE(i.attributes->>'$.unsubscribed', '0') = '1')), 0) AS closed, "
    + "COALESCE(SUM(EXISTS (SELECT 1 FROM source_events f WHERE f.program_id = i.program_id AND f.source = 'hubspot' AND f.kind = 'form_signup' AND f.email_hash = i.email_hash)), 0) AS accepted, "
    + "COALESCE(SUM(EXISTS (SELECT 1 FROM source_events b WHERE b.program_id = i.program_id AND b.source = 'posthog' AND b.kind = 'builder' AND b.is_internal = 0 AND b.email_hash = i.email_hash)), 0) AS enrolled "
    + "FROM source_events i WHERE i.program_id = ? AND i.source = 'hubspot' AND i.kind = 'invite' AND i.is_internal = 0",
  coverage: "SELECT source, snap_key, rows_json FROM source_snapshots WHERE program_id = ? AND snap_key IN ('invite_coverage', 'account_lifecycle') ORDER BY pulled_at DESC, id DESC",
  channels: "SELECT dim_value AS channel, SUM(CASE WHEN metric = 'sessions' THEN `value` ELSE 0 END) AS sessions, SUM(CASE WHEN metric = 'contacts' THEN `value` ELSE 0 END) AS contacts FROM source_metrics WHERE program_id = ? AND source = 'hubspot' AND dim = 'source' AND metric IN ('sessions', 'contacts') GROUP BY dim_value ORDER BY sessions DESC, contacts DESC, dim_value",
  builderExists: "SELECT 1 AS found FROM source_events WHERE program_id = ? AND source = 'posthog' AND kind = 'builder' AND is_internal = 0 AND attributes->>'$.code' = ? LIMIT 1",
  saveContent: 'INSERT INTO builder_content (program_id, builder_code, url, platform, published_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?) '
    + 'ON DUPLICATE KEY UPDATE url = VALUES(url), platform = VALUES(platform), published_at = VALUES(published_at), recorded_by = VALUES(recorded_by), updated_at = CURRENT_TIMESTAMP',
});

function text(value) {
  return value === null || value === undefined ? '' : String(value);
}

function count(value) {
  return value === null || value === undefined ? 0 : Number(value);
}

function countOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

// SUM() over DECIMAL arrives as a string such as '2454.0000'.
function whole(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// DATE columns must arrive as 'YYYY-MM-DD' strings (pool option dateStrings / DATE_FORMAT).
// A Date object would mean a timezone conversion already happened, so refuse it.
function dateText(value) {
  if (value instanceof Date) throw new Error('DATE columns must be read with dateStrings: true');
  return text(value);
}

function jsonOf(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return typeof value === 'object' ? value : null;
}

// Newest snapshot row for a key (rows arrive ordered by pulled_at DESC).
function latestSnapshot(rows, key) {
  const row = (rows || []).find((r) => r && r.snap_key === key);
  const list = row ? jsonOf(row.rows_json) : null;
  return Array.isArray(list) && list[0] && typeof list[0] === 'object' ? list[0] : null;
}

function builderFrom(row, contentByCode) {
  const a = jsonOf(row.attributes) || {};
  const code = text(a.code) || `EB-${text(row.external_id).slice(0, 8).toUpperCase()}`;
  const c = contentByCode.get(code) || {};
  const projects = count(a.projects);
  const signIns = count(a.sign_ins);
  const contentUrl = text(c.url);
  const contentAt = dateText(c.published_at);
  const active = projects > 0 && Boolean(contentUrl) && Boolean(contentAt);
  const domain = text(row.email_domain);
  return {
    id: code,
    email: domain ? `@${domain}` : '',
    profile: '',
    city: '',
    refKey: '',
    channel: '',
    stage: active ? 'Activo' : (projects > 0 || signIns > 0) ? 'En progreso' : 'Inscrito',
    invitedAt: '',
    signedUpAt: text(a.verified_at) || dateText(row.verified_on),
    creditsGrantedAt: text(a.credits_granted_at),
    credits: 0,
    lastSignIn: text(a.last_sign_in),
    signIns,
    projects,
    creditsUsed: 0,
    contentUrl,
    contentAt,
    contentPlatform: text(c.platform),
  };
}

function toDashboard({ program, builders, content, sources, lastSync, totals, channels, invitations, coverage, hashKey }) {
  if (!program) throw new Error('No program row found in the database');
  const sums = totals || {};
  const inv = invitations || {};
  const inviteCov = latestSnapshot(coverage, 'invite_coverage');
  const lifecycle = latestSnapshot(coverage, 'account_lifecycle');
  const contentByCode = new Map((content || []).map((c) => [text(c.builder_code), c]));
  const crossPending = !hashKey;
  const invitationsOut = {
    available: Boolean(inviteCov && inviteCov.available),
    reason: inviteCov ? text(inviteCov.reason) : 'not_synced',
  };
  for (const k of INVITE_FIELDS) invitationsOut[k] = invitationsOut.available ? whole(inv[k]) : 0;
  return {
    mode: text(program.mode),
    snapshotAt: text(lastSync),
    program: {
      name: text(program.name),
      signupTarget: count(program.signup_target),
      accountCapacity: count(program.account_capacity),
      ceoTarget: countOrNull(program.ceo_target),
      country: text(program.country),
    },
    funnel: FUNNEL.map((step) => {
      const out = { key: step.key, label: step.label, source: step.source, base: step.base, value: whole(sums[step.key]) };
      if (step.key === CROSS_KEY) {
        out.baseValue = whole(sums.formHashed);
        out.pending = crossPending;
        if (crossPending) out.value = 0;
      }
      return out;
    }),
    invitations: invitationsOut,
    tracking: {
      emailHash: Boolean(hashKey),
      creditsEvent: Boolean(lifecycle && lifecycle.credits_available),
      creditsEventName: lifecycle ? text(lifecycle.credits_event) : '',
    },
    channels: (channels || []).map((row) => ({
      channel: text(row.channel) || '—',
      sessions: whole(row.sessions),
      contacts: whole(row.contacts),
    })),
    builders: (builders || []).map((row) => builderFrom(row, contentByCode)),
    sources: (sources || []).map((row) => ({
      name: text(row.name),
      purpose: text(row.purpose),
      state: text(row.state),
      method: text(row.method),
      lastSync: text(row.last_sync),
      needs: text(row.needs),
    })),
  };
}

const firstRow = (result) => (result && result[0] && result[0][0]) || {};

async function loadDashboard(pool, env = process.env) {
  const [programs] = await pool.query(SQL.program);
  const program = programs && programs[0];
  if (!program) throw new Error('No program row found in the database');
  const id = [program.id];
  const [builders, content, sources, last, sessions, form, signups, created, verified, cross, invites, coverage, channels] = await Promise.all([
    pool.query(SQL.builders, id),
    pool.query(SQL.content, id),
    pool.query(SQL.sources, id),
    pool.query(SQL.lastSync, id),
    pool.query(SQL.sessions, id),
    pool.query(SQL.formSignups, id),
    pool.query(SQL.signups, id),
    pool.query(SQL.accountsCreated, id),
    pool.query(SQL.accountsVerified, id),
    pool.query(SQL.crossVerified, id),
    pool.query(SQL.invitations, id),
    pool.query(SQL.coverage, id),
    pool.query(SQL.channels, id),
  ]);
  return toDashboard({
    program,
    builders: builders[0],
    content: content[0],
    sources: sources[0],
    lastSync: firstRow(last).last_ok,
    totals: {
      sessions: firstRow(sessions).total,
      formSignups: firstRow(form).total,
      formHashed: firstRow(form).hashed,
      registrationStarted: firstRow(signups).total,
      accountCreated: firstRow(created).total,
      accountVerified: firstRow(verified).total,
      formToVerified: firstRow(cross).total,
    },
    invitations: firstRow(invites),
    coverage: coverage[0],
    channels: channels[0],
    hashKey: Boolean(env && env.EMAIL_HASH_KEY),
  });
}

function createDashboardLoader(pool, env = process.env) {
  return () => loadDashboard(pool, env);
}

// Validates a published-content record: builder code, http(s) URL (no credentials, max 500
// characters), publication date (YYYY-MM-DD, real calendar day, not after tomorrow) and an
// optional platform label. Returns { ok, value } or { ok: false, errors: [field, ...] }.
function validateContent(code, body, now = new Date()) {
  const errors = [];
  const input = body && typeof body === 'object' ? body : {};
  const builder = String(code || '').trim().toUpperCase();
  if (!CODE_RE.test(builder)) errors.push('code');

  let url = '';
  const rawUrl = String(input.url || '').trim();
  try {
    const u = new URL(rawUrl);
    const normalized = u.toString();
    if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && normalized.length <= 500) url = normalized;
  } catch { /* invalid URL */ }
  if (!url) errors.push('url');

  const date = String(input.publishedAt || '').trim();
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  const real = /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T12:00:00Z`))
    && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
  if (!real || date < '2020-01-01' || date > tomorrow) errors.push('publishedAt');

  const platform = String(input.platform || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
  return errors.length ? { ok: false, errors } : { ok: true, value: { code: builder, url, platform, publishedAt: date } };
}

async function saveBuilderContent(pool, value, recordedBy) {
  const [programs] = await pool.query(SQL.program);
  const program = programs && programs[0];
  if (!program) throw new Error('No program row found in the database');
  const [found] = await pool.query(SQL.builderExists, [program.id, value.code]);
  if (!found || !found.length) return { ok: false, error: 'builder_not_found' };
  await pool.query(SQL.saveContent, [
    program.id, value.code, value.url, value.platform || null, value.publishedAt,
    String(recordedBy || '').slice(0, 120) || null,
  ]);
  return { ok: true, content: { id: value.code, contentUrl: value.url, contentAt: value.publishedAt, contentPlatform: value.platform || '' } };
}

function createContentSaver(pool) {
  return (value, recordedBy) => saveBuilderContent(pool, value, recordedBy);
}

module.exports = {
  FUNNEL, SQL, INVITE_FIELDS, toDashboard, loadDashboard, createDashboardLoader,
  validateContent, saveBuilderContent, createContentSaver,
};
