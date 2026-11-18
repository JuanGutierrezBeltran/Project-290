// Overview: close target (Developer Network members / 200), verified accounts active
// in the last 7 days, the four member cards, sign-ups by day and by channel,
// the email funnel (unchanged), the product path and GA4 UTM results.
(function (root) {
  'use strict';
  const EB = root.EB = root.EB || {};
  EB.views = EB.views || {};

  function targetsHtml(ctx) {
    const { data, T, ui, Core, t } = ctx;
    const esc = ui.esc;
    const program = data.program || {};
    const progress = Core.signupProgress(data.funnel, program.signupTarget);
    const onTarget = progress.target > 0 && progress.percent >= 100;
    const recent = Array.isArray(data.builders)
      ? Core.recentActivity(data.builders, data.snapshotAt, 7)
      : {
        recentActive: data.summary ? data.summary.recentActive : null,
        recentAccounts: data.summary ? data.summary.recentAccounts : null,
        recentPercent: data.summary ? data.summary.recentPercent : null,
      };
    const measured = recent.recentPercent != null;
    const activeCount = measured ? ui.num(recent.recentActive) : '—';
    const activePct = measured ? `${recent.recentPercent}%` : '';

    return `<section class="ov-section">
      <div class="section-head"><h2 class="section-title">${T('ov.targets')}</h2><span class="ov-period">${T('ov.period')}: <b>${esc(ctx.periodLabel)}</b></span></div>
      <div class="ov-targets">
        <article class="card target-card ov-hero">
          <div class="tc-head"><h3 class="card-title">${T('tc.close')}</h3>${ui.pill(onTarget ? 'pill-success' : 'pill-neutral', t(onTarget ? 'pill.ontarget' : 'pill.progress'))}</div>
          <div><div class="tc-value"><span class="stat-value hero">${esc(ui.num(progress.total))}</span><span class="tc-of">/ ${esc(ui.num(progress.target))}</span></div><div class="stat-label">${T('tc.close.label')}</div></div>
          <div class="meter" role="progressbar" aria-label="${T('tc.close.aria')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><i style="width:${progress.percent}%"></i></div>
          <div class="tc-foot"><span><b>${progress.percent}%</b> ${T('tc.close.of')}</span><span><b>${esc(ui.num(Math.max(0, progress.target - progress.total)))}</b> ${T('tc.close.togo')}</span></div>
        </article>
        <article class="card target-card">
          <div class="tc-head"><h3 class="card-title">${T('tc.active')}</h3></div>
          <div><div class="tc-value"><span class="stat-value hero${measured ? '' : ' is-null'}">${esc(activeCount)}</span>${activePct ? `<span class="tc-of">${esc(activePct)}</span>` : ''}</div><div class="stat-label">${measured ? esc(t('tc.active.of', { n: ui.num(recent.recentActive), accounts: ui.num(recent.recentAccounts), p: recent.recentPercent })) : T('tc.active.none')}</div></div>
          <div class="meter" role="progressbar" aria-label="${T('tc.active.aria')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${measured ? recent.recentPercent : 0}"><i style="width:${measured ? recent.recentPercent : 0}%"></i></div>
          <div class="tc-foot"><span>${T('tc.active.note')}</span></div>
        </article>
      </div>
    </section>`;
  }

  function cardsHtml(ctx) {
    const { data, T, ui, Core } = ctx;
    const esc = ui.esc;
    const members = data.members || Core.memberCards(Array.isArray(data.builders) ? data.builders : []);
    const card = (label, value) => `<article class="card act-card"><span class="stat-label">${T(label)}</span><span class="stat-value">${esc(ui.num(value))}</span></article>`;
    return `<section class="member-grid" aria-label="${T('mc.aria')}">
      ${card('mc.signed', members.signedUp)}
      ${card('mc.verified', members.verified)}
      ${card('mc.notList', members.notOnBuilderList)}
      ${card('mc.paid', members.paidMedia)}
    </section>`;
  }

  function daysHtml(ctx) {
    const { data, T, ui } = ctx;
    const esc = ui.esc;
    const days = Array.isArray(data.signupDays) ? data.signupDays : [];
    const max = days.reduce((peak, day) => Math.max(peak, Number(day.count) || 0), 0);
    const cols = days.map((day) => {
      const count = Number(day.count) || 0;
      const height = max > 0 ? Math.max(count ? 4 : 0, Math.round(count / max * 100)) : 0;
      const label = String(day.date || '').slice(5);
      return `<div class="day-col"><span class="day-count">${count ? esc(ui.num(count)) : ''}</span><span class="day-plot"><i style="height:${height}%"></i></span><span class="day-label" title="${esc(day.date)}">${esc(label)}</span></div>`;
    }).join('');
    return `<section class="card ov-chart" aria-labelledby="ov-days-h">
      <div class="card-header"><div><h2 class="card-title" id="ov-days-h">${T('chart.days')}</h2><div class="card-sub">${T('chart.days.sub')}</div></div></div>
      ${cols ? `<div class="day-chart" role="img" aria-label="${T('chart.days')}">${cols}</div>` : `<div class="empty-inline">${ui.dash()}</div>`}
    </section>`;
  }

  function channelsHtml(ctx) {
    const { data, T, ui } = ctx;
    const esc = ui.esc;
    const rows = Array.isArray(data.signupChannels) ? data.signupChannels : [];
    const max = rows.reduce((peak, row) => Math.max(peak, Number(row.count) || 0), 0) || 1;
    const bars = rows.map((row) => {
      const width = Math.max(1.5, Math.round((Number(row.count) || 0) / max * 100));
      return `<div class="ch-row"><span class="ch-label">${esc(row.label || row.key)}</span><span class="ch-bar"><i style="width:${width}%"></i></span><span class="ch-count">${esc(ui.num(row.count))}</span></div>`;
    }).join('');
    return `<section class="card ov-chart" aria-labelledby="ov-ch-h">
      <div class="card-header"><div><h2 class="card-title" id="ov-ch-h">${T('chart.channels')}</h2><div class="card-sub">${T('chart.channels.sub')}</div></div></div>
      <div class="ch-chart">${bars || `<div class="empty-inline">${ui.dash()}</div>`}</div>
    </section>`;
  }

  function utmHtml(ctx) {
    const { data, T, ui } = ctx;
    const esc = ui.esc;
    const utm = data.utm || { available: false, reason: 'not_synced', rows: [] };
    const rows = utm.available && Array.isArray(utm.rows) ? utm.rows : [];
    const body = rows.map((row) => `<tr>
      <td>${esc(row.source)}</td><td>${esc(row.medium)}</td><td>${esc(row.campaign)}</td>
      <td class="td-num mono">${esc(ui.num(row.sessions))}</td></tr>`).join('');
    const empty = utm.reason === 'no_landing' ? T('utm.empty.landing') : T('utm.empty');
    return `<section class="card" aria-labelledby="ov-utm-h">
      <div class="card-header"><div><h2 class="card-title" id="ov-utm-h">${T('utm.title')}</h2><div class="card-sub">${T('utm.sub')}</div></div></div>
      ${body ? `<div class="table-scroll"><table class="compact-table">
        <thead><tr><th scope="col">${T('utm.source')}</th><th scope="col">${T('utm.medium')}</th><th scope="col">${T('utm.campaign')}</th><th scope="col" class="td-num">${T('utm.sessions')}</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>` : `<div class="empty-inline">${esc(empty)}</div>`}
    </section>`;
  }

  function sequenceRows(steps, ctx, keyStep) {
    const { ui } = ctx;
    const esc = ui.esc;
    return steps.map((step, i) => {
      const width = step.value > 0 ? Math.max(1.5, Math.min(100, step.percentOfSource)) : 0;
      const rate = ui.funnelRate(step, i);
      const na = i > 0 && step.conversion === null;
      const count = step.reason === 'pending' ? '—' : ui.num(step.value);
      const label = ui.funnelLabel(step);
      return `<div class="funnel-row${step.key === keyStep ? ' is-key' : ''}" role="listitem" aria-label="${esc(`${label}: ${count}${i ? `, ${rate}` : ''}`)}">
        <span class="funnel-label"><span class="step">${String(i + 1).padStart(2, '0')}</span><span class="txt">${esc(label)}</span></span>
        <span class="funnel-bar"><i style="width:${width.toFixed(1)}%"></i></span>
        <span class="funnel-count">${esc(count)}</span>
        <span class="funnel-rate${na ? ' is-na' : ''}">${esc(rate)}</span></div>`;
    }).join('');
  }

  function funnelBlock(ctx, opts) {
    const { T, ui } = ctx;
    const go = opts.go || '';
    return `<section class="card" aria-labelledby="${opts.id}">
      <div class="card-header"><div><h2 class="card-title" id="${opts.id}">${T(opts.titleKey)}</h2><div class="card-sub">${T(opts.subKey)}</div></div>${go}</div>
      <div class="ov-funnel" role="list">
        <div class="funnel-row is-headrow" aria-hidden="true"><span>${T('f.h.stage')}</span><span>${T('f.h.share')}</span><span>${T('f.h.count')}</span><span>${T('f.h.step')}</span></div>
        ${sequenceRows(opts.steps, ctx, opts.keyStep) || `<div class="empty-inline">${ui.dash()}</div>`}
      </div>
      ${opts.foot || ''}
    </section>`;
  }

  function referralHtml(ctx) {
    const { data, T, ui, Core, t } = ctx;
    const esc = ui.esc;
    const raw = Array.isArray(data.referral) && data.referral.length ? data.referral : Core.referralSteps(data.invitations);
    const steps = Core.funnelSteps(raw);
    const pending = steps.some((s) => s.reason === 'pending');
    const verified = (Array.isArray(data.funnel) ? data.funnel : []).find((step) => step.key === 'accountVerified');
    const target = (data.program || {}).signupTarget;
    const go = ctx.canView('invitations')
      ? `<a href="#invitations" class="btn btn-ghost btn-sm"><span>${T('f.go')}</span>${ui.icon('arrowRight')}</a>` : '';
    const foot = `<div class="ov-card-foot"><span>${esc(t('f.verifiedBeside', { n: ui.num(verified ? verified.value : 0), target: ui.num(target) }))}</span>${pending ? `<span>${T('f.referral.pending')}</span>` : ''}</div>`;
    return funnelBlock(ctx, { id: 'ov-referral-h', titleKey: 'f.referral', subKey: 'f.referral.sub', steps, keyStep: 'inviteSignedUp', go, foot });
  }

  function productHtml(ctx) {
    const { data, Core } = ctx;
    const steps = Core.funnelSteps(Core.productSteps(data.funnel));
    return funnelBlock(ctx, { id: 'ov-product-h', titleKey: 'f.product', subKey: 'f.product.sub', steps, keyStep: 'accountVerified' });
  }

  function render(el, ctx) {
    el.innerHTML = `<div class="ov-page">${targetsHtml(ctx)}${cardsHtml(ctx)}${daysHtml(ctx)}<div class="ov-funnels">${referralHtml(ctx)}</div><div class="ov-mid">${productHtml(ctx)}${utmHtml(ctx)}</div>${channelsHtml(ctx)}</div>`;
  }

  EB.views.overview = Object.freeze({ titleKey: 'nav.overview', render });
})(window);
