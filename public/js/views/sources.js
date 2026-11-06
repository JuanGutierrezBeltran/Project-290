// Data sources: summary + coverage bar, state filter, one card per source
// from the real snapshot, go-live checklist, state mapping and the server
// environment variable names (names only, never values).
(function (root) {
  'use strict';
  const EB = root.EB = root.EB || {};
  EB.views = EB.views || {};

  const st = { filter: 'all' };
  const FILTERS = ['all', 'connected', 'pending', 'error'];
  const CREDENTIAL_HINT = /token|key|clave|secret|cuenta de servicio|service account/i;

  function slug(name) {
    return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
  }
  function splitNeeds(needs) {
    return String(needs || '').split(/\s\+\s|;\s*/).map((s) => s.trim()).filter(Boolean);
  }

  function cardHtml(s, ctx) {
    const { ui, T } = ctx;
    const esc = ui.esc;
    const needs = splitNeeds(s.needs);
    const chips = needs.map((n) => `<li class="${CREDENTIAL_HINT.test(n) ? 'lock' : ''}">${ui.icon(CREDENTIAL_HINT.test(n) ? 'lock' : 'list')}${esc(n)}</li>`).join('');
    return `<li class="src-card${s.st === 'connected' ? ' is-connected' : ''}" data-state="${s.st}">
      <div class="src-top"><span class="src-ico">${ui.icon('sources')}</span><div><h3 class="src-name">${esc(s.name || '—')}</h3><div class="src-key">source/${esc(slug(s.name))}</div></div>${ui.sourcePill(s.st)}</div>
      <p class="src-desc">${s.purpose ? esc(s.purpose) : ui.dash()}</p>
      <dl class="src-facts">
        <dt>${T('src.fact.method')}</dt><dd>${s.method ? esc(s.method) : ui.dash()}</dd>
        <dt>${T('src.fact.sync')}</dt><dd class="mono">${s.lastSync ? esc(s.lastSync) : ui.dash()}</dd>
        <dt>${T('src.fact.needs')}</dt><dd>${chips ? `<ul class="needs">${chips}</ul>` : ui.dash()}</dd>
      </dl>
      <div class="src-foot"><span>${T('src.raw')}: ${esc(s.state || '—')}</span><span>${esc(ctx.t('src.req', { n: needs.length }))}</span></div>
    </li>`;
  }

  function renderCards(page, list, ctx) {
    const items = list.filter((s) => st.filter === 'all' || s.st === st.filter);
    page.querySelector('#src-cards').innerHTML = items.length
      ? items.map((s) => cardHtml(s, ctx)).join('')
      : `<li class="src-empty">${ctx.ui.icon('filter')}${ctx.T(list.length ? 'src.empty' : 'src.none')}</li>`;
    page.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === st.filter)));
  }

  function render(el, ctx) {
    const { data, T, ui, Core } = ctx;
    const esc = ui.esc;
    const list = (Array.isArray(data.sources) ? data.sources : []).map((s) => Object.assign({}, s, { st: Core.sourceState(s.state) }));
    const count = { connected: 0, manual: 0, pending: 0, error: 0, unknown: 0 };
    list.forEach((s) => { count[s.st] += 1; });
    const n = list.length;
    const needs = list.filter((s) => s.st !== 'connected').reduce((sum, s) => sum + splitNeeds(s.needs).length, 0);
    const w = (k) => (n ? count[k] / n * 100 : 0).toFixed(2);
    const seg = FILTERS.map((f) => `<button type="button" class="seg-btn" data-filter="${f}" aria-pressed="false"><span>${T(f === 'all' ? 'src.f.all' : `state.${f}`)}</span><span class="n">${f === 'all' ? n : count[f]}</span></button>`).join('');
    const gl = [1, 2, 3, 4].map((i) => `<li class="gl-item"><span class="gl-num">0${i}</span><div><div class="gl-title">${T(`gl.${i}.t`)}</div><p class="gl-desc">${T(`gl.${i}.d`)}</p></div>${i <= 2 ? ui.pill('pill-success', ctx.t('gl.done')) : ui.pill('pill-neutral', ctx.t('gl.planned'))}</li>`).join('');
    const map = [['Conectado', 'connected'], ['Pendiente', 'pending'], ['Error', 'error'], ['—', 'unknown']]
      .map(([raw, k]) => `<div class="legend-row"><span class="legend-raw">${esc(raw)}</span>${ui.icon('arrowRight', 'arrow')}${ui.sourcePill(k)}<span class="legend-note">${T(`lg.${k}`)}</span></div>`).join('');

    el.innerHTML = `<div class="src-page">
      <div class="src-intro"><p class="page-lede">${T('src.lede')}</p></div>
      <section class="src-summary">
        <div class="src-stat">
          <div class="src-stat-head"><span class="stat-label">${T('src.sum.connected')}</span>${ui.icon('plug')}</div>
          <div class="stat-value hero">${count.connected}<small>/${n}</small></div>
          <div class="src-stat-foot">${T('src.sum.connected.f')}</div>
          <div class="cov-bar" role="img" aria-label="${T('src.cov.aria')}"><span class="c-ok" style="width:${w('connected')}%"></span><span class="c-pen" style="width:${w('pending')}%"></span><span class="c-man" style="width:${w('error')}%"></span></div>
          <div class="cov-legend" aria-hidden="true"><span><i class="c-ok"></i>${T('state.connected')}</span><span><i class="c-pen"></i>${T('state.pending')}</span><span><i class="c-man"></i>${T('state.error')}</span></div>
        </div>
        <div class="src-stat"><div class="src-stat-head"><span class="stat-label">${T('src.sum.error')}</span>${ui.icon('alert')}</div><div class="stat-value">${count.error}</div><div class="src-stat-foot">${T('src.sum.error.f')}</div></div>
        <div class="src-stat"><div class="src-stat-head"><span class="stat-label">${T('src.sum.pending')}</span>${ui.icon('clock')}</div><div class="stat-value">${count.pending}</div><div class="src-stat-foot">${T('src.sum.pending.f')}</div></div>
        <div class="src-stat"><div class="src-stat-head"><span class="stat-label">${T('src.sum.needs')}</span>${ui.icon('list')}</div><div class="stat-value">${needs}</div><div class="src-stat-foot">${T('src.sum.needs.f')}</div></div>
      </section>
      <section aria-labelledby="src-grid-title">
        <div class="src-section-head"><div><h2 id="src-grid-title">${T('src.grid.title')}</h2><p>${T('src.grid.sub')}</p></div><div class="seg" role="group" aria-label="${T('src.filter.aria')}">${seg}</div></div>
        <ul class="src-grid" id="src-cards" aria-live="polite"></ul>
      </section>
      <div class="src-lower">
        <section class="card" aria-labelledby="gl-title">
          <div class="card-header"><div><h2 class="card-title" id="gl-title">${T('gl.title')}</h2><div class="card-sub">${T('gl.sub')}</div></div>${ui.icon('check', 'muted-ico')}</div>
          <ol class="golive-list">${gl}</ol>
        </section>
        <div class="side-stack">
          <section class="card"><div class="card-header"><div><h2 class="card-title">${T('lg.title')}</h2><div class="card-sub">${T('lg.sub')}</div></div></div><div class="legend-rows">${map}</div></section>
          <section class="card"><div class="card-header"><div><h2 class="card-title">${T('env.title')}</h2><div class="card-sub">${T('env.sub')}</div></div>${ui.icon('lock', 'muted-ico')}</div>
            <div class="code-block"><span class="tok-c"># Service variables — server only, never in code</span>
<span class="tok-c"># HubSpot</span>
<span class="tok-k">HUBSPOT_TOKEN</span>=<span class="tok-s">"…"</span>
<span class="tok-k">HUBSPOT_UTM_PROPERTIES</span>=<span class="tok-s">"…"</span> <span class="tok-c"># optional</span>
<span class="tok-c"># Google Analytics 4</span>
<span class="tok-k">GA4_PROPERTY_ID</span>=<span class="tok-s">"…"</span>
<span class="tok-k">GA4_SERVICE_ACCOUNT</span>=<span class="tok-s">"…"</span> <span class="tok-c"># key JSON</span>
<span class="tok-c"># PostHog</span>
<span class="tok-k">POSTHOG_HOST</span>=<span class="tok-s">"…"</span>
<span class="tok-k">POSTHOG_PROJECT_ID</span>=<span class="tok-s">"…"</span>
<span class="tok-k">POSTHOG_API_KEY</span>=<span class="tok-s">"…"</span>
<span class="tok-c"># Sync (optional)</span>
<span class="tok-k">LAUNCH_DATE</span>=<span class="tok-s">"…"</span>
<span class="tok-k">SITE_HOSTS</span>=<span class="tok-s">"…"</span>
<span class="tok-k">SYNC_INTERVAL_HOURS</span>=<span class="tok-s">"…"</span></div>
            <p class="helper-text">${T('env.note')}</p>
          </section>
        </div>
      </div>
    </div>`;

    const page = el.querySelector('.src-page');
    page.querySelector('.seg').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      st.filter = btn.dataset.filter;
      renderCards(page, list, ctx);
    });
    renderCards(page, list, ctx);
  }

  EB.views.sources = Object.freeze({ titleKey: 'nav.sources', render });
})(window);
