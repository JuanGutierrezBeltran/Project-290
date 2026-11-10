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
  const ACTIVATION_DAYS = 14;
  const FOLLOW_UP_LIMIT = 5;

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

  // PostHog only, in order. "Has a project" is verified people with at least one project.
  function productSteps(funnel, summary) {
    const steps = stepsByKey(funnel, ['registrationStarted', 'accountCreated', 'accountVerified']);
    steps.push({
      key: 'withProject',
      source: 'posthog',
      base: 'accountVerified',
      value: Number(summary && summary.withProject) || 0,
    });
    return steps;
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
    } else if (builder && /^\d{4}-\d{2}-\d{2}$/.test(String(builder.lastSignIn || ''))) {
      known.add(builder.lastSignIn);
    }
    return days.map((date) => ({ date, on: known.has(date) }));
  }

  // Accounts are people with a verified sign-up. Active means they signed in or
  // created a project on one of the last `days` calendar days. The count is never
  // guessed from a sign-in total.
  function recentActivity(builders, snapshotAt, days) {
    const list = Array.isArray(builders) ? builders : [];
    const windowDays = activityWindow(snapshotAt, typeof days === 'number' ? days : 7);
    const accounts = list.filter((b) => b && b.signedUpAt);
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
    return (Array.isArray(builders) ? builders : []).filter((b) => {
      if (stage !== 'all' && b.stage !== stage) return false;
      const haystack = [b.id, b.refKey, b.email].filter(Boolean).join(' ').toLowerCase();
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

  // The close target counts verified accounts (account_verified, first per person).
  function signupProgress(funnel, target) {
    const step = (Array.isArray(funnel) ? funnel : []).find((x) => x.key === 'accountVerified');
    const total = Number(step && step.value) || 0;
    const goal = Number(target) || 0;
    return { total, target: goal, percent: goal > 0 ? Math.min(100, Math.round(total / goal * 100)) : 0 };
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
    productSteps,
    acquisitionSteps,
    activityWindow,
    workedDays,
    recentActivity,
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
