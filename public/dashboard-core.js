// Pure dashboard logic shared by the browser (window.DashboardCore) and Node
// (require). No DOM access, no I/O — safe to unit-test and to reuse on the
// server for aggregate-only roles.
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DashboardCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY_MS = 86400000;
  const BOGOTA_MS = 5 * 3600000;
  const ACTIVATION_DAYS = 14;
  const FOLLOW_UP_LIMIT = 5;
  const CHANNELS = Object.freeze([
    ['paid_media', 'Paid media (Gmail Ads)'],
    ['whatsapp', 'WhatsApp'],
    ['team_referral', 'Team referral link'],
    ['social', 'Social'],
    ['email', 'Email'],
    ['direct', 'Direct / no UTM'],
  ]);

  // Portal timestamps arrive as UTC text, ISO datetimes or epoch milliseconds.
  function parseUtc(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value >= 1e12 ? value : value * 1000;
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    if (/^\d{10}$/.test(raw)) return Number(raw) * 1000;
    if (/^\d{12,16}$/.test(raw)) return Number(raw);
    let iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += 'T00:00:00Z';
    else if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)) iso += 'Z';
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
  }

  // Calendar day in Colombia (UTC−5, no daylight saving).
  function bogotaDay(value) {
    const ms = parseUtc(value);
    if (ms == null) return '';
    return new Date(ms - BOGOTA_MS).toISOString().slice(0, 10);
  }

  function finiteOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function creditsGranted(used, remaining) {
    const u = finiteOrNull(used);
    const r = finiteOrNull(remaining);
    if (u == null && r == null) return null;
    return (u == null ? 0 : u) + (r == null ? 0 : r);
  }

  function creditsLoaded(value) {
    return value === true || value === 1 || String(value).trim().toLowerCase() === 'true';
  }

  function planTier(plan, planName, subscriptionStatus) {
    const code = String(plan || '').trim();
    const name = String(planName || '').trim();
    if (!code && !name) return '';
    const free = code.toLowerCase() === 'think-free' || name.toLowerCase() === 'think free';
    if (free) return 'free';
    if (String(subscriptionStatus || '').trim().toLowerCase() === 'active') return 'premium';
    return '';
  }

  function channelLabel(key) {
    const found = CHANNELS.find((row) => row[0] === key);
    return found ? found[1] : (key ? String(key) : '');
  }

  function eachDay(start, end) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return [];
    const [year, month, day] = start.split('-').map(Number);
    let cursor = Date.UTC(year, month - 1, day);
    const last = Date.parse(`${end}T00:00:00Z`);
    const out = [];
    while (cursor <= last && out.length < 400) {
      out.push(new Date(cursor).toISOString().slice(0, 10));
      cursor += DAY_MS;
    }
    return out;
  }

  // Days elapsed from a YYYY-MM-DD date (noon Bogotá) until the snapshot.
  function dayNumber(date, snapshotAt) {
    if (!date || !snapshotAt) return null;
    const start = new Date(`${date}T12:00:00-05:00`);
    const cutoff = new Date(snapshotAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(cutoff.getTime())) return null;
    return Math.max(0, Math.floor((cutoff - start) / DAY_MS));
  }

  function dayProgress(day) {
    if (day == null) return 0;
    return Math.min(100, Math.round(day / ACTIVATION_DAYS * 100));
  }

  function hasProject(builder) {
    return Number(builder && builder.projects) > 0;
  }

  function isPublished(builder) {
    return Boolean(builder && builder.contentUrl && builder.contentAt);
  }

  // Active = at least one real project AND published content (URL + date).
  function isActive(builder) {
    return hasProject(builder) && isPublished(builder);
  }

  function summarizeBuilders(builders, snapshotAt) {
    const list = Array.isArray(builders) ? builders : [];
    const granted = list.filter((b) => b.creditsGrantedAt);
    return {
      total: list.length,
      granted: granted.length,
      active: granted.filter(isActive).length,
      within14: granted.filter((b) => {
        const day = dayNumber(b.creditsGrantedAt, snapshotAt);
        return day != null && day < ACTIVATION_DAYS;
      }).length,
      missingContent: granted.filter((b) => hasProject(b) && !isPublished(b)).length,
      missingProject: granted.filter((b) => !hasProject(b)).length,
      withProject: list.filter(hasProject).length,
      ...recentActivity(list, snapshotAt),
    };
  }

  // Invitees only. Signed up = an invitee with a verified account (enrolled).
  // Pending while the invitation source is not available, so the UI never shows a fake 0.
  function referralSteps(invitations) {
    const inv = invitations && typeof invitations === 'object' ? invitations : {};
    const live = inv.available === true;
    const spec = [
      ['emailsSent', 'sent', null],
      ['delivered', 'delivered', 'emailsSent'],
      ['opened', 'opened', 'delivered'],
      ['inviteSignedUp', 'enrolled', 'opened'],
    ];
    return spec.map(([key, field, base]) => {
      const step = { key, source: 'invite', base, value: live ? (Number(inv[field]) || 0) : 0 };
      if (!live) step.pending = true;
      return step;
    });
  }

  function stepsByKey(funnel, keys) {
    const byKey = new Map((Array.isArray(funnel) ? funnel : []).map((s) => [s && s.key, s]));
    return keys.filter((key) => byKey.get(key)).map((key) => byKey.get(key));
  }

  // Developer Network members only, in order. Landing views are a different source
  // and are not a step here, so the rates stay inside one population.
  function productSteps(funnel) {
    return stepsByKey(funnel, ['dnSignedUp', 'accountCreated', 'accountVerified', 'creditsUsed']);
  }

  // HubSpot only. Never compared with PostHog sign-ups.
  function acquisitionSteps(funnel) {
    return stepsByKey(funnel, ['sessions', 'formSignups']);
  }

  // The 14 calendar days ending on the snapshot's Bogotá date, oldest first.
  function activityWindow(snapshotAt, days) {
    const count = typeof days === 'number' ? days : ACTIVATION_DAYS;
    const cutoff = new Date(snapshotAt);
    if (!snapshotAt || Number.isNaN(cutoff.getTime()) || count < 1) return [];
    const bogota = new Date(cutoff.getTime() - 5 * 3600000);
    const end = bogota.toISOString().slice(0, 10);
    const [year, month, day] = end.split('-').map(Number);
    const out = [];
    for (let i = count - 1; i >= 0; i -= 1) {
      out.push(new Date(Date.UTC(year, month - 1, day - i)).toISOString().slice(0, 10));
    }
    return out;
  }

  // Days the person actually used the tool. activeDays is the recorded set (sign-in or
  // project created). When that set has not been synced, the only known day is lastSignIn.
  // A sign-in count is never spread across the calendar.
  function workedDays(builder, windowDays) {
    const days = Array.isArray(windowDays) ? windowDays : [];
    const recorded = builder && Array.isArray(builder.activeDays);
    const known = new Set();
    if (recorded) {
      for (const value of builder.activeDays) {
        const day = String(value || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) known.add(day);
      }
    } else if (builder && /^\d{4}-\d{2}-\d{2}$/.test(String(builder.lastCreditUsedAt || ''))) {
      known.add(builder.lastCreditUsedAt);
    } else if (builder && /^\d{4}-\d{2}-\d{2}$/.test(String(builder.lastSignIn || ''))) {
      known.add(builder.lastSignIn);
    }
    return days.map((date) => ({ date, on: known.has(date) }));
  }

  // Confirmed accounts are members with t4e_verified_at. Active means that
  // t4e_last_credit_used_at falls on one of the last `days` Colombia calendar days.
  // A credit total is never spread across the calendar.
  function recentActivity(builders, snapshotAt, days) {
    const list = Array.isArray(builders) ? builders : [];
    const windowDays = activityWindow(snapshotAt, typeof days === 'number' ? days : 7);
    const accounts = list.filter((b) => b && b.verifiedAt);
    const active = windowDays.length
      ? accounts.filter((b) => workedDays(b, windowDays).some((day) => day.on)).length
      : null;
    const total = accounts.length;
    return {
      recentActive: active,
      recentAccounts: total,
      recentPercent: active == null || total === 0 ? null : Math.round(active / total * 100),
    };
  }

  function followUps(builders, limit) {
    const max = typeof limit === 'number' ? limit : FOLLOW_UP_LIMIT;
    return (Array.isArray(builders) ? builders : [])
      .filter((b) => b.creditsGrantedAt && !isActive(b))
      .slice(0, max);
  }

  function stagesOf(builders) {
    return [...new Set((Array.isArray(builders) ? builders : []).map((b) => b.stage).filter(Boolean))];
  }

  function filterBuilders(builders, criteria) {
    const opts = criteria || {};
    const needle = String(opts.search || '').trim().toLowerCase();
    const stage = opts.stage || 'all';
    const plan = opts.plan || 'all';
    return (Array.isArray(builders) ? builders : []).filter((b) => {
      if (stage !== 'all' && b.stage !== stage) return false;
      if (plan !== 'all' && b.plan !== plan) return false;
      const haystack = [b.id, b.channel, b.channelKey, b.refKey, b.email].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }

  // Conversion is computed only against a comparable base: the step named in `base` (same
  // source) or, for a person-level cross, its own baseValue. After the first step, a step
  // whose base is null gets conversion null with reason 'not_crossed', and a pending cross gets
  // reason 'pending'. Funnels without a `base` property keep the previous-step behaviour.
  // percentOfStart: share of the first step, null when the step comes from another source.
  // percentOfSource: share of the first step of the same source (bar width), or the cross rate.
  function funnelSteps(funnel) {
    const steps = Array.isArray(funnel) ? funnel : [];
    const valueOf = new Map(steps.map((s) => [s && s.key, Number(s && s.value) || 0]));
    const start = steps[0] || {};
    const first = Number(start.value) || 1;
    const sourceFirst = new Map();
    return steps.map((step, index) => {
      const value = Number(step.value) || 0;
      const legacy = !Object.prototype.hasOwnProperty.call(step, 'base');
      const baseKey = legacy ? (index ? steps[index - 1].key : null) : (step.base == null ? null : step.base);
      const hasBaseValue = typeof step.baseValue === 'number' && Number.isFinite(step.baseValue);
      const baseValue = baseKey === null ? null : (hasBaseValue ? step.baseValue : (valueOf.get(baseKey) || 0));
      let conversion = null;
      let reason = null;
      if (index > 0) {
        if (step.pending) reason = 'pending';
        else if (baseKey === null) reason = 'not_crossed';
        else conversion = Math.round(value / Math.max(1, baseValue) * 100);
      }
      const sameSource = legacy || !step.source || !start.source || step.source === start.source;
      let percentOfSource;
      if (step.source === 'cross') {
        percentOfSource = conversion === null ? 0 : Math.min(100, conversion);
      } else {
        const group = step.source || '';
        if (!sourceFirst.has(group)) sourceFirst.set(group, value);
        percentOfSource = Math.round(value / Math.max(1, sourceFirst.get(group)) * 100);
      }
      return {
        key: step.key,
        label: step.label,
        source: step.source || '',
        base: baseKey,
        baseValue,
        value,
        percentOfStart: sameSource ? Math.round(value / first * 100) : null,
        percentOfSource,
        conversion,
        reason,
      };
    });
  }

  // The close target counts Developer Network members (t4e_dn_origin), not verified accounts.
  function signupProgress(funnel, target) {
    const step = (Array.isArray(funnel) ? funnel : []).find((x) => x.key === 'dnSignedUp');
    const total = Number(step && step.value) || 0;
    const goal = Number(target) || 0;
    return { total, target: goal, percent: goal > 0 ? Math.min(100, Math.round(total / goal * 100)) : 0 };
  }

  function memberCards(builders) {
    const list = Array.isArray(builders) ? builders : [];
    return {
      signedUp: list.length,
      verified: list.filter((b) => b && b.verifiedAt).length,
      notOnBuilderList: list.filter((b) => b && b.origin && b.origin !== 'builder_list').length,
      paidMedia: list.filter((b) => b && b.channelKey === 'paid_media').length,
    };
  }

  function memberFunnel(builders) {
    const list = Array.isArray(builders) ? builders : [];
    return {
      dnSignedUp: list.length,
      accountCreated: list.filter((b) => b && (b.id || b.signedUpAt)).length,
      accountVerified: list.filter((b) => b && b.verifiedAt).length,
      creditsUsed: list.filter((b) => b && ((Number(b.creditsUsed) > 0) || b.lastCreditUsedAt)).length,
    };
  }

  // One builder row from a HubSpot member event. projects is null when no PostHog person matched.
  function shapeMember(input) {
    const src = input && typeof input === 'object' ? input : {};
    const a = src.attributes && typeof src.attributes === 'object' ? src.attributes : {};
    const planCode = String(a.plan || '').trim();
    const planName = String(a.plan_name || '').trim();
    const subscriptionStatus = String(a.subscription_status || '').trim();
    const signedUpAt = bogotaDay(a.signup_at);
    const verifiedAt = bogotaDay(a.verified_at);
    const lastCreditUsedAt = bogotaDay(a.last_credit_used_at);
    const fromEvent = /^\d{4}-\d{2}-\d{2}$/.test(String(src.eventOn || '')) ? String(src.eventOn) : '';
    const dnSignupAt = bogotaDay(a.dn_signup_at) || fromEvent;
    const channelKey = String(a.dn_channel || src.channel || '').trim();
    const creditsUsed = finiteOrNull(a.credits_used);
    const domain = String(src.domain || '').replace(/^@/, '');
    const projects = src.projects === undefined ? null : finiteOrNull(src.projects);
    return {
      id: String(a.user_id || '').trim(),
      recordId: String(src.id || ''),
      email: domain ? `@${domain}` : '',
      plan: planTier(planCode, planName, subscriptionStatus),
      planName,
      channel: channelLabel(channelKey),
      channelKey,
      origin: String(a.dn_origin || '').trim(),
      signedUpAt,
      verifiedAt,
      dnSignupAt,
      credits: creditsGranted(creditsUsed, finiteOrNull(a.credits_remaining)),
      creditsUsed,
      creditsPending: !creditsLoaded(a.dn_credits_loaded),
      projects,
      lastCreditUsedAt,
      activeDays: lastCreditUsedAt ? [lastCreditUsedAt] : [],
      subscriptionStatus,
    };
  }

  function signupDays(builders, snapshotAt) {
    const counts = new Map();
    for (const b of Array.isArray(builders) ? builders : []) {
      const day = String(b && b.dnSignupAt || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) counts.set(day, (counts.get(day) || 0) + 1);
    }
    if (!counts.size) return [];
    const known = [...counts.keys()].sort();
    const end = (activityWindow(snapshotAt, 1)[0]) || known[known.length - 1];
    const span = eachDay(known[0], end > known[known.length - 1] ? end : known[known.length - 1]);
    const days = span.length ? span : known;
    return days.map((date) => ({ date, count: counts.get(date) || 0 }));
  }

  function signupChannels(builders) {
    const counts = new Map();
    for (const b of Array.isArray(builders) ? builders : []) {
      const key = String(b && b.channelKey || '');
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({ key, label: channelLabel(key), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  // GA4 sessions on the Developer Network landing. HubSpot page analytics cannot split a page by UTM.
  function utmResults(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const matched = list.filter((row) => /developer-network/i.test(String(row && row.landing_page || '')));
    if (!matched.length) return { available: false, reason: list.length ? 'no_landing' : 'not_synced', rows: [] };
    const map = new Map();
    for (const row of matched) {
      const source = String(row.source || '(not set)');
      const medium = String(row.medium || '(not set)');
      const campaign = String(row.campaign || '(not set)');
      const key = `${source}\0${medium}\0${campaign}`;
      const prev = map.get(key) || { source, medium, campaign, sessions: 0 };
      prev.sessions += Number(row.sessions) || 0;
      map.set(key, prev);
    }
    const out = [...map.values()].filter((row) => row.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source) || a.campaign.localeCompare(b.campaign));
    return { available: out.length > 0, reason: out.length ? '' : 'no_landing', rows: out };
  }

  function channelBreakdown(builders) {
    const map = new Map();
    for (const b of Array.isArray(builders) ? builders : []) {
      const channel = b.channel || 'Unknown';
      if (!map.has(channel)) map.set(channel, { channel, total: 0, signedUp: 0, active: 0 });
      const entry = map.get(channel);
      entry.total += 1;
      if (b.signedUpAt) entry.signedUp += 1;
      if (isActive(b)) entry.active += 1;
    }
    return [...map.values()].sort((a, b) => b.total - a.total || a.channel.localeCompare(b.channel));
  }

  // Normalises a raw connection state from the snapshot (Spanish or English)
  // to connected | manual | pending | error | unknown. Never guesses.
  const SOURCE_STATES = Object.freeze({
    conectado: 'connected',
    conectada: 'connected',
    connected: 'connected',
    manual: 'manual',
    pendiente: 'pending',
    pending: 'pending',
    error: 'error',
  });

  function sourceState(raw) {
    const key = String(raw == null ? '' : raw).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(SOURCE_STATES, key) ? SOURCE_STATES[key] : 'unknown';
  }

  // overall: the person-level cross rate when the funnel has one (1 decimal); otherwise the
  // last step as % of the first, only when every step is comparable. null when unavailable.
  // largestDrop: the lowest step conversion vs its base, ignoring non-comparable steps and crosses.
  function funnelInsights(funnel) {
    const steps = funnelSteps(funnel);
    if (!steps.length) return { overall: null, overallKey: null, largestDrop: null };
    const cross = steps.filter((s) => s.source === 'cross' && s.conversion !== null).pop();
    let overall = null;
    let overallKey = null;
    if (cross) {
      overall = Math.round(cross.value / Math.max(1, cross.baseValue) * 1000) / 10;
      overallKey = cross.key;
    } else if (!steps.some((s) => s.source === 'cross') && steps.every((s) => s.percentOfStart !== null)) {
      const first = steps[0].value;
      const last = steps[steps.length - 1];
      overall = first > 0 ? Math.round(last.value / first * 1000) / 10 : null;
      overallKey = last.key;
    }
    let largestDrop = null;
    for (let i = 1; i < steps.length; i += 1) {
      const s = steps[i];
      if (s.conversion === null || s.source === 'cross') continue;
      if (largestDrop === null || s.conversion < largestDrop.conversion) {
        largestDrop = { from: s.base, to: s.key, conversion: s.conversion };
      }
    }
    return { overall, overallKey, largestDrop };
  }

  // One CSV cell. Neutralises spreadsheet formula injection (=, +, -, @, tab,
  // CR at the start of text) and quotes cells containing quotes, commas or
  // line breaks. Finite numbers are written as-is.
  function csvCell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  return Object.freeze({
    ACTIVATION_DAYS,
    FOLLOW_UP_LIMIT,
    dayNumber,
    dayProgress,
    hasProject,
    isPublished,
    isActive,
    summarizeBuilders,
    referralSteps,
    parseUtc,
    bogotaDay,
    creditsGranted,
    planTier,
    channelLabel,
    productSteps,
    acquisitionSteps,
    activityWindow,
    workedDays,
    recentActivity,
    memberCards,
    memberFunnel,
    shapeMember,
    signupDays,
    signupChannels,
    utmResults,
    followUps,
    stagesOf,
    filterBuilders,
    funnelSteps,
    signupProgress,
    channelBreakdown,
    sourceState,
    funnelInsights,
    csvCell,
  });
});
