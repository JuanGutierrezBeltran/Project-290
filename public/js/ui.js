// Shared UI helpers: escaping, formatting (America/Bogota), pills, inline SVG
// icons, toast and small reusable blocks. Exposes window.EB.ui.
(function (root) {
  'use strict';
  const EB = root.EB = root.EB || {};
  const t = (key, vars) => EB.i18n.t(key, vars);
  const TZ = 'America/Bogota';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => ESC[c]);
  }
  const $ = (sel, scope) => (scope || document).querySelector(sel);
  const $$ = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));

  function locale() { return EB.i18n.getLang() === 'es' ? 'es-CO' : 'en-US'; }

  function num(value) {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(locale());
  }

  function dateTime(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return `${new Intl.DateTimeFormat(locale(), { timeZone: TZ, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)} COT`;
  }

  function shortDate(ymd) {
    if (!ymd) return null;
    const d = new Date(`${ymd}T12:00:00-05:00`);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(locale(), { timeZone: TZ, day: '2-digit', month: 'short' }).format(d);
  }

  function clock(date) {
    const d = date instanceof Date ? date : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function dash() {
    return `<span class="nd">—</span><span class="nd-label">${esc(t('common.nodata'))}</span>`;
  }

  // Stage values arrive in Spanish from the snapshot.
  const STAGE_KEYS = { 'Activo': 'active', 'En progreso': 'progress', 'Inscrito': 'enrolled', 'Invitado': 'invited' };
  const STAGE_PILL = { active: 'pill-success', progress: 'pill-lime', enrolled: 'pill-neutral', invited: 'pill-neutral' };
  const STAGE_COLOR = { active: 'c-success', progress: 'c-lime', enrolled: 'c-secondary', invited: 'c-neutral' };
  const STAGE_ORDER = { invited: 1, enrolled: 2, progress: 3, active: 4 };

  function stageKey(stage) { return Object.prototype.hasOwnProperty.call(STAGE_KEYS, stage) ? STAGE_KEYS[stage] : 'other'; }
  function stageLabel(stage) { const k = stageKey(stage); return k === 'other' ? String(stage || '—') : t(`stage.${k}`); }
  function stageOrder(stage) { return STAGE_ORDER[stageKey(stage)] || 9; }
  function stageColor(stage) { return STAGE_COLOR[stageKey(stage)] || 'c-neutral'; }

  function pill(cls, text) { return `<span class="pill ${cls}"><span class="dot"></span>${esc(text)}</span>`; }
  function stagePill(stage) { return pill(STAGE_PILL[stageKey(stage)] || 'pill-neutral', stageLabel(stage)); }

  const SOURCE_PILL = { connected: 'pill-success', manual: 'pill-warning', pending: 'pill-neutral', error: 'pill-error', unknown: 'pill-neutral' };
  function sourcePill(state) { return pill(SOURCE_PILL[state] || 'pill-neutral', t(`state.${state}`)); }

  function funnelLabel(step) {
    const key = `funnel.${step.key}`;
    const label = t(key);
    return label === key ? (step.label || step.key || '—') : label;
  }

  // Step conversion text: '—' for the first step, the reason when the step is not comparable.
  function funnelRate(step, index) {
    if (!index) return '—';
    if (step.conversion === null || step.conversion === undefined) {
      if (step.reason === 'pending') return t('f.pending');
      if (step.reason === 'not_crossed') return t('f.notCrossed');
      return '—';
    }
    return `${step.conversion}%`;
  }

  function initials(text) {
    const clean = String(text || '').replace(/[^A-Za-z0-9]/g, '');
    return (clean.slice(-2) || '·').toUpperCase();
  }
  function nameInitials(text) {
    const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '·';
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  }

  const ICONS = {
    overview: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
    builders: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    invitations: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    sources: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flask: '<path d="M9 3h6"/><path d="M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    sort: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
    sortUp: '<path d="m18 15-6-6-6 6"/>',
    sortDown: '<path d="m6 9 6 6 6-6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    cube: '<path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01"/><path d="M6 17h.01"/>',
    trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
    coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/>',
    bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    logo: '<path d="M4 6h16M12 6v14M7 14l5 6 5-6"/>'
  };

  function icon(name, cls) {
    return `<svg class="ico${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
  }

  let toastTimer = null;
  function hideToast() {
    const el = $('#toast');
    if (!el) return;
    el.classList.remove('show');
    el.setAttribute('aria-hidden', 'true');
  }
  function toast(title, text) {
    const el = $('#toast');
    if (!el) return;
    $('#toast-title').textContent = title;
    $('#toast-text').textContent = text;
    el.classList.add('show');
    el.setAttribute('aria-hidden', 'false');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5200);
  }

  function restrictedCard() {
    return `<section class="card restricted-card" role="note">
      <span class="restricted-icon">${icon('lock')}</span>
      <div><h2 class="card-title">${esc(t('restricted.title'))}</h2><p>${esc(t('restricted.text'))}</p></div>
    </section>`;
  }

  function channelTable(channels) {
    const rows = (Array.isArray(channels) ? channels : []).map((c) => `<tr>
      <td class="td-id">${esc(c.channel)}</td>
      <td class="td-num mono">${esc(num(c.sessions))}</td>
      <td class="td-num mono">${esc(num(c.contacts))}</td></tr>`).join('');
    return `<section class="card table-card channel-card">
      <div class="card-header"><div><h2 class="card-title">${esc(t('channels.title'))}</h2><div class="card-sub">${esc(t('channels.sub'))}</div></div></div>
      <div class="table-scroll"><table class="compact-table">
        <thead><tr><th scope="col">${esc(t('channels.channel'))}</th><th scope="col" class="td-num">${esc(t('channels.sessions'))}</th><th scope="col" class="td-num">${esc(t('channels.contacts'))}</th></tr></thead>
        <tbody>${rows || `<tr class="empty-row"><td colspan="3">${dash()}</td></tr>`}</tbody>
      </table></div>
    </section>`;
  }

  EB.ui = Object.freeze({
    esc, $, $$, num, dateTime, shortDate, clock, dash, pill, stagePill, stageLabel, stageKey, stageOrder, stageColor,
    sourcePill, funnelLabel, funnelRate, initials, nameInitials, icon, toast, hideToast, restrictedCard, channelTable
  });
})(window);
