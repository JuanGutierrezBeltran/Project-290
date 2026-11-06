'use strict';

// Thin controller: loads api/dashboard (real snapshot only, never a fallback),
// maps 401/403/503/5xx to the state screens, runs the hash router, applies
// role-based navigation, language, period toast and refresh.
(function () {
  const EB = window.EB;
  const Core = window.DashboardCore;
  const { i18n, ui } = EB;
  const t = i18n.t;
  const T = (key, vars) => ui.esc(t(key, vars));

  const VIEW_KEYS = ['overview', 'builders', 'invitations', 'sources'];
  const PERIODS = ['all', '30d', '14d', '7d'];
  const LS_PERIOD = 't4_period';

  const state = { mode: 'loading', info: null, data: null, view: 'overview', period: 'all', attempts: [], loading: false };
  try {
    const saved = localStorage.getItem(LS_PERIOD);
    if (PERIODS.includes(saved)) state.period = saved;
  } catch (e) { /* ignore */ }

  const shell = ui.$('#app-shell');
  const fullPage = ui.$('#full-page');
  const viewRoot = ui.$('#view-root');
  const refreshBtn = ui.$('#refresh-btn');

  function allowedViews() {
    const views = state.data && state.data.access && state.data.access.views;
    return Array.isArray(views) ? VIEW_KEYS.filter((v) => views.includes(v)) : ['overview'];
  }
  function canView(view) { return allowedViews().includes(view); }

  async function load() {
    if (state.loading) return false;
    state.loading = true;
    const stamp = new Date();
    try {
      let res;
      try {
        res = await fetch('api/dashboard', { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
      } catch (e) {
        return fail(null, 'network', stamp);
      }
      if (res.status === 401) { show('signin', await res.json().catch(() => ({}))); return false; }
      if (res.status === 403) { show('forbidden'); return false; }
      if (res.status === 503) { show('notConfigured'); return false; }
      if (!res.ok) return fail(res.status, 'http', stamp);
      let payload;
      try { payload = await res.json(); } catch (e) { return fail(res.status, 'malformed', stamp); }
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.funnel) || !payload.program) return fail(res.status, 'malformed', stamp);
      state.data = payload;
      state.attempts.push({ time: stamp, ok: true, text: '200 OK' });
      show('ready');
      return true;
    } finally {
      state.loading = false;
    }
  }

  // Records a builder's published content. Relative URL (runs under the proxy prefix).
  async function saveContent(code, payload) {
    let res;
    try {
      res = await fetch(`api/builders/${encodeURIComponent(code)}/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return { ok: false, status: 0, error: 'network', fields: [] };
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, status: res.status, content: body.content };
    return { ok: false, status: res.status, error: body.error || 'http', fields: Array.isArray(body.fields) ? body.fields : [] };
  }

  function fail(status, reason, stamp) {
    state.attempts.push({ time: stamp, ok: false, text: status ? `HTTP ${status}` : t('es.network') });
    state.data = null;
    show('unavailable', { status, reason });
    return false;
  }

  function show(mode, info) {
    state.mode = mode;
    state.info = info || null;
    render();
  }

  function setLang(lang) {
    i18n.setLang(lang);
    render();
  }

  function setTitle(key) {
    const title = t(key);
    ui.$('#page-title').textContent = title;
    ui.$('#page-crumb').textContent = title;
    document.title = `${title} · Early Builders · Think4Ever`;
  }

  function renderChrome() {
    const data = state.data;
    const visible = data ? allowedViews() : VIEW_KEYS;
    ui.$$('.nav-item[data-view]').forEach((a) => {
      const view = a.dataset.view;
      a.hidden = !visible.includes(view);
      const active = state.mode === 'ready' && view === state.view;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    const access = data && data.access;
    const label = access ? access.label || access.role : '—';
    const accessText = access ? t(`access.${access.recordAccess}`) : t('common.readonly');
    ui.$('#user-name').textContent = label;
    ui.$('#user-access').textContent = accessText;
    ui.$('#mobile-access').textContent = accessText;
    ui.$('#user-avatar').textContent = access ? ui.nameInitials(label) : '·';
    ui.$('#profile-ini').textContent = access ? ui.nameInitials(label) : '·';
    ui.$('#profile-name').textContent = label;

    const snap = data ? ui.dateTime(data.snapshotAt) : null;
    const snapEl = ui.$('#snap-value');
    snapEl.textContent = snap || '—';
    snapEl.classList.toggle('is-empty', !snap);

    ui.$('#nav-builders-count').textContent = data && data.summary ? ui.num(data.summary.total) : '–';

    const foot = ui.$('#foot-status');
    foot.classList.toggle('ok', Boolean(data));
    ui.$('#foot-status-text').textContent = t(data ? 'foot.ok' : 'foot.bad');
  }

  function syncControls() {
    ui.$('#period-select').value = state.period;
    ui.$('#lang-select').value = i18n.getLang();
    ui.$('#lang-select-mobile').value = i18n.getLang();
  }

  function render() {
    document.documentElement.lang = i18n.getLang();
    i18n.translate(document);
    syncControls();

    const fullModes = { signin: EB.states.signIn, forbidden: EB.states.forbidden, notConfigured: EB.states.notConfigured };
    if (fullModes[state.mode]) {
      shell.hidden = true;
      fullPage.hidden = false;
      // The 4th argument lets the sign-in screen reload the dashboard after a
      // successful password login (POST auth/password-login sets the cookie).
      fullModes[state.mode](fullPage, state.info || {}, setLang, load);
      document.title = 'Early Builders · Think4Ever';
      return;
    }
    fullPage.hidden = true;
    fullPage.innerHTML = '';
    shell.hidden = false;

    if (state.mode === 'loading') {
      renderChrome();
      setTitle('nav.overview');
      viewRoot.innerHTML = `<div class="loading-block" aria-busy="true"><div class="skeleton w-40"></div><div class="skeleton w-100"></div><div class="skeleton w-70"></div><p class="text-muted small">${T('common.loading')}</p></div>`;
      return;
    }
    if (state.mode === 'unavailable') {
      renderChrome();
      setTitle('es.title');
      EB.states.unavailable(viewRoot, Object.assign({}, state.info, { attempts: state.attempts }), load);
      return;
    }

    const requested = location.hash.replace(/^#/, '');
    const allowed = allowedViews();
    let view = requested;
    if (!allowed.includes(view)) {
      view = allowed[0] || 'overview';
      if (requested !== view) history.replaceState(null, '', `#${view}`);
    }
    state.view = view;
    renderChrome();
    const module = EB.views[view];
    setTitle(module.titleKey);
    module.render(viewRoot, {
      data: state.data,
      t,
      T,
      ui,
      Core,
      canView,
      saveContent,
      reload: load,
      periodLabel: t(`period.${state.period}`),
    });
  }

  window.addEventListener('hashchange', () => {
    if (state.mode === 'ready') { render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });

  ui.$('#lang-select').addEventListener('change', (e) => setLang(e.target.value));
  ui.$('#lang-select-mobile').addEventListener('change', (e) => setLang(e.target.value));

  ui.$('#period-select').addEventListener('change', (e) => {
    if (!PERIODS.includes(e.target.value)) return;
    state.period = e.target.value;
    try { localStorage.setItem(LS_PERIOD, state.period); } catch (err) { /* ignore */ }
    ui.toast(t('toast.period.t'), t('toast.period.x'));
    if (state.mode === 'ready') render();
  });

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.setAttribute('aria-busy', 'true');
    const ok = await load();
    refreshBtn.disabled = false;
    refreshBtn.removeAttribute('aria-busy');
    if (ok) ui.toast(t('toast.refresh.t'), t('toast.refresh.x'));
  });

  ui.$('#toast-close').addEventListener('click', ui.hideToast);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ui.hideToast(); });

  render();
  load();
})();
