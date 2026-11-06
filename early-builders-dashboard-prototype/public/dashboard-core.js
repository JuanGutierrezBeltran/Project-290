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

  // percentOfStart: share of the first step; conversion: vs previous step (null for the first).
  function funnelSteps(funnel) {
    const steps = Array.isArray(funnel) ? funnel : [];
    const first = Number(steps[0] && steps[0].value) || 1;
    return steps.map((step, index) => {
      const value = Number(step.value) || 0;
      const prior = index ? Number(steps[index - 1].value) || 0 : first;
      return {
        key: step.key,
        label: step.label,
        value,
        percentOfStart: Math.round(value / first * 100),
        conversion: index ? Math.round(value / Math.max(1, prior) * 100) : null,
      };
    });
  }

  function signupProgress(funnel, target) {
    const step = (Array.isArray(funnel) ? funnel : []).find((x) => x.key === 'signedUp');
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

  return Object.freeze({
    ACTIVATION_DAYS,
    FOLLOW_UP_LIMIT,
    dayNumber,
    dayProgress,
    hasProject,
    isPublished,
    isActive,
    summarizeBuilders,
    followUps,
    stagesOf,
    filterBuilders,
    funnelSteps,
    signupProgress,
    channelBreakdown,
  });
});
