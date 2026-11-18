// One builders list: HubSpot user id, plan, account date, credits, projects,
// the last 7 days of credit use, and the sign-up channel.
(function (root) {
  'use strict';
  const EB = root.EB = root.EB || {};
  EB.views = EB.views || {};

  const FIELD_ORDER = ['id', 'plan', 'planName', 'signedUpAt', 'credits', 'creditsUsed', 'creditsPending', 'projects', 'lastCreditUsedAt', 'channel', 'channelKey', 'origin'];
  const st = { q: '', plan: 'all', sort: { key: 'id', dir: 'asc' } };

  function sortValue(b, key) {
    if (key === 'plan') return b.plan || null;
    const v = b[key];
    if (v === '' || v === null || v === undefined) return null;
    return typeof v === 'number' ? v : String(v);
  }

  function visibleRows(ctx) {
    const rows = ctx.Core.filterBuilders(ctx.data.builders, { search: st.q, plan: st.plan });
    const dir = st.sort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const x = sortValue(a, st.sort.key);
      const y = sortValue(b, st.sort.key);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
  }

  function planCell(b, ctx) {
    const { ui, t } = ctx;
    if (b.plan === 'free') return ui.pill('pill-neutral', t('bl.plan.free'));
    if (b.plan === 'premium') return ui.pill('pill-success', t('bl.plan.premium'));
    return ui.dash();
  }

  function creditCell(value, pending, ctx) {
    const { ui, t } = ctx;
    const esc = ui.esc;
    if (value == null && !pending) return ui.dash();
    const num = value == null ? ui.dash() : `<span class="mono">${esc(ui.num(value))}</span>`;
    return pending ? `${num}<div class="bl-sub">${esc(t('bl.credits.program'))}</div>` : num;
  }

  function daysCell(b, days, ctx) {
    const { ui, Core, t } = ctx;
    const esc = ui.esc;
    const worked = Core.workedDays(b, days);
    const on = worked.filter((day) => day.on);
    const cells = worked.map((day) => `<i class="${day.on ? 'on' : ''}" title="${esc(day.date)}"></i>`).join('');
    const names = on.map((day) => ui.shortDate(day.date)).filter(Boolean).join(', ');
    const label = on.length ? t('bl.days.aria', { days: names }) : t('bl.days.none');
    const last = b.lastCreditUsedAt ? ui.shortDate(b.lastCreditUsedAt) : '—';
    return `<div class="work work-7"><span class="work-track" role="img" aria-label="${esc(label)}">${cells}</span><span class="work-num">${esc(last)}</span></div>`;
  }

  function rowHtml(b, days, ctx) {
    const { ui, t } = ctx;
    const esc = ui.esc;
    const label = b.id || b.recordId || '—';
    const projects = b.projects == null ? ui.dash() : esc(ui.num(b.projects));
    return `<tr>
      <td><div class="bl-id"><span class="bl-initials" aria-hidden="true">${esc(ui.initials(label))}</span><div class="bl-id-main">${b.id ? esc(b.id) : ui.dash()}</div></div></td>
      <td>${planCell(b, ctx)}</td>
      <td class="mono td-meta">${b.signedUpAt ? esc(ui.shortDate(b.signedUpAt)) : ui.dash()}</td>
      <td class="td-num">${creditCell(b.credits, b.creditsPending, ctx)}</td>
      <td class="td-num mono">${b.creditsUsed == null ? ui.dash() : esc(ui.num(b.creditsUsed))}</td>
      <td class="td-num mono">${projects}</td>
      <td>${daysCell(b, days, ctx)}</td>
      <td>${b.channel ? esc(b.channel) : ui.dash()}</td>
    </tr>`;
  }

  function sortHeader(key, labelKey, ctx, cls) {
    return `<th scope="col"${cls ? ` class="${cls}"` : ''} data-sort="${key}" aria-sort="none"><button type="button" class="bl-sort" data-sort-key="${key}"><span>${ctx.T(labelKey)}</span><span class="bl-sort-ico"></span></button></th>`;
  }

  function update(page, ctx) {
    const { ui, t } = ctx;
    const rows = visibleRows(ctx);
    const days = ctx.Core.activityWindow(ctx.data.snapshotAt, 7);
    const tbody = page.querySelector('#builders-tbody');
    tbody.innerHTML = rows.length
      ? rows.map((b) => rowHtml(b, days, ctx)).join('')
      : `<tr class="empty-row bl-empty"><td colspan="8"><div class="bl-empty-box"><span class="bl-empty-icon">${ui.icon('filter')}</span><div class="bl-empty-title">${t('bl.empty.title')}</div><div class="bl-empty-sub">${t('bl.empty.sub')}</div><button type="button" class="btn btn-secondary btn-sm" data-action="reset">${ui.icon('refresh')}<span>${t('bl.empty.reset')}</span></button></div></td></tr>`;
    page.querySelector('#bl-result-count').textContent = t('bl.showing', { n: rows.length, total: ctx.data.builders.length });
    page.querySelector('.bl-search').classList.toggle('has-value', Boolean(st.q));
    page.querySelectorAll('th[data-sort]').forEach((th) => {
      const active = th.dataset.sort === st.sort.key;
      th.setAttribute('aria-sort', active ? (st.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.querySelector('.bl-sort-ico').innerHTML = ui.icon(active ? (st.sort.dir === 'asc' ? 'sortUp' : 'sortDown') : 'sort');
    });
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

  function renderRestricted(el, ctx) {
    const { T, ui } = ctx;
    const members = ctx.data.members || {};
    const stat = (labelKey, value) => `<div class="card bl-stat"><div class="bl-stat-head"><span class="stat-label">${T(labelKey)}</span></div><div class="stat-value">${ui.esc(ui.num(value))}</div></div>`;
    el.innerHTML = `<div class="bl-page">${ui.restrictedCard()}
      <section class="bl-stats bl-stats-3 mt-16">${stat('mc.signed', members.signedUp)}${stat('mc.verified', members.verified)}${stat('mc.paid', members.paidMedia)}</section>
    </div>`;
  }

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
    const { T, ui, t } = ctx;
    const esc = ui.esc;
    const list = ctx.data.builders;
    const days = ctx.Core.activityWindow(ctx.data.snapshotAt, 7);
    const scale = days.map((day) => `<span title="${esc(day)}">${esc(day.slice(8))}</span>`).join('');
    const verified = list.filter((b) => b.verifiedAt).length;
    const free = list.filter((b) => b.plan === 'free').length;
    const premium = list.filter((b) => b.plan === 'premium').length;

    el.innerHTML = `<div class="bl-page">
      <div class="bl-head"><p class="page-lede">${T('bl.lede')}</p></div>
      <section class="bl-stats">
        <div class="card bl-stat"><div class="bl-stat-head"><span class="stat-label">${T('bl.stat.total')}</span>${ui.icon('builders')}</div><div class="stat-value">${esc(ui.num(list.length))}</div><div class="bl-stat-foot">${T('bl.stat.total.f')}</div></div>
        <div class="card bl-stat"><div class="bl-stat-head"><span class="stat-label">${T('mc.verified')}</span>${ui.icon('check')}</div><div class="stat-value">${esc(ui.num(verified))}</div><div class="bl-stat-foot">${esc(t('bl.stat.verified.f', { p: list.length ? Math.round(verified / list.length * 100) : 0 }))}</div></div>
        <div class="card bl-stat"><div class="bl-stat-head"><span class="stat-label">${T('bl.plan.free')}</span></div><div class="stat-value">${esc(ui.num(free))}</div><div class="bl-stat-foot">${T('bl.plan.free.f')}</div></div>
        <div class="card bl-stat"><div class="bl-stat-head"><span class="stat-label">${T('bl.plan.premium')}</span></div><div class="stat-value hero">${esc(ui.num(premium))}</div><div class="bl-stat-foot">${T('bl.plan.premium.f')}</div></div>
      </section>
      <section class="card table-card bl-table-card" aria-labelledby="bl-table-title">
        <div class="card-header"><div><div class="card-title" id="bl-table-title">${T('bl.table.title')}</div><div class="card-sub">${T('bl.table.sub')}</div></div>
          <button type="button" class="btn btn-secondary btn-sm" data-action="export" title="${T('bl.exportNote')}">${ui.icon('download')}<span>${T('bl.export')}</span></button></div>
        <div class="toolbar bl-toolbar" role="search">
          <div class="bl-field bl-search"><label for="builder-search">${T('bl.search')}</label>${ui.icon('search', 'bl-search-ico')}
            <input type="search" id="builder-search" autocomplete="off" placeholder="${T('bl.search')}…" value="${esc(st.q)}">
            <button type="button" class="bl-clear" data-action="clear" aria-label="${T('bl.clear')}">${ui.icon('close')}</button></div>
          <div class="bl-field bl-stage"><label for="plan-filter">${T('bl.plan')}</label><select id="plan-filter">
            <option value="all">${T('bl.plan.all')}</option>
            <option value="free">${T('bl.plan.free')}</option>
            <option value="premium">${T('bl.plan.premium')}</option>
          </select></div>
          <span class="result-count" id="bl-result-count" aria-live="polite"></span>
        </div>
        <div class="table-scroll"><table class="bl-table">
          <caption class="sr-only">${T('bl.table.title')}</caption>
          <thead><tr>
            ${sortHeader('id', 'th.builder', ctx)}
            ${sortHeader('plan', 'th.profile', ctx)}
            ${sortHeader('signedUpAt', 'th.signup', ctx)}
            ${sortHeader('credits', 'th.granted', ctx, 'td-num')}
            ${sortHeader('creditsUsed', 'th.used', ctx, 'td-num')}
            ${sortHeader('projects', 'th.project', ctx, 'td-num')}
            <th scope="col"><span class="th-worked">${T('th.last7')}</span><span class="work-scale work-7" aria-hidden="true">${scale}</span></th>
            ${sortHeader('channel', 'th.channel', ctx)}
          </tr></thead>
          <tbody id="builders-tbody"></tbody>
        </table></div>
        <div class="bl-legend-row"><span>${T('bl.legend.dash')}</span><span>${T('bl.credits.program.note')}</span></div>
      </section>
    </div>`;

    const page = el.querySelector('.bl-page');
    const search = page.querySelector('#builder-search');
    const select = page.querySelector('#plan-filter');
    select.value = st.plan;
    search.addEventListener('input', () => { st.q = search.value; update(page, ctx); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; st.q = ''; update(page, ctx); } });
    select.addEventListener('change', () => { st.plan = select.value; update(page, ctx); });
    page.addEventListener('click', (e) => {
      const sortBtn = e.target.closest('.bl-sort');
      if (sortBtn) {
        const key = sortBtn.dataset.sortKey;
        if (st.sort.key === key) st.sort.dir = st.sort.dir === 'asc' ? 'desc' : 'asc';
        else st.sort = { key, dir: key === 'id' || key === 'plan' || key === 'channel' ? 'asc' : 'desc' };
        update(page, ctx);
        return;
      }
      const action = e.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'clear') { search.value = ''; st.q = ''; update(page, ctx); search.focus(); }
      if (action.dataset.action === 'reset') { search.value = ''; st.q = ''; st.plan = 'all'; select.value = 'all'; update(page, ctx); }
      if (action.dataset.action === 'export') exportCsv(ctx);
    });
    update(page, ctx);
    return undefined;
  }

  EB.views.builders = Object.freeze({ titleKey: 'nav.builders', render });
})(window);
