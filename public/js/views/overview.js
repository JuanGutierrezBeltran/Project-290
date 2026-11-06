// Overview: target cards, invitation funnel, Day-14 activation and follow-ups.
(function (root) {
  'use strict';
  const EB = root.EB = root.EB || {};
  EB.views = EB.views || {};

  function riskOf(day) {
    if (day === null || day === undefined) return { tone: '', cls: 'pill-neutral', key: 'risk.ok' };
    if (day > 14) return { tone: 'bad', cls: 'pill-error', key: 'risk.late' };
    if (day >= 10) return { tone: 'warn', cls: 'pill-warning', key: 'risk.risk' };
    return { tone: '', cls: 'pill-neutral', key: 'risk.ok' };
  }

  function targetsHtml(ctx) {
    const { data, T, ui, Core, t } = ctx;
    const esc = ui.esc;
    const program = data.program || {};
    const s = data.summary || Core.summarizeBuilders([], data.snapshotAt);
    const progress = Core.signupProgress(data.funnel, program.signupTarget);
    const onTarget = progress.target > 0 && progress.percent >= 100;
    const cap = Number(program.accountCapacity) || 0;
    const capPct = cap ? Math.min(100, Math.round(s.granted / cap * 100)) : 0;
    const ceoMissing = program.ceoTarget === null || program.ceoTarget === undefined;

    return `<section class="ov-section">
      <div class="section-head"><h2 class="section-title">${T('ov.targets')}</h2><span class="ov-period">${T('ov.period')}: <b>${esc(ctx.periodLabel)}</b></span></div>
      <div class="grid grid-3 ov-targets">
        <article class="card target-card ov-hero">
          <div class="tc-head"><h3 class="card-title">${T('tc.close')}</h3>${ui.pill(onTarget ? 'pill-success' : 'pill-neutral', t(onTarget ? 'pill.ontarget' : 'pill.progress'))}</div>
          <div><div class="tc-value"><span class="stat-value hero">${esc(ui.num(progress.total))}</span><span class="tc-of">/ ${esc(ui.num(progress.target))}</span></div><div class="stat-label">${T('tc.close.label')}</div></div>
          <div class="meter" role="progressbar" aria-label="${T('tc.close.aria')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><i style="width:${progress.percent}%"></i></div>
          <div class="tc-foot"><span><b>${progress.percent}%</b> ${T('tc.close.of')}</span><span><b>${esc(ui.num(Math.max(0, progress.target - progress.total)))}</b> ${T('tc.close.togo')}</span></div>
        </article>
        <article class="card target-card">
          <div class="tc-head"><h3 class="card-title">${T('tc.cap')}</h3><span class="tc-icon">${ui.icon('cube')}</span></div>
          <div><div class="tc-value"><span class="stat-value">${esc(ui.num(cap || null))}</span></div><div class="stat-label">${T('tc.cap.label')}</div></div>
          <span class="tc-flag">${ui.icon('info')}${T('tc.cap.flag')}</span>
          <div class="meter" role="progressbar" aria-label="${T('tc.cap.aria')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${capPct}"><i class="muted" style="width:${capPct}%"></i></div>
          <div class="tc-foot"><span><b>${esc(ui.num(s.granted))} / ${esc(ui.num(cap || null))}</b> ${T('tc.cap.used')}</span><span>${capPct}%</span></div>
        </article>
        <article class="card target-card ov-ceo">
          <div class="tc-head"><h3 class="card-title">${T('tc.ceo')}</h3>${ceoMissing ? ui.pill('pill-neutral', t('pill.pending')) : ''}</div>
          <div><div class="tc-value"><span class="stat-value${ceoMissing ? ' is-null' : ''}">${ceoMissing ? '—' : esc(ui.num(program.ceoTarget))}</span>${ceoMissing ? `<span class="tc-nodata">${T('common.nodata')}</span>` : ''}</div><div class="stat-label">${T('tc.ceo.flag')}</div></div>
          ${ceoMissing ? `<p class="tc-note">${T('tc.ceo.note')}</p>` : ''}
        </article>
      </div>
    </section>`;
  }

  function funnelHtml(ctx) {
    const { data, T, ui, Core } = ctx;
    const esc = ui.esc;
    const steps = Core.funnelSteps(data.funnel);
    const insights = Core.funnelInsights(data.funnel);
    const rows = steps.map((step, i) => {
      const width = step.value > 0 ? Math.max(1.5, Math.min(100, step.percentOfSource)) : 0;
      const rate = ui.funnelRate(step, i);
      const na = i > 0 && step.conversion === null;
      const count = step.reason === 'pending' ? '—' : ui.num(step.value);
      const label = ui.funnelLabel(step);
      return `<div class="funnel-row${step.key === 'accountVerified' ? ' is-key' : ''}${step.source === 'cross' ? ' is-cross' : ''}" role="listitem" aria-label="${esc(`${label}: ${count}${i ? `, ${rate}` : ''}`)}">
        <span class="funnel-label"><span class="step">${String(i + 1).padStart(2, '0')}</span><span class="txt">${esc(label)}</span></span>
        <span class="funnel-bar"><i style="width:${width.toFixed(1)}%"></i></span>
        <span class="funnel-count">${esc(count)}</span>
        <span class="funnel-rate${na ? ' is-na' : ''}">${esc(rate)}</span></div>`;
    }).join('');
    const go = ctx.canView('invitations')
      ? `<a href="#invitations" class="btn btn-ghost btn-sm"><span>${T('f.go')}</span>${ui.icon('arrowRight')}</a>` : '';

    return `<section class="card" aria-labelledby="ov-funnel-h">
      <div class="card-header"><div><h2 class="card-title" id="ov-funnel-h">${T('f.title')}</h2><div class="card-sub">${T('f.sub')}</div></div>${go}</div>
      <div class="ov-funnel" role="list">
        <div class="funnel-row is-headrow" aria-hidden="true"><span>${T('f.h.stage')}</span><span>${T('f.h.share')}</span><span>${T('f.h.count')}</span><span>${T('f.h.step')}</span></div>
        ${rows || `<div class="empty-inline">${ui.dash()}</div>`}
      </div>
      <div class="ov-card-foot"><span>${T('f.overall')}: <b>${insights.overall === null ? '—' : `${esc(insights.overall)}%`}</b></span><span>${T('f.signed')}</span></div>
    </section>`;
  }

  function activationHtml(ctx) {
    const { data, T, ui, Core } = ctx;
    const esc = ui.esc;
    const s = data.summary || Core.summarizeBuilders([], data.snapshotAt);
    const card = (labelKey, iconName, tone, value, meta) => `<div class="act-card">
      <div class="act-top"><span class="stat-label">${T(labelKey)}</span><span class="act-ico ${tone}">${ui.icon(iconName)}</span></div>
      <span class="stat-value">${esc(ui.num(value))}</span><span class="act-meta">${esc(meta)}</span></div>`;
    return `<section class="card" aria-labelledby="ov-act-h">
      <div class="card-header"><div><h2 class="card-title" id="ov-act-h">${T('a.title')}</h2><div class="card-sub">${T('a.sub')}</div></div></div>
      <div class="act-grid">
        ${card('a.active', 'check', 'ok', s.active, ctx.t('a.m.active', { n: s.granted }))}
        ${card('a.within', 'clock', '', s.within14, ctx.t('a.m.within', { n: s.granted }))}
        ${card('a.content', 'file', 'warn', s.missingContent, ctx.t('a.m.content'))}
        ${card('a.project', 'cube', 'warn', s.missingProject, ctx.t('a.m.project'))}
      </div>
      ${data.tracking && data.tracking.creditsEvent === false ? `<div class="act-note">${ui.icon('info')}<span>${T('a.noCredits', { e: data.tracking.creditsEventName || 'credits_granted' })}</span></div>` : ''}
      <ul class="act-defs"><li>${T('a.d1')}</li><li>${T('a.d2')}</li><li>${T('a.d3')}</li></ul>
    </section>`;
  }

  function followupRow(b, ctx) {
    const { data, T, ui, Core, t } = ctx;
    const esc = ui.esc;
    const day = Core.dayNumber(b.creditsGrantedAt, data.snapshotAt);
    const risk = riskOf(day);
    let cells = '';
    for (let i = 1; i <= 14; i += 1) cells += `<i${day !== null && i <= day ? ' class="on"' : ''}></i>`;
    const project = Core.hasProject(b);
    const published = Core.isPublished(b);
    return `<tr>
      <td><div class="fu-builder"><span class="fu-av" aria-hidden="true">${esc(ui.initials(b.id))}</span><div><div class="fu-name">${esc(b.id)}</div>${b.email ? `<div class="fu-id">${esc(b.email)}</div>` : ''}</div></div></td>
      <td>${ui.stagePill(b.stage)}</td>
      <td><span class="fu-date">${esc(ui.shortDate(b.creditsGrantedAt) || '—')}</span></td>
      <td class="td-num mono">${day === null ? '—' : `+${day}`}</td>
      <td>${ui.pill(project ? 'pill-success' : 'pill-neutral', t(project ? 'st.created' : 'st.pending'))}</td>
      <td>${ui.pill(published ? 'pill-success' : 'pill-neutral', t(published ? 'st.published' : 'st.pending'))}</td>
      <td><div class="d14 ${risk.tone}"><span class="d14-track" role="img" aria-label="${T('track.aria', { d: day === null ? 0 : day })}">${cells}</span><span class="d14-num">${day === null ? '—' : `${Math.min(day, 99)}/14`}</span>${ui.pill(risk.cls, t(risk.key))}</div></td>
    </tr>`;
  }

  function followupHtml(ctx) {
    const { data, T, ui, Core } = ctx;
    const hasRecords = Array.isArray(data.builders);
    const list = hasRecords ? Core.followUps(data.builders) : [];
    let body;
    if (!hasRecords) {
      body = `<tr class="empty-row"><td colspan="7"><div class="restricted-inline">${ui.icon('lock')}<div><b>${T('restricted.title')}</b><span>${T('restricted.text')}</span></div></div></td></tr>`;
    } else if (!data.builders.length) {
      body = `<tr class="empty-row ov-empty"><td colspan="7">${ui.icon('info')}${T('fu.none')}</td></tr>`;
    } else if (!list.length && data.tracking && data.tracking.creditsEvent === false) {
      body = `<tr class="empty-row ov-empty"><td colspan="7">${ui.icon('info')}${T('fu.noCredits')}</td></tr>`;
    } else if (!list.length) {
      body = `<tr class="empty-row ov-empty"><td colspan="7">${ui.icon('check')}${T('fu.empty')}</td></tr>`;
    } else {
      body = list.map((b) => followupRow(b, ctx)).join('');
    }
    const go = ctx.canView('builders') && hasRecords
      ? `<a href="#builders" class="btn btn-secondary btn-sm">${ui.icon('builders')}<span>${T('fu.go')}</span></a>` : '';
    return `<section class="card table-card ov-table-card" aria-labelledby="ov-fu-h">
      <div class="card-header"><div><h2 class="card-title" id="ov-fu-h">${T('fu.title')} <span class="nav-count mono">${hasRecords ? list.length : '—'}</span></h2><div class="card-sub">${T('fu.sub')}</div></div>${go}</div>
      <div class="table-scroll"><table>
        <caption class="sr-only">${T('fu.title')}</caption>
        <thead><tr><th scope="col">${T('th.builder')}</th><th scope="col">${T('th.stage')}</th><th scope="col">${T('th.day0')}</th><th scope="col" class="td-num">${T('th.days')}</th><th scope="col">${T('th.project')}</th><th scope="col">${T('th.content')}</th><th scope="col">${T('th.track')}</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </section>`;
  }

  function render(el, ctx) {
    el.innerHTML = `<div class="ov-page">${targetsHtml(ctx)}<div class="ov-mid">${funnelHtml(ctx)}${activationHtml(ctx)}</div>${followupHtml(ctx)}</div>`;
  }

  EB.views.overview = Object.freeze({ titleKey: 'nav.overview', render });
})(window);
