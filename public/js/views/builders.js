// Builders list: stats, stage distribution filter, search + stage filter,
// sortable columns, empty state and CSV export of role-visible fields.
// Aggregate-only roles get a restricted panel (+ channels when provided).
(function (root) {
  'use strict';
  const EB = root.EB = root.EB || {};
  EB.views = EB.views || {};

  // Same order as the server allowlist; only fields actually present in the
  // payload are exported, so the CSV never contains more than the role receives.
  const FIELD_ORDER = ['id', 'email', 'profile', 'city', 'refKey', 'channel', 'stage', 'invitedAt', 'signedUpAt', 'creditsGrantedAt', 'credits', 'lastSignIn', 'signIns', 'projects', 'creditsUsed', 'contentUrl', 'contentAt', 'contentPlatform'];
  const st = { q: '', stage: 'all', sort: { key: 'id', dir: 'asc' } };

  function sortValue(b, key, ui) {
    if (key === 'stage') return ui.stageOrder(b.stage);
    const v = b[key];
    if (v === '' || v === null || v === undefined) return null;
    return typeof v === 'number' ? v : String(v);
  }

  function visibleRows(ctx) {
    const rows = ctx.Core.filterBuilders(ctx.data.builders, { search: st.q, stage: st.stage });
    const dir = st.sort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const x = sortValue(a, st.sort.key, ctx.ui);
      const y = sortValue(b, st.sort.key, ctx.ui);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
  }

  function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }

  // The server decides (role editContent); the browser only hides the button.
  function canEdit(ctx) {
    return Boolean(ctx.data.access && ctx.data.access.canEditContent) && typeof ctx.saveContent === 'function';
  }

  function rowHtml(b, ctx) {
    const { ui, Core, t } = ctx;
    const esc = ui.esc;
    const credits = Number(b.credits) || 0;
    let creditCell;
    if (credits > 0) {
      const used = Number(b.creditsUsed) || 0;
      const p = Math.min(100, pct(used, credits));
      creditCell = `<div class="bl-credits"><div class="bl-credits-num">${esc(ui.num(used))} <span>/ ${esc(ui.num(credits))}</span></div><div class="bl-credit-bar" role="img" aria-label="${p}%"><i class="${p >= 85 ? 'hi' : ''}" style="width:${p}%"></i></div></div>`;
    } else {
      creditCell = `<div class="right">${ui.dash()}</div>`;
    }
    const hasActivity = Boolean(b.signedUpAt) || Number(b.signIns) > 0;
    const activityCell = hasActivity
      ? `<div class="bl-act"><span title="${esc(t('bl.projects'))}">${ui.icon('cube')}${esc(ui.num(b.projects || 0))}</span><span title="${esc(t('bl.signins'))}">${ui.icon('login')}${esc(ui.num(b.signIns || 0))}</span></div><div class="bl-last">${esc(t('bl.last'))} ${esc(b.lastSignIn || '—')}</div>`
      : `<div class="right">${ui.dash()}</div>`;
    const published = Core.isPublished(b);
    const safeUrl = /^https?:\/\//i.test(String(b.contentUrl || '')) ? b.contentUrl : '';
    let contentCell = published
      ? `${ui.pill('pill-success', t('st.published'))}<div class="bl-sub mono">${esc(b.contentAt)}${b.contentPlatform ? ` · ${esc(b.contentPlatform)}` : ''}</div>${safeUrl ? `<a class="bl-link" href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('bl.content.open'))}</a>` : ''}`
      : ui.pill('pill-neutral', t('st.pending'));
    if (canEdit(ctx)) {
      contentCell += `<div><button type="button" class="btn btn-ghost btn-sm bl-content-btn" data-action="content" data-code="${esc(b.id)}">${ui.icon('file')}<span>${esc(t(published ? 'bl.content.edit' : 'bl.content.add'))}</span></button></div>`;
    }
    return `<tr>
      <td><div class="bl-id"><span class="bl-initials" aria-hidden="true">${esc(ui.initials(b.id))}</span><div><div class="bl-id-main">${esc(b.id)}</div>${b.email ? `<div class="bl-email">${esc(b.email)}</div>` : ''}</div></div></td>
      <td><div class="bl-profile">${esc(b.profile || '—')}</div>${b.city ? `<div class="bl-sub">${esc(b.city)}</div>` : ''}</td>
      <td>${ui.stagePill(b.stage)}</td>
      <td class="mono td-meta">${b.signedUpAt ? esc(b.signedUpAt) : ui.dash()}</td>
      <td class="td-num">${creditCell}</td>
      <td class="td-num">${activityCell}</td>
      <td>${contentCell}</td>
      <td><div class="bl-ref">${esc(b.refKey || '—')}</div><div class="bl-sub">${esc(b.channel || '—')}</div></td>
    </tr>`;
  }

  function sortHeader(key, labelKey, ctx, cls) {
    return `<th scope="col"${cls ? ` class="${cls}"` : ''} data-sort="${key}" aria-sort="none"><button type="button" class="bl-sort" data-sort-key="${key}"><span>${ctx.T(labelKey)}</span><span class="bl-sort-ico"></span></button></th>`;
  }

  function update(page, ctx) {
    const { ui, T, t } = ctx;
    const rows = visibleRows(ctx);
    const tbody = page.querySelector('#builders-tbody');
    tbody.innerHTML = rows.length
      ? rows.map((b) => rowHtml(b, ctx)).join('')
      : `<tr class="empty-row bl-empty"><td colspan="8"><div class="bl-empty-box"><span class="bl-empty-icon">${ui.icon('filter')}</span><div class="bl-empty-title">${T('bl.empty.title')}</div><div class="bl-empty-sub">${T('bl.empty.sub')}</div><button type="button" class="btn btn-secondary btn-sm" data-action="reset">${ui.icon('refresh')}<span>${T('bl.empty.reset')}</span></button></div></td></tr>`;
    page.querySelector('#bl-result-count').textContent = t('bl.showing', { n: rows.length, total: ctx.data.builders.length });
    page.querySelector('.bl-search').classList.toggle('has-value', Boolean(st.q));
    page.querySelectorAll('th[data-sort]').forEach((th) => {
      const active = th.dataset.sort === st.sort.key;
      th.setAttribute('aria-sort', active ? (st.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.querySelector('.bl-sort-ico').innerHTML = ui.icon(active ? (st.sort.dir === 'asc' ? 'sortUp' : 'sortDown') : 'sort');
    });
    page.querySelectorAll('.bl-leg').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.stage === st.stage)));
  }

  function exportCsv(ctx) {
    const rows = visibleRows(ctx);
    const builders = ctx.data.builders;
    const fields = FIELD_ORDER.filter((f) => builders.some((b) => Object.prototype.hasOwnProperty.call(b, f)));
    const lines = [fields.map(ctx.Core.csvCell).join(',')]
      .concat(rows.map((b) => fields.map((f) => ctx.Core.csvCell(b[f])).join(',')));
    const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const role = String((ctx.data.access && ctx.data.access.role) || 'role').replace(/[^a-z0-9_-]/gi, '');
    const date = String(ctx.data.snapshotAt || 'snapshot').slice(0, 10).replace(/[^0-9-]/g, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `early-builders-${date}-${role}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ctx.ui.toast(ctx.t('toast.export.t'), ctx.t('toast.export.x', { n: rows.length }));
  }

  function openContentForm(page, ctx, code) {
    const { T, ui, t } = ctx;
    const esc = ui.esc;
    const b = ctx.data.builders.find((x) => x.id === code);
    const panel = page.querySelector('#bl-content-panel');
    if (!b || !panel || !canEdit(ctx)) return;
    const today = new Date().toISOString().slice(0, 10);
    panel.innerHTML = `<form class="bl-content" data-code="${esc(b.id)}" novalidate>
      <div class="card-header no-mb"><div><div class="card-title">${esc(t('bl.content.title', { code: b.id }))}</div><div class="card-sub">${T('bl.content.hint')}</div></div></div>
      <div class="bl-content-form">
        <label>${T('bl.content.url')}<input type="url" name="url" required maxlength="500" placeholder="https://" autocomplete="off" value="${esc(b.contentUrl || '')}"></label>
        <label>${T('bl.content.platform')}<input type="text" name="platform" maxlength="60" autocomplete="off" value="${esc(b.contentPlatform || '')}"></label>
        <label>${T('bl.content.date')}<input type="date" name="publishedAt" required max="${today}" value="${esc(b.contentAt || '')}"></label>
      </div>
      <div class="bl-content-actions">
        <button type="submit" class="btn btn-primary btn-sm">${ui.icon('check')}<span>${T('bl.content.save')}</span></button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="content-cancel">${T('bl.content.cancel')}</button>
        <span class="bl-content-error" role="alert"></span>
      </div>
    </form>`;
    panel.hidden = false;
    if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    panel.querySelector('input[name="url"]').focus();
  }

  function closeContentForm(page) {
    const panel = page.querySelector('#bl-content-panel');
    if (!panel) return;
    panel.hidden = true;
    panel.innerHTML = '';
  }

  async function submitContent(form, ctx) {
    const { t, ui } = ctx;
    const errorEl = form.querySelector('.bl-content-error');
    const btn = form.querySelector('button[type="submit"]');
    const code = form.dataset.code;
    const payload = {
      url: form.elements.url.value.trim(),
      platform: form.elements.platform.value.trim(),
      publishedAt: form.elements.publishedAt.value,
    };
    errorEl.textContent = '';
    if (!/^https?:\/\/\S+$/i.test(payload.url)) { errorEl.textContent = t('bl.content.err.url'); form.elements.url.focus(); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.publishedAt)) { errorEl.textContent = t('bl.content.err.date'); form.elements.publishedAt.focus(); return; }
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    const result = await ctx.saveContent(code, payload);
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    if (result.ok) {
      ui.toast(t('bl.content.saved'), t('bl.content.saved.x', { code }));
      ctx.reload();
      return;
    }
    if (result.status === 401) { ctx.reload(); return; }
    let key = 'bl.content.err.generic';
    if (result.error === 'network') key = 'bl.content.err.network';
    else if (result.status === 404) key = 'bl.content.err.notFound';
    else if (result.status === 403) key = 'bl.content.err.forbidden';
    else if (result.fields.includes('url')) key = 'bl.content.err.url';
    else if (result.fields.includes('publishedAt')) key = 'bl.content.err.date';
    errorEl.textContent = t(key, { s: result.status });
  }

  function renderRestricted(el, ctx) {
    const { T, ui } = ctx;
    const s = ctx.data.summary || {};
    const stat = (labelKey, value, hero) => `<div class="card bl-stat"><div class="bl-stat-head"><span class="stat-label">${T(labelKey)}</span></div><div class="stat-value${hero ? ' hero' : ''}">${ui.esc(ui.num(value))}</div></div>`;
    el.innerHTML = `<div class="bl-page">${ui.restrictedCard()}
      <section class="bl-stats bl-stats-3 mt-16">${stat('bl.stat.total', s.total)}${stat('bl.stat.granted', s.granted)}${stat('bl.stat.active', s.active, true)}</section>
      ${Array.isArray(ctx.data.channels) ? `<div class="mt-16">${ui.channelTable(ctx.data.channels)}</div>` : ''}
    </div>`;
  }

  // No builder records yet: the builder-portal source is not connected.
  function renderNone(el, ctx) {
    const { T, ui } = ctx;
    el.innerHTML = `<div class="bl-page">
      <div class="bl-head"><p class="page-lede">${T('bl.lede')}</p></div>
      <section class="card bl-table-card"><div class="bl-empty-box">
        <span class="bl-empty-icon">${ui.icon('builders')}</span>
        <div class="bl-empty-title">${T('bl.none.title')}</div>
        <div class="bl-empty-sub">${T('bl.none.sub')}</div>
        ${ctx.canView('sources') ? `<a class="btn btn-secondary btn-sm" href="#sources">${ui.icon('sources')}<span>${T('inv.go.sources')}</span></a>` : ''}
      </div></section>
    </div>`;
  }

  function render(el, ctx) {
    if (!Array.isArray(ctx.data.builders)) return renderRestricted(el, ctx);
    if (!ctx.data.builders.length) return renderNone(el, ctx);
    const { T, ui, Core, t } = ctx;
    const esc = ui.esc;
    const list = ctx.data.builders;
    const stages = Core.stagesOf(list).sort((a, b) => ui.stageOrder(a) - ui.stageOrder(b));
    if (st.stage !== 'all' && !stages.includes(st.stage)) st.stage = 'all';

    const total = list.length;
    const active = list.filter(Core.isActive).length;
    const granted = list.reduce((n, b) => n + (Number(b.credits) || 0), 0);
    const used = list.reduce((n, b) => n + (Number(b.creditsUsed) || 0), 0);
    const published = list.filter(Core.isPublished).length;

    const counts = new Map();
    list.forEach((b) => counts.set(b.stage, (counts.get(b.stage) || 0) + 1));
    const bar = stages.map((s) => `<span class="${ui.stageColor(s)}" style="width:${(counts.get(s) / Math.max(total, 1) * 100).toFixed(2)}%" title="${esc(ui.stageLabel(s))}: ${counts.get(s)}"></span>`).join('');
    const legend = stages.map((s) => `<button type="button" class="bl-leg" data-stage="${esc(s)}" aria-pressed="false"><i class="${ui.stageColor(s)}"></i>${esc(ui.stageLabel(s))} <b>${counts.get(s)}</b></button>`).join('');
    const options = `<option value="all">${T('bl.allStages')}</option>` + stages.map((s) => `<option value="${esc(s)}">${esc(ui.stageLabel(s))}</option>`).join('');

    el.innerHTML = `<div class="bl-page">
      <div class="bl-head"><p class="page-lede">${T('bl.lede')}</p></div>
      <section class="bl-stats">
        <div class="card bl-stat"><div class="bl-stat-head"><span class="stat-label">${T('bl.stat.total')}</span>${ui.icon('builders')}</div><div class="stat-value">${esc(ui.num(total))}</div><div class="bl-stat-foot">${T('bl.stat.total.f')}</div></div>
        <div class="card bl-stat"><div class="bl-stat-head"><span class="stat-label">${T('bl.stat.active')}</span>${ui.icon('bolt')}</div><div class="stat-value hero">${esc(ui.num(active))}</div><div class="bl-stat-foot">${esc(t('bl.stat.active.f', { p: pct(active, total) }))}</div></div>
        <div class="card bl-stat"><div class="bl-stat-head"><span class="stat-label">${T('bl.stat.credits')}</span>${ui.icon('coins')}</div><div class="stat-value">${granted ? `${esc(ui.num(used))}<small>/${esc(ui.num(granted))}</small>` : '—'}</div><div class="bl-stat-foot">${granted ? esc(t('bl.stat.credits.f', { p: pct(used, granted) })) : T(ctx.data.tracking && ctx.data.tracking.creditsEvent === false ? 'bl.credits.pending' : 'common.nodata')}</div></div>
        <div class="card bl-stat"><div class="bl-stat-head"><span class="stat-label">${T('bl.stat.content')}</span>${ui.icon('file')}</div><div class="stat-value">${esc(ui.num(published))}<small>/${esc(ui.num(total))}</small></div><div class="bl-stat-foot">${T('bl.stat.content.f')}</div></div>
      </section>
      <section class="card bl-dist" aria-label="${T('bl.dist.title')}">
        <div class="bl-dist-head"><div class="card-title">${T('bl.dist.title')}</div><span class="text-muted small">${T('bl.dist.hint')}</span></div>
        <div class="bl-dist-bar" aria-hidden="true">${bar}</div>
        <div class="bl-dist-legend">${legend}</div>
      </section>
      <section class="card bl-content-card" id="bl-content-panel" aria-live="polite" hidden></section>
      <section class="card table-card bl-table-card" aria-labelledby="bl-table-title">
        <div class="card-header"><div><div class="card-title" id="bl-table-title">${T('bl.table.title')}</div><div class="card-sub">${T('bl.table.sub')}</div></div>
          <button type="button" class="btn btn-secondary btn-sm" data-action="export" title="${T('bl.exportNote')}">${ui.icon('download')}<span>${T('bl.export')}</span></button></div>
        <div class="toolbar bl-toolbar" role="search">
          <div class="bl-field bl-search"><label for="builder-search">${T('bl.search')}</label>${ui.icon('search', 'bl-search-ico')}
            <input type="search" id="builder-search" autocomplete="off" placeholder="${T('bl.search')}…" value="${esc(st.q)}">
            <button type="button" class="bl-clear" data-action="clear" aria-label="${T('bl.clear')}">${ui.icon('close')}</button></div>
          <div class="bl-field bl-stage"><label for="stage-filter">${T('bl.stage')}</label><select id="stage-filter">${options}</select></div>
          <span class="result-count" id="bl-result-count" aria-live="polite"></span>
        </div>
        <div class="table-scroll"><table class="bl-table">
          <caption class="sr-only">${T('bl.table.title')}</caption>
          <thead><tr>${sortHeader('id', 'th.builder', ctx)}<th scope="col">${T('th.profile')}</th>${sortHeader('stage', 'th.stage', ctx)}${sortHeader('signedUpAt', 'th.signup', ctx)}${sortHeader('creditsUsed', 'th.credits', ctx, 'td-num')}${sortHeader('signIns', 'th.activity', ctx, 'td-num')}<th scope="col">${T('th.content')}</th><th scope="col">${T('th.ref')}</th></tr></thead>
          <tbody id="builders-tbody"></tbody>
        </table></div>
        <div class="bl-legend-row"><span>${ui.icon('lock')}${T('bl.legend.mask')}</span><span>${T('bl.legend.dash')}</span></div>
      </section>
    </div>`;

    const page = el.querySelector('.bl-page');
    const search = page.querySelector('#builder-search');
    const select = page.querySelector('#stage-filter');
    select.value = st.stage;

    search.addEventListener('input', () => { st.q = search.value; update(page, ctx); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; st.q = ''; update(page, ctx); } });
    select.addEventListener('change', () => { st.stage = select.value; update(page, ctx); });
    page.addEventListener('click', (e) => {
      const leg = e.target.closest('.bl-leg');
      if (leg) { st.stage = st.stage === leg.dataset.stage ? 'all' : leg.dataset.stage; select.value = st.stage; update(page, ctx); return; }
      const sortBtn = e.target.closest('.bl-sort');
      if (sortBtn) {
        const key = sortBtn.dataset.sortKey;
        if (st.sort.key === key) st.sort.dir = st.sort.dir === 'asc' ? 'desc' : 'asc';
        else st.sort = { key, dir: key === 'id' || key === 'stage' ? 'asc' : 'desc' };
        update(page, ctx);
        return;
      }
      const action = e.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'clear') { search.value = ''; st.q = ''; update(page, ctx); search.focus(); }
      if (action.dataset.action === 'reset') { search.value = ''; st.q = ''; st.stage = 'all'; select.value = 'all'; update(page, ctx); }
      if (action.dataset.action === 'export') exportCsv(ctx);
      if (action.dataset.action === 'content') openContentForm(page, ctx, action.dataset.code);
      if (action.dataset.action === 'content-cancel') closeContentForm(page);
    });
    page.addEventListener('submit', (e) => {
      const form = e.target.closest('form.bl-content');
      if (!form) return;
      e.preventDefault();
      submitContent(form, ctx);
    });
    update(page, ctx);
    return undefined;
  }

  EB.views.builders = Object.freeze({ titleKey: 'nav.builders', render });
})(window);
