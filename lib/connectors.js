'use strict';
// Server-side connectors for HubSpot, GA4 and PostHog. Each one runs only when its service
// variables exist, pulls the window LAUNCH_DATE..today and returns a load
// { source, from, to, metrics, events?, snapshots } that lib/metrics-repo.js stores in MySQL.
// Credentials live in the service variables (never in files or in the database).
// Emails are reduced to their domain.
const crypto = require('crypto');
const { normalizeEmail, hashKeyConfigured, emailHash, builderCode } = require('./email-hash');

const LAUNCH = process.env.LAUNCH_DATE || '2026-10-01';
const INTERNAL = (process.env.INTERNAL_DOMAINS || 'think4ever.com').split(',').map((d) => d.trim().toLowerCase());
const INTERNAL_COMPANIES = (process.env.INTERNAL_COMPANIES || 'think4ever,moadbus').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9 .-]{2,100}$/.test(s));
// Only these hosts are measured (landing, portal and main site). Editable through SITE_HOSTS
// without touching code. Values are reduced to bare host names and validated, so they are safe
// to embed in GA4 filters and HogQL.
const DEFAULT_SITE_HOSTS = ['think4ever.com', 'www.think4ever.com', 'go.think4ever.com', 'portal.think4ever.com'];
const parsedHosts = String(process.env.SITE_HOSTS || '').split(',')
  .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:?#].*$/, ''))
  .filter((h) => /^[a-z0-9.-]{1,253}$/.test(h));
const SITE_HOSTS = parsedHosts.length ? [...new Set(parsedHosts)] : DEFAULT_SITE_HOSTS;
// Executive PostHog account attribution follows the allowlist in the approved spec.
// Cell/preview hosts stay unclassified until Product confirms them explicitly.
const DEFAULT_POSTHOG_EXECUTIVE_HOSTS = ['portal.think4ever.com', 'think4ever.com', 'www.think4ever.com'];
const parsedExecutiveHosts = String(process.env.POSTHOG_EXECUTIVE_HOSTS || '').split(',')
  .map((h) => h.trim().toLowerCase())
  .filter((h) => /^[a-z0-9.-]{1,253}$/.test(h));
const POSTHOG_EXECUTIVE_HOSTS = [...new Set([...parsedExecutiveHosts, ...DEFAULT_POSTHOG_EXECUTIVE_HOSTS])];
// Host of a URL ('' when it is empty or not a URL). Accepts URLs without a scheme.
const hostOf = (u) => {
  const s = String(u || '').trim();
  if (!s) return '';
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase(); } catch { return ''; }
};
const onSite = (u) => SITE_HOSTS.includes(hostOf(u));
const today = () => new Date().toISOString().slice(0, 10);
const compact = (d) => d.replace(/-/g, '');

async function http(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

// Invitation states from HubSpot marketing emails (HUBSPOT_INVITE_EMAIL_IDS, needs the
// `content` scope). One row per recipient: sent, delivered, opened (extra), bounced (bounce or
// dropped), unsubscribed (unsubscribe or spam report) and replied (contact property
// hs_sales_email_last_replied after the first send). Recipients are keyed by the HMAC of their
// email, so the caller only runs this when EMAIL_HASH_KEY is set. No address is returned.
async function readInvitations(H, emailIds, from) {
  const campaigns = new Set();
  for (const id of emailIds) {
    const email = await http(`https://api.hubapi.com/marketing-emails/v1/emails/${id}`, { headers: H });
    const ids = Array.isArray(email.allEmailCampaignIds) && email.allEmailCampaignIds.length ? email.allEmailCampaignIds : [email.primaryEmailCampaignId];
    for (const c of ids) if (/^\d{1,20}$/.test(String(c || ''))) campaigns.add(String(c));
  }
  const byRecipient = new Map();
  const startTimestamp = String(Date.parse(`${from}T00:00:00Z`));
  for (const campaignId of campaigns) {
    let offset;
    let pages = 0;
    do {
      const qs = new URLSearchParams({ campaignId, limit: '1000', startTimestamp });
      if (offset) qs.set('offset', offset);
      const res = await http(`https://api.hubapi.com/email/public/v1/events?${qs}`, { headers: H });
      for (const ev of res.events || []) {
        const email = normalizeEmail(ev.recipient);
        if (!email) continue;
        const r = byRecipient.get(email) || { first: 0, sent: 0, delivered: 0, opened: 0, bounced: 0, unsubscribed: 0, replied: 0, company: '' };
        const type = String(ev.type || '').toUpperCase();
        const at = Number(ev.created) || 0;
        if (type === 'SENT') { r.sent = 1; if (at && (!r.first || at < r.first)) r.first = at; }
        else if (type === 'DELIVERED') r.delivered = 1;
        else if (type === 'OPEN' || type === 'CLICK') r.opened = 1;
        else if (type === 'BOUNCE' || type === 'DROPPED') r.bounced = 1;
        else if (type === 'SPAMREPORT') r.unsubscribed = 1;
        else if (type === 'STATUSCHANGE' && (String(ev.portalSubscriptionStatus || '').toUpperCase() === 'UNSUBSCRIBED' || /UNSUBSCRIBED/i.test(JSON.stringify(ev.subscriptions || [])))) r.unsubscribed = 1;
        byRecipient.set(email, r);
      }
      offset = res.hasMore && res.offset ? String(res.offset) : undefined;
      pages += 1;
    } while (offset && pages < 200);
  }
  const emails = [...byRecipient.keys()];
  for (let i = 0; i < emails.length; i += 100) {
    const part = emails.slice(i, i + 100);
    const res = await http('https://api.hubapi.com/crm/v3/objects/contacts/batch/read', {
      method: 'POST', headers: H,
      body: JSON.stringify({ idProperty: 'email', properties: ['email', 'company', 'hs_sales_email_last_replied'], inputs: part.map((id) => ({ id })) }),
    });
    for (const c of res.results || []) {
      const p = c.properties || {};
      const r = byRecipient.get(normalizeEmail(p.email));
      if (!r) continue;
      const replied = Date.parse(p.hs_sales_email_last_replied || '');
      if (Number.isFinite(replied) && (!r.first || replied >= r.first)) r.replied = 1;
      r.company = String(p.company || '');
    }
  }
  return emails.map((email) => {
    const r = byRecipient.get(email);
    const domain = email.split('@')[1] || '';
    const internal = INTERNAL.includes(domain) || INTERNAL_COMPANIES.some((name) => r.company.toLowerCase().includes(name));
    const hash = emailHash(email);
    return {
      id: hash, kind: 'invite', date: r.first ? new Date(r.first).toISOString().slice(0, 10) : '',
      email_hash: hash, domain, internal, domain_type: internal ? 'internal' : 'external',
      sent: r.sent, delivered: r.delivered, opened: r.opened, replied: r.replied, bounced: r.bounced, unsubscribed: r.unsubscribed,
    };
  }).filter((e) => e.id);
}

const SRC_LABEL = { direct: 'Direct', email: 'Email', other: 'Other campaigns', paid: 'Paid search', 'paid-social': 'Paid social', referrals: 'Referrals', social: 'Organic social', organic: 'Organic search', offline: 'Offline' };

const connectors = {
  async hubspot() {
    const H = { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' };
    const from = LAUNCH, to = today();
    // These custom contact properties are optional. Configure the list only
    // after the fields have been created in HubSpot; requesting a property that
    // does not exist makes the CRM search fail.
    const utmProperties = String(process.env.HUBSPOT_UTM_PROPERTIES || '')
      .split(',').map((v) => v.trim()).filter((v) => /^[a-zA-Z0-9_]{1,100}$/.test(v));
    const daily = await http(`https://api.hubapi.com/analytics/v2/reports/sources/daily?start=${compact(from)}&end=${compact(to)}`, { headers: H });
    const metrics = [];
    for (const [date, rows] of Object.entries(daily)) {
      for (const x of Array.isArray(rows) ? rows : []) {
        if (!x.breakdown) continue;
        const dim_value = SRC_LABEL[x.breakdown] || x.breakdown;
        for (const [metric, key] of [['sessions', 'visits'], ['new_visitors', 'visitors'], ['pageviews', 'rawViews'], ['bounces', 'bounces'], ['contacts', 'contacts']]) {
          if (x[key]) metrics.push({ metric, date, dim: 'source', dim_value, value: x[key] });
        }
      }
    }
    const baseProps = [
      'email', 'createdate', 'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
      'hs_latest_source', 'hs_latest_source_data_1', 'hs_latest_source_data_2',
      'ip_country', 'country', 'recent_conversion_event_name',
      'company',
      'hs_analytics_first_url', 'hs_analytics_last_url',
    ];
    const search = async (props) => {
    const events = [];
    let after;
    do {
      const body = {
        filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: String(Date.parse(from + 'T05:00:00Z')) }] }],
        properties: [...new Set(props)],
        limit: 100, after,
      };
      const res = await http('https://api.hubapi.com/crm/v3/objects/contacts/search', { method: 'POST', headers: H, body: JSON.stringify(body) });
      for (const c of res.results || []) {
        const p = c.properties || {};
        // Sign-ups count only when the contact's first visit, last visit or landing_page
        // was on one of SITE_HOSTS (landing or portal).
        const siteUrl = [p.hs_analytics_first_url, p.hs_analytics_last_url, p.landing_page].find(onSite);
        if (!siteUrl) continue;
        const domain = String(p.email || '').split('@')[1] || '';
        const internal = INTERNAL.includes(domain.toLowerCase()) || INTERNAL_COMPANIES.some((name) => String(p.company || '').toLowerCase().includes(name));
        events.push({
          id: String(c.id || ''),
          // HMAC of the normalized email (null without EMAIL_HASH_KEY): the person-level key
          // for the form -> verified account cross. The email itself is never returned.
          email_hash: emailHash(p.email),
          site_host: hostOf(siteUrl),
          kind: 'form_signup',
          date: String(p.createdate || '').slice(0, 10),
          form: String(p.recent_conversion_event_name || '').split(': ').pop(),
          channel: SRC_LABEL[String(p.hs_analytics_source || '').toLowerCase().replace('_', '-')] || p.hs_analytics_source || '',
          country: p.country || p.ip_country || '',
          internal,
          domain_type: internal ? 'internal' : domain ? 'external' : 'unknown',
          // These values are present when the landing writes the documented
          // hidden HubSpot fields and their names are set in HUBSPOT_UTM_PROPERTIES.
          utm_source: p.utm_source || '', utm_medium: p.utm_medium || '', utm_campaign: p.utm_campaign || '',
          utm_content: p.utm_content || '', utm_term: p.utm_term || '', landing_page: p.landing_page || '',
          // First-touch values (hidden fields first_utm_*): the dashboard prefers them for attribution.
          first_utm_source: p.first_utm_source || '', first_utm_medium: p.first_utm_medium || '',
          first_utm_campaign: p.first_utm_campaign || '', first_utm_content: p.first_utm_content || '',
          original_source: p.hs_analytics_source || '', original_source_detail: p.hs_analytics_source_data_1 || '',
          latest_source: p.hs_latest_source || '', latest_source_detail: p.hs_latest_source_data_1 || '',
        });
      }
      after = res.paging && res.paging.next && res.paging.next.after;
    } while (after);
    return events;
    };
    // A property listed in HUBSPOT_UTM_PROPERTIES that does not exist in HubSpot makes the search
    // fail. Retry once without the custom properties so the sign-up count keeps flowing.
    let events;
    let utmRead = utmProperties.includes('utm_source') && utmProperties.includes('utm_medium');
    try {
      events = await search([...baseProps, ...utmProperties]);
    } catch (e) {
      if (!utmProperties.length) throw e;
      console.warn('hubspot: contact search failed with HUBSPOT_UTM_PROPERTIES; retrying without them. Check that every listed property exists in HubSpot:', e.message);
      events = await search(baseProps);
      utmRead = false;
    }
    // Invitation emails: optional. A missing variable, key or scope never blocks the sign-up sync.
    const inviteIds = String(process.env.HUBSPOT_INVITE_EMAIL_IDS || '').split(',').map((v) => v.trim()).filter((v) => /^\d{1,20}$/.test(v));
    const inviteCoverage = { available: false, emails: inviteIds.length };
    if (!inviteIds.length) inviteCoverage.reason = 'HUBSPOT_INVITE_EMAIL_IDS is not configured.';
    else if (!hashKeyConfigured()) inviteCoverage.reason = 'EMAIL_HASH_KEY is not configured.';
    else {
      try {
        const invites = await readInvitations(H, inviteIds, from);
        events.push(...invites);
        inviteCoverage.available = true;
        inviteCoverage.recipients = invites.length;
      } catch (e) {
        console.warn('hubspot invitation emails skipped:', String(e.message || e).slice(0, 200));
        inviteCoverage.reason = 'Could not read the invitation email events (check the content scope and the email ids).';
      }
    }
    // The traffic report above has no domain filter in HubSpot's API: it covers the whole site.
    return {
      source: 'hubspot', from, to, metrics, events,
      snapshots: [
        { key: 'utm_capture', from, to, rows: [{ available: utmRead }] },
        { key: 'invite_coverage', from, to, rows: [inviteCoverage], note: 'Invitation states per recipient from HubSpot marketing emails. Replied = hs_sales_email_last_replied after the first send. Closed = bounced or unsubscribed without a reply.' },
      ],
      status: { state: 'connected', note: 'Tráfico: todo el sitio (sin filtro de dominio)' },
    };
  },

  async ga4() {
    // A malformed value must not echo the key material into logs or sync_runs.
    let sa;
    try { sa = JSON.parse(process.env.GA4_SERVICE_ACCOUNT); } catch { throw new Error('GA4_SERVICE_ACCOUNT is not valid JSON (paste the full service-account key file)'); }
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
    const tok = await http('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${sig}`,
    });
    const from = LAUNCH, to = today();
    // Every report is limited to SITE_HOSTS (landing, portal and main site).
    const hostFilter = { filter: { fieldName: 'hostName', inListFilter: { values: SITE_HOSTS, caseSensitive: false } } };
    const run = (body) => http(`https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA4_PROPERTY_ID}:runReport`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateRanges: [{ startDate: from, endDate: to }], limit: 10000, dimensionFilter: hostFilter, ...body }),
    });
    const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const addDays = (isoDate, n) => { const d = new Date(`${isoDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const metrics = [];
    const executiveSnapshots = [];
    // Sessions are additive across channels. totalUsers and newUsers are not: a person
    // in two channels is counted twice, and newUsers with a session channel can exceed sessions.
    const ch = await run({ dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }] });
    for (const r of ch.rows || []) {
      const [date, channel] = r.dimensionValues.map((v) => v.value);
      ['ga_sessions', 'ga_engaged_sessions'].forEach((m, i) => metrics.push({ metric: m, date: iso(date), dim: 'channel', dim_value: channel, value: Number(r.metricValues[i].value) }));
    }
    // Site-wide daily users. newUsers is one person on the day of their first visit, so a
    // later sum across days is the period total. totalUsers is only a per-day figure.
    try {
      const dailyUsers = await run({ dimensions: [{ name: 'date' }], metrics: [{ name: 'totalUsers' }, { name: 'newUsers' }] });
      for (const r of dailyUsers.rows || []) {
        const date = iso(r.dimensionValues[0].value);
        const [users, newUsers] = r.metricValues.map((v) => Number(v.value || 0));
        metrics.push({ metric: 'ga_users', date, value: users }, { metric: 'ga_new_users', date, value: newUsers });
      }
    } catch (e) {
      console.warn('ga4 daily users report skipped:', e.message);
    }
    const ev = await run({ dimensions: [{ name: 'date' }, { name: 'eventName' }], metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }] });
    for (const r of ev.rows || []) {
      const [date, name] = r.dimensionValues.map((v) => v.value);
      metrics.push({ metric: 'ga_event', date: iso(date), dim: 'event', dim_value: name, value: Number(r.metricValues[0].value) });
    }
    const co = await run({ dimensions: [{ name: 'country' }], metrics: [{ name: 'totalUsers' }, { name: 'engagedSessions' }, { name: 'keyEvents' }] });
    // The executive dashboard needs daily country rows, not only the aggregate
    // country snapshot above. Keep this separate from the global daily report so
    // a country selector never has to infer a user's country from a global total.
    let geo = { rows: [] };
    try {
      geo = await run({
        dimensions: [{ name: 'date' }, { name: 'country' }],
        metrics: [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'engagedSessions' }, { name: 'keyEvents' }],
      });
    } catch (e) {
      console.warn('ga4 daily country report skipped:', e.message);
    }
    for (const r of geo.rows || []) {
      const [date, country] = r.dimensionValues.map((v) => v.value);
      const [users, sessions, engaged, keyEvents] = r.metricValues.map((v) => Number(v.value || 0));
      metrics.push(
        { metric: 'ga_geo_users', date: iso(date), dim: 'country', dim_value: country, value: users },
        { metric: 'ga_geo_sessions', date: iso(date), dim: 'country', dim_value: country, value: sessions },
        { metric: 'ga_geo_engaged_sessions', date: iso(date), dim: 'country', dim_value: country, value: engaged },
        { metric: 'ga_geo_key_events', date: iso(date), dim: 'country', dim_value: country, value: keyEvents },
      );
    }
    // Executive v1 uses only the confirmed LATAM landing host. Keep this separate
    // from shared GA4 rows, whose hostName filter intentionally covers SITE_HOSTS.
    try {
      const goGeo = await run({
        dimensionFilter: { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: 'go.think4ever.com', caseSensitive: false } } },
        dimensions: [{ name: 'date' }, { name: 'country' }],
        metrics: [{ name: 'sessions' }],
      });
      const goRows = goGeo.rows || [];
      for (const r of goRows) {
        const [date, country] = r.dimensionValues.map((v) => v.value);
        metrics.push({ metric: 'ga_exec_geo_sessions', date: iso(date), dim: 'country', dim_value: country || '(not set)', value: Number(r.metricValues[0].value || 0) });
      }
      // Form starts stay on their own go-host report. A failure here must not
      // blank the landing-session coverage or the shared ga_event series.
      let formStartAvailable = false;
      let formStartReason = '';
      try {
        const goForm = await run({
          dimensionFilter: { andGroup: { expressions: [
            { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: 'go.think4ever.com', caseSensitive: false } } },
            { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'form_start' } } },
          ] } },
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'eventCount' }],
        });
        formStartAvailable = true;
        for (const r of goForm.rows || []) {
          const date = r.dimensionValues[0] && r.dimensionValues[0].value;
          if (!date) continue;
          metrics.push({ metric: 'ga_exec_form_starts', date: iso(date), value: Number(r.metricValues[0].value || 0) });
        }
      } catch (e) {
        console.warn('ga4 executive go-host form_start report skipped:', e.message);
        formStartReason = 'Sign-up form starts are not available for go.think4ever.com.';
      }
      executiveSnapshots.push({ key: 'executive_landing', from, to, rows: [{
        available: true, host: 'go.think4ever.com',
        country_available: goRows.some((r) => { const country = r.dimensionValues[1] && r.dimensionValues[1].value; return country && country !== '(not set)'; }),
        form_start_available: formStartAvailable,
        ...(formStartReason ? { form_start_reason: formStartReason } : {}),
      }] });
    } catch (e) {
      console.warn('ga4 executive go-host report skipped:', e.message);
      executiveSnapshots.push({ key: 'executive_landing', from, to, rows: [{ available: false, host: 'go.think4ever.com', country_available: false, form_start_available: false }] });
    }
    // Deduped user totals cannot be rebuilt by adding days. Store one snapshot for
    // launch through today, plus the fixed windows below. The dashboard groups
    // launch through today in the browser, so those windows are only a fallback.
    const totalNames = ['totalUsers', 'newUsers', 'sessions', 'engagedSessions', 'engagementRate', 'screenPageViews', 'eventCount', 'keyEvents'];
    const totalsSnapshot = async (start, end) => {
      const tot = await run({ dateRanges: [{ startDate: start, endDate: end }], metrics: totalNames.map((name) => ({ name })) });
      const t = (tot.rows && tot.rows[0] && tot.rows[0].metricValues.map((v) => Number(v.value))) || [];
      return { key: 'totals', from: start, to: end, rows: [{ users: t[0] || 0, new_users: t[1] || 0, sessions: t[2] || 0, engaged_sessions: t[3] || 0, engagement_rate: t[4] || 0, pageviews: t[5] || 0, events: t[6] || 0, key_events: t[7] || 0, subject_to_thresholding: !!(tot.metadata && tot.metadata.subjectToThresholding), user_counts_inconsistent: (t[1] || 0) > (t[0] || 0) }] };
    };
    const windows = new Map([[`${from}|${to}`, [from, to]]]);
    for (const n of [7, 14, 28, 30]) {
      const start = addDays(to, -(n - 1));
      const prevEnd = addDays(start, -1);
      windows.set(`${start}|${to}`, [start, to]);
      windows.set(`${addDays(prevEnd, -(n - 1))}|${prevEnd}`, [addDays(prevEnd, -(n - 1)), prevEnd]);
    }
    const totalSnaps = [];
    for (const [start, end] of windows.values()) {
      if (start === from && end === to) {
        totalSnaps.push(await totalsSnapshot(start, end));
        continue;
      }
      try { totalSnaps.push(await totalsSnapshot(start, end)); }
      catch (e) { console.warn(`ga4 totals ${start}..${end} skipped:`, e.message); }
    }
    // UTM attribution is deliberately a separate report: detailed dimensions
    // can have more rows than the headline reports, and a compatibility issue
    // must never prevent the normal GA4 sync from completing.
    let attributionRows = [];
    try {
      const attr = await run({
        dimensions: [
          { name: 'date' }, { name: 'sessionManualSource' }, { name: 'sessionManualMedium' },
          { name: 'sessionManualCampaignName' }, { name: 'sessionManualAdContent' },
          { name: 'landingPagePlusQueryString' }, { name: 'city' },
        ],
        metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'keyEvents' }],
        limit: 1000,
      });
      attributionRows = (attr.rows || []).map((r) => {
        const [date, source, medium, campaign, content, landing_page, city] = r.dimensionValues.map((v) => v.value || '(not set)');
        const [sessions, engaged_sessions, key_events] = r.metricValues.map((v) => Number(v.value || 0));
        return { date: iso(date), source, medium, campaign, content, landing_page, city, sessions, engaged_sessions, key_events };
      });
    } catch (e) {
      console.warn('ga4 UTM attribution report skipped:', e.message);
    }
    return {
      source: 'ga4', from, to, metrics,
      snapshots: [
        { key: 'countries', from, to, rows: (co.rows || []).map((r) => ({ country: r.dimensionValues[0].value, users: +r.metricValues[0].value, engaged_sessions: +r.metricValues[1].value, key_events: +r.metricValues[2].value })) },
        ...executiveSnapshots,
        ...totalSnaps,
        { key: 'utm_attribution', from, to, note: 'GA4 sessions by UTM, landing page and city. (not set) means the visit arrived without that value.', rows: attributionRows },
      ],
    };
  },

  async posthog() {
    const host = process.env.POSTHOG_HOST.replace(/\/$/, '');
    const q = (sql, filters) => http(`${host}/api/projects/${process.env.POSTHOG_PROJECT_ID}/query/`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.POSTHOG_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql, ...(filters ? { filters } : {}) } }),
    });
    const from = LAUNCH, to = today();
    const metrics = [];
    // This is the authoritative product event Product must emit from the
    // backend. Unlike the Action below, it confirms a project was created.
    const configuredEvent = String(process.env.POSTHOG_PROJECT_CREATED_EVENT || 'project_created');
    const projectEvent = /^[A-Za-z0-9_.$:-]{1,120}$/.test(configuredEvent) ? configuredEvent : 'project_created';
    // Domain filter: events on SITE_HOSTS. Backend events carry no $host (they come from the
    // portal), so an empty host is kept. People count only with a real visit on SITE_HOSTS.
    const hostList = SITE_HOSTS.map((h) => `'${h}'`).join(', ');
    const hostExpr = `lower(coalesce(toString(properties.$host), ''))`;
    const onSiteSql = `(${hostExpr} IN (${hostList}) OR ${hostExpr} = '')`;
    // New people are read from their events on SITE_HOSTS (person.* fields, one count per person).
    // PostHog rejects a persons query with an events subquery, so this avoids that join.
    const siteEvents = `timestamp >= toDate('${from}') AND ${hostExpr} IN (${hostList}) AND person.created_at >= toDate('${from}')`;
    const emailExpr = `lower(coalesce(toString(person.properties.email), ''))`;
    const companyExpr = `lower(coalesce(toString(person.properties.company), ''))`;
    const internalRules = [
      ...INTERNAL.filter((d) => /^[a-z0-9.-]+$/.test(d)).map((d) => `endsWith(${emailExpr}, '@${d}')`),
      ...INTERNAL_COMPANIES.map((c) => `position(${companyExpr}, '${c}') > 0`),
    ];
    const internalSql = internalRules.length ? `(${internalRules.join(' OR ')})` : 'false';
    const accountType = `CASE WHEN ${internalSql} THEN 'Internal' WHEN ${emailExpr} != '' OR ${companyExpr} != '' THEN 'External' ELSE 'Unknown' END`;
    const notInternal = `NOT ${internalSql}`;
    // registration_started is the funnel step before account creation; it is not the dashboard's sign-up total.
    // Count the first registration start per person since launch and aggregate country separately.
    let registrationReady = false;
    try {
      const reg = await q(`SELECT toString(toDate(first_at)) AS d, account_type, country, count() AS n FROM (SELECT person_id, min(timestamp) AS first_at, ${accountType} AS account_type, coalesce(nullIf(toString(person.properties.country), ''), nullIf(toString(person.properties.$geoip_country), ''), '') AS country FROM events WHERE event = 'registration_started' AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1) AND (${onSiteSql} OR endsWith(${hostExpr}, '.portal.think4ever.com')) AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1') AND {filters} GROUP BY person_id, account_type, country) GROUP BY d, account_type, country ORDER BY d`,
        { filterTestAccounts: true, dateRange: { date_from: from, date_to: to } });
      const daily = new Map(), geo = new Map();
      for (const [d, type, country, n] of reg.results || []) {
        const dailyKey = `${d}|${type}`;
        daily.set(dailyKey, { metric: 'ph_signups', date: d, dim: 'account_type', dim_value: type, value: (daily.get(dailyKey)?.value || 0) + Number(n) });
        if (country) {
          const metric = type === 'Internal' ? 'ph_signups_geo_internal' : 'ph_signups_geo', key = `${metric}|${d}|${country}`;
          geo.set(key, { metric, date: d, dim: 'country', dim_value: country, value: (geo.get(key)?.value || 0) + Number(n) });
        }
      }
      metrics.push(...daily.values(), ...geo.values()); registrationReady = true;
    } catch (e) { console.warn('posthog registration report skipped:', e.message); }
    // Account creation = the person's FIRST identify (the dashboard's sign-up definition). People
    // created before launch are excluded, so a returning user who identifies again is never counted twice.
    // registration_started stays above as the funnel step before the account.
    let accountsReady = false;
    let accountGeo = new Map();
    try {
      const acc = await q(`SELECT toString(toDate(first_at)) AS d, account_type, country, count() AS n FROM (SELECT person_id,
          min(timestamp) AS first_at,
          argMin(${accountType}, tuple(timestamp, uuid)) AS account_type,
          argMin(coalesce(nullIf(toString(properties.$geoip_country_name), ''), nullIf(toString(properties.$geoip_country), ''), nullIf(toString(person.properties.country), ''), nullIf(toString(person.properties.$geoip_country), ''), ''), tuple(timestamp, uuid)) AS country
        FROM events WHERE event = '$identify' AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1)
          AND person.created_at >= toDate('${from}') AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1')
        GROUP BY person_id) GROUP BY d, account_type, country ORDER BY d`);
      const accDaily = new Map(); accountGeo = new Map();
      for (const [d, type, country, n] of acc.results || []) {
        const dailyKey = `${d}|${type}`;
        accDaily.set(dailyKey, { metric: 'ph_accounts', date: d, dim: 'account_type', dim_value: type, value: (accDaily.get(dailyKey)?.value || 0) + Number(n) });
        if (country) {
          const metric = type === 'Internal' ? 'ph_accounts_geo_internal' : 'ph_accounts_geo', key = `${metric}|${d}|${country}`;
          accountGeo.set(key, { metric, date: d, dim: 'country', dim_value: country, value: (accountGeo.get(key)?.value || 0) + Number(n) });
        }
      }
      metrics.push(...accDaily.values(), ...accountGeo.values()); accountsReady = true;
    } catch (e) { console.warn('posthog accounts (first identify) report skipped:', e.message); }
    // Account lifecycle (the KB definition): the sign-up target counts account_verified, the first
    // event per person since launch, without internal people, qa_probe events or project test
    // accounts. account_created is the step before it; registration_started stays above.
    const configuredCredits = String(process.env.POSTHOG_CREDITS_EVENT || 'credits_granted');
    const creditsEvent = /^[A-Za-z0-9_.$:-]{1,120}$/.test(configuredCredits) ? configuredCredits : 'credits_granted';
    const lifecycleFilters = { filterTestAccounts: true, dateRange: { date_from: from, date_to: to } };
    const lifecycle = {
      created_available: false, verified_available: false, roster_available: false, unit: 'person',
      credits_event: creditsEvent, credits_available: false, email_hash: hashKeyConfigured(),
    };
    const firstEventPerPerson = async (eventName, metric) => {
      const res = await q(`SELECT toString(toDate(first_at)) AS d, account_type, count() AS n FROM (SELECT person_id, min(timestamp) AS first_at, argMin(${accountType}, tuple(timestamp, uuid)) AS account_type FROM events WHERE event = '${eventName}' AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1) AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1') AND {filters} GROUP BY person_id) GROUP BY d, account_type ORDER BY d`, lifecycleFilters);
      const rows = new Map();
      for (const [d, type, n] of res.results || []) {
        const key = `${d}|${type}`;
        rows.set(key, { metric, date: d, dim: 'account_type', dim_value: type, value: (rows.get(key)?.value || 0) + Number(n) });
      }
      metrics.push(...rows.values());
    };
    try { await firstEventPerPerson('account_created', 'ph_accounts_created'); lifecycle.created_available = true; }
    catch (e) { console.warn('posthog account_created report skipped:', e.message); }
    try { await firstEventPerPerson('account_verified', 'ph_accounts_verified'); lifecycle.verified_available = true; }
    catch (e) { console.warn('posthog account_verified report skipped:', e.message); }
    // One row per verified person (the Builders roster). The email is read only to compute its
    // HMAC (EMAIL_HASH_KEY) and its domain; the address itself never leaves this function.
    // The builder code comes from a hash of the PostHog person id, so it never changes.
    const builderEvents = [];
    const dayOf = (v) => { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= '2000-01-01' ? s : ''; };
    try {
      const roster = await q(`SELECT toString(person_id) AS pid,
          any(${emailExpr}) AS email,
          argMax(${accountType}, tuple(timestamp, uuid)) AS account_type,
          toString(minIf(timestamp, event = 'account_created')) AS created_at,
          toString(minIf(timestamp, event = 'account_verified')) AS verified_at,
          toString(minIf(timestamp, event = '${projectEvent}')) AS first_project_at,
          countIf(event = '${projectEvent}') AS projects,
          countIf(event = 'signed_in') AS sign_ins,
          toString(maxIf(timestamp, event = 'signed_in')) AS last_sign_in,
          toString(minIf(timestamp, event = '${creditsEvent}')) AS credits_at
        FROM events
        WHERE event IN ('account_created', 'account_verified', '${projectEvent}', 'signed_in', '${creditsEvent}')
          AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1)
          AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1') AND {filters}
        GROUP BY person_id
        HAVING countIf(event = 'account_verified') > 0
        LIMIT 5001`, lifecycleFilters);
      const rows = Array.isArray(roster.results) ? roster.results : [];
      if (roster.hasMore === true || rows.length >= 5000) throw new Error('builder roster reached its result safety limit');
      for (const [pid, email, type, createdAt, verifiedAt, firstProjectAt, projects, signIns, lastSignIn, creditsAt] of rows) {
        if (String(type) === 'Internal') continue;
        const id = crypto.createHash('sha256').update(`posthog-person:${pid}`).digest('hex');
        const normalized = normalizeEmail(email);
        const credits = dayOf(creditsAt);
        if (credits) lifecycle.credits_available = true;
        builderEvents.push({
          id, kind: 'builder', date: dayOf(verifiedAt),
          email_hash: emailHash(normalized), domain: normalized ? normalized.split('@')[1] : '',
          internal: false, domain_type: String(type) === 'External' ? 'external' : 'unknown',
          code: builderCode(id), created_at: dayOf(createdAt), verified_at: dayOf(verifiedAt),
          first_project_at: dayOf(firstProjectAt), projects: Number(projects) || 0, sign_ins: Number(signIns) || 0,
          last_sign_in: dayOf(lastSignIn), credits_granted_at: credits,
        });
      }
      lifecycle.roster_available = true;
      lifecycle.builders = builderEvents.length;
    } catch (e) { console.warn('posthog builder roster skipped:', e.message); }
    // Executive accounts are separate from the shared ph_accounts metric: use the
    // country GeoIP on each person's earliest identify event and only certify
    // hosts in the PDF allowlist. Cell/hostless accounts are surfaced as excluded
    // aggregates until Product classifies them; no IDs or profile data are stored.
    let executiveAccountsReady = false;
    let executiveAccountsReason = '';
    let executivePlanReady = false;
    let executivePlanReason = '';
    let executivePlanAttempted = false;
    const executivePlanCounts = { free: 0, paid: 0, other: 0, unknown: 0 };
    let executiveExternalAccounts = 0;
    const executiveTotalByDate = new Map(), executiveGeoByDate = new Map(), excludedExecutiveHosts = new Map();
    try {
      const executiveAcc = await q(`SELECT toString(toDate(first_at)) AS d, account_type, country, first_host, count() AS n FROM (
        SELECT person_id, min(timestamp) AS first_at,
          argMin(${accountType}, tuple(timestamp, uuid)) AS account_type,
          argMin(coalesce(nullIf(toString(properties.$geoip_country_name), ''), ''), tuple(timestamp, uuid)) AS country,
          argMin(${hostExpr}, tuple(timestamp, uuid)) AS first_host
        FROM events
        WHERE event = '$identify' AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1)
          AND person.created_at >= toDate('${from}')
          AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1') AND {filters}
        GROUP BY person_id
      ) GROUP BY d, account_type, country, first_host ORDER BY d LIMIT 5001`,
      { filterTestAccounts: true, dateRange: { date_from: from, date_to: to } });
      const executiveRows = Array.isArray(executiveAcc.results) ? executiveAcc.results : [];
      if (executiveAcc.hasMore === true || executiveRows.length >= 5000) {
        executiveAccountsReason = 'Executive first-identify query reached its result safety limit; the report is incomplete.';
      } else {
        for (const [d, type, countryValue, hostValue, rawCount] of executiveRows) {
          if (String(type || '').toLowerCase() !== 'external') continue;
          const count = Number(rawCount);
          if (!Number.isFinite(count) || count <= 0) continue;
          const hostName = String(hostValue || '').toLowerCase();
          if (!POSTHOG_EXECUTIVE_HOSTS.includes(hostName)) {
            const key = hostName || '(not set)';
            excludedExecutiveHosts.set(key, (excludedExecutiveHosts.get(key) || 0) + count);
            continue;
          }
          executiveTotalByDate.set(d, (executiveTotalByDate.get(d) || 0) + count);
          const country = String(countryValue || '').trim();
          if (!country || country.toLowerCase() === '(not set)') continue;
          const key = `${d}|${country}`;
          executiveGeoByDate.set(key, (executiveGeoByDate.get(key) || 0) + count);
        }
        executiveExternalAccounts = [...executiveTotalByDate.values()].reduce((sum, value) => sum + value, 0);
        for (const [date, value] of executiveTotalByDate) metrics.push({ metric: 'ph_exec_accounts', date, dim: 'account_type', dim_value: 'External', value });
        for (const [key, value] of executiveGeoByDate) {
          const [date, country] = key.split('|');
          metrics.push({ metric: 'ph_exec_accounts_geo', date, dim: 'country', dim_value: country, value });
        }
        executiveAccountsReady = true;
      }
    } catch (e) {
      executiveAccountsReason = 'Executive first-identify query failed; the report is unavailable.';
      console.warn('posthog Executive account report skipped:', e.message);
    }
    // Plan events show the last plan reported by the portal, not authoritative billing status.
    // Keep the plan field configurable; don't assume that event payloads carry a current plan.
    const planProperty = String(process.env.POSTHOG_PLAN_PROPERTY || '').trim();
    if (planProperty && /^[A-Za-z0-9_]{1,80}$/.test(planProperty) && executiveAccountsReady) try {
      executivePlanAttempted = true;
      const executiveHostList = POSTHOG_EXECUTIVE_HOSTS.map((name) => `'${name}'`).join(', ');
      const planSql = `SELECT plan, count() AS n FROM (
        SELECT person_id, argMaxIf(nullIf(lower(toString(properties.${planProperty})), ''), tuple(timestamp, uuid), nullIf(toString(properties.${planProperty}), '') IS NOT NULL) AS plan
        FROM events WHERE event IN ('signed_in','plan_changed')
          AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1)
          AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1')
          AND person.created_at >= toDate('${from}') AND {filters}
          AND lower(${accountType}) = 'external'
          AND person_id IN (SELECT person_id FROM events
            WHERE event = '$identify' AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1)
              AND person.created_at >= toDate('${from}') AND ${hostExpr} IN (${executiveHostList})
              AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1') AND {filters}
            GROUP BY person_id)
        GROUP BY person_id
      ) GROUP BY plan ORDER BY plan`;
      const report = await q(planSql, { filterTestAccounts: true, dateRange: { date_from: from, date_to: to } });
      const values = { free: 0, paid: 0, other: 0, unknown: 0 };
      for (const [rawPlan, rawCount] of report.results || []) {
        const plan = String(rawPlan || '').trim().toLowerCase();
        const count = Number(rawCount);
        if (!Number.isFinite(count) || count < 0) continue;
        if (plan === 'free' || plan === 'paid') values[plan] += count;
        else if (!plan || plan === '(not set)') values.unknown += count;
        else values.other += count;
      }
      const reportedPlanAccounts = Object.values(values).reduce((sum, count) => sum + count, 0);
      if (reportedPlanAccounts > executiveExternalAccounts) {
        throw new Error('Plan-event cohort exceeds approved-host account coverage.');
      }
      executivePlanCounts.free = values.free;
      executivePlanCounts.paid = values.paid;
      executivePlanCounts.other = values.other;
      // Accounts without signed_in/plan_changed events have no current observation;
      // count them as unknown, never as free.
      executivePlanCounts.unknown = executiveExternalAccounts - values.free - values.paid - values.other;
      executivePlanReady = true;
    } catch (e) {
      executivePlanReason = 'Could not read the last reported plan for approved-host accounts.';
      console.warn('posthog plan report skipped:', e.message);
    }
    const ev = await q(`SELECT toString(toDate(timestamp)) AS d, event, count() AS n FROM events WHERE timestamp >= toDate('${from}') AND event NOT LIKE '$%' AND (${onSiteSql} OR event = '${projectEvent}') GROUP BY d, event ORDER BY d LIMIT 5000`);
    for (const [d, event, n] of ev.results || []) metrics.push({ metric: 'ph_event', date: d, dim: 'event', dim_value: event, value: n });
    const pv = await q(`SELECT toString(toDate(timestamp)) AS d, ${accountType} AS account_type, count(DISTINCT person_id) AS n FROM events WHERE timestamp >= toDate('${from}') AND ${onSiteSql} GROUP BY d, account_type ORDER BY d`);
    for (const [d, type, n] of pv.results || []) metrics.push({ metric: 'ph_active_users', date: d, dim: 'account_type', dim_value: type, value: n });
    const np = await q(`SELECT toString(toDate(person.created_at)) AS d, ${accountType} AS account_type, count(DISTINCT person_id) AS n FROM events WHERE ${siteEvents} GROUP BY d, account_type ORDER BY d`);
    for (const [d, type, n] of np.results || []) metrics.push({ metric: 'ph_new_persons', date: d, dim: 'account_type', dim_value: type, value: n });
    let geoReady = false;
    // Per-country sign-ups, ready for when the PostHog GeoIP enrichment (or a country property
    // sent by the product) exists. Wrapped: without the enrichment the property is null and the
    // query returns no rows, so the sync is unaffected.
    // The product's own 'country' person property wins; PostHog GeoIP is the fallback.
    try {
      const geo = await q(`SELECT coalesce(nullIf(toString(person.properties.country), ''), nullIf(toString(person.properties.$geoip_country), '')) AS c, toString(toDate(person.created_at)) AS d, ${accountType} AS account_type, count(DISTINCT person_id) AS n FROM events WHERE ${siteEvents} GROUP BY c, d, account_type HAVING c IS NOT NULL ORDER BY d LIMIT 2000`);
      const totals = new Map();
      for (const [c, d, type, n] of geo.results || []) if (c) {
        const metric = type === 'Internal' ? 'ph_new_persons_geo_internal' : 'ph_new_persons_geo';
        const key = `${metric}|${c}|${d}`;
        if (totals.has(key)) totals.get(key).value += Number(n);
        else totals.set(key, { metric, date: d, dim: 'country', dim_value: c, value: Number(n) });
      }
      metrics.push(...totals.values()); geoReady = true;
    } catch (e) { console.warn('posthog country report skipped:', e.message); }
    // New people by first-touch UTM (sent by the portal in posthog.identify; the web SDK's
    // $initial_utm_* is the fallback). Optional: a failure leaves the rest of the sync intact.
    let signupAttribution = null;
    try {
      const u = (k) => `coalesce(nullIf(toString(person.properties.${k}), ''), nullIf(toString(person.properties.$initial_${k}), ''), '(not set)')`;
      const sa = await q(`SELECT toString(toDate(person.created_at)) AS d, ${u('utm_source')} AS source, ${u('utm_medium')} AS medium, ${u('utm_campaign')} AS campaign, ${u('utm_content')} AS content, ${accountType} AS account_type, count(DISTINCT person_id) AS n FROM events WHERE ${siteEvents} GROUP BY d, source, medium, campaign, content, account_type ORDER BY d LIMIT 2000`);
      signupAttribution = (sa.results || []).map(([date, source, medium, campaign, content, type, n]) => ({ date, source, medium, campaign, content, account_type: type, people: Number(n) }));
    } catch (e) { console.warn('posthog sign-up attribution report skipped:', e.message); }

    // Temporary activation proxy: the PostHog Action owns the UI matching
    // rules (currently "Proyecto creado (clic)"). Count each person on their
    // first matching action within the dashboard period. The Action remains a
    // click does not confirm that a project was created server-side.
    const actionId = Number(process.env.POSTHOG_ACTIVATION_ACTION_ID || 407660);
    let activationReady = false;
    if (Number.isInteger(actionId) && actionId > 0) try {
      // This dashboard is a launch-period readout. Searching every event since
      // 2020 merely to find a person's lifetime first click can time out on a
      // large PostHog project. Restrict the Action scan to LAUNCH_DATE..today.
      const activated = await q(
        `SELECT toString(toDate(first_at)) AS d, count() AS n FROM (SELECT person_id, min(timestamp) AS first_at FROM events WHERE timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1) AND matchesAction(${actionId}) AND ${onSiteSql} AND ${notInternal} AND {filters} GROUP BY person_id) GROUP BY d ORDER BY d`,
        { filterTestAccounts: true, dateRange: { date_from: from, date_to: to } },
      );
      for (const [d, n] of activated.results || []) metrics.push({ metric: 'ph_activated_users', date: d, dim: 'action', dim_value: String(actionId), value: n });
      activationReady = true;
    } catch (e) {
      // Do not discard all PostHog metrics if this optional click proxy is slow.
      console.warn('posthog activation Action report skipped:', e.message);
    }
    // project_created (projectEvent, defined above) is never domain-filtered.
    let projectAttribution = [];
    // Property-level aggregation is expensive in HogQL. Do not run it against
    // a project that has not yet deployed the real backend event.
    if (process.env.POSTHOG_PROJECT_CREATED_ENABLED === '1') try {
      const projects = await q(`SELECT
          toString(toDate(timestamp)) AS d,
          coalesce(nullIf(toString(properties.utm_source), ''), '(not set)') AS source,
          coalesce(nullIf(toString(properties.utm_medium), ''), '(not set)') AS medium,
          coalesce(nullIf(toString(properties.utm_campaign), ''), '(not set)') AS campaign,
          coalesce(nullIf(toString(properties.utm_content), ''), '(not set)') AS content,
          coalesce(nullIf(toString(properties.landing_page), ''), '(not set)') AS landing_page,
          count() AS projects_created,
          count(DISTINCT person_id) AS people
        FROM events
        WHERE event = '${projectEvent}' AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1)
        GROUP BY d, source, medium, campaign, content, landing_page
        ORDER BY d LIMIT 1000`);
      projectAttribution = (projects.results || []).map(([date, source, medium, campaign, content, landing_page, projects_created, people]) => ({
        date, source, medium, campaign, content, landing_page, projects_created: Number(projects_created), people: Number(people),
      }));
      for (const r of projectAttribution) metrics.push({ metric: 'ph_projects_created', date: r.date, dim: 'campaign', dim_value: r.campaign, value: r.projects_created });
    } catch (e) {
      console.warn('posthog project attribution report skipped:', e.message);
    }
    const executiveCountryAssigned = [...executiveGeoByDate.values()].reduce((sum, value) => sum + value, 0);
    const excludedHostRows = [...excludedExecutiveHosts].map(([host, external_accounts]) => ({ host, external_accounts })).sort((a, b) => b.external_accounts - a.external_accounts);
    const executiveExcludedHostAccounts = excludedHostRows.reduce((sum, row) => sum + row.external_accounts, 0);
    const snapshots = [
      { key: 'account_coverage', from, to, rows: [{ available: accountsReady, event: '$identify', unit: 'person', country_available: accountsReady && [...accountGeo.values()].some((row) => row.metric === 'ph_accounts_geo' && row.value > 0) }], note: 'Account created = first $identify per person since launch (person created on or after launch). Internal accounts are split by email domain and company.' },
      { key: 'executive_accounts', from, to, rows: [{
        available: executiveAccountsReady, event: '$identify', unit: 'external_person',
        country_available: executiveAccountsReady && executiveCountryAssigned > 0,
        external_accounts: executiveExternalAccounts, country_assigned: executiveCountryAssigned,
        country_missing: Math.max(0, executiveExternalAccounts - executiveCountryAssigned),
        allowed_hosts: POSTHOG_EXECUTIVE_HOSTS, excluded_host_accounts: executiveExcludedHostAccounts,
        excluded_hosts: excludedHostRows,
        ...(executiveAccountsReason ? { reason: executiveAccountsReason } : {}),
        ...(executiveExcludedHostAccounts ? { reason: 'Unclassified first-identify hosts are excluded from the certified Executive total.' } : {}),
        ...(!executiveAccountsReady && !executiveAccountsReason ? { reason: 'Executive first-identify query unavailable.' } : {}),
      }] },
      { key: 'executive_plan_accounts', from, to, rows: [{
        available: executivePlanReady,
        last_reported_plan: executivePlanCounts,
        semantics: 'last_observed_plan_from_signed_in_or_plan_changed_not_verified_billing_status',
        ...(executivePlanReason ? { reason: executivePlanReason } : {}),
        ...(!planProperty ? { reason: 'POSTHOG_PLAN_PROPERTY is not configured.' } : {}),
        ...(planProperty && !executivePlanAttempted && !executiveAccountsReady ? { reason: 'Approved-host account coverage is unavailable.' } : {}),
      }] },
      { key: 'registration_coverage', from, to, rows: [{ available: registrationReady, event: 'registration_started', unit: 'person', country_available: registrationReady }], note: 'Registration started = first registration_started per person since launch (the step before account_created). qa_probe and project test accounts excluded.' },
      { key: 'account_lifecycle', from, to, rows: [lifecycle], note: 'Sign-up target = first account_verified per person since launch; account_created is the prior step. Internal, qa_probe and test accounts excluded. Builders = verified people with a pseudonymous code; emails kept only as HMAC hash and domain.' },
      { key: 'people_coverage', from, to, rows: [{ available: true, classified: true, country_available: geoReady }], note: 'New observed people, not verified registrations. Unknown means no email/company classification.' },
      { key: 'activation_action', from, to, rows: [{ available: activationReady, action_id: actionId, internal_excluded: true }], note: 'First create-project click since launch, not confirmed creation or seven-day activation.' },
      {
      key: 'project_attribution', from, to,
      note: `Confirmed ${projectEvent} events by UTM. Rows appear after Product sends the event with these properties.`,
      rows: projectAttribution,
    }];
    if (signupAttribution) snapshots.push({ key: 'signup_attribution', from, to, note: 'New people by first-touch UTM and Internal/External/Unknown class; not verified sign-ups.', rows: signupAttribution });
    return { source: 'posthog', from, to, metrics, events: builderEvents, snapshots };
  },
};

// Variables each connector needs before it runs. Optional tuning variables are listed in
// lib/sources-catalog.js and the README.
const REQUIRED = Object.freeze({
  hubspot: ['HUBSPOT_TOKEN'],
  ga4: ['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT'],
  posthog: ['POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY'],
});
const configured = (key) => Object.prototype.hasOwnProperty.call(REQUIRED, key) && REQUIRED[key].every((v) => process.env[v]);

module.exports = { connectors, configured, REQUIRED, SITE_HOSTS };
