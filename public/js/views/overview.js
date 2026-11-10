// Overview: close target, referral funnel (emails sent through sign-up), PostHog
// product path, HubSpot landing strip and Day-14 activation.
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
    const activeValue = measured ? `${recent.recentPercent}%` : '—';

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
          <div><div class="tc-value"><span class="stat-value hero${measured ? '' : ' is-null'}">${esc(activeValue)}</span></div><div class="stat-label">${measured ? esc(t('tc.active.of', { n: ui.num(recent.recentActive), accounts: ui.num(recent.recentAccounts) })) : T('tc.active.none')}</div></div>
          <div class="meter" role="progressbar" aria-label="${T('tc.active.aria')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${measured ? recent.recentPercent : 0}"><i style="width:${measured ? recent.recentPercent : 0}%"></i></div>
          <div class="tc-foot"><span>${T('tc.active.note')}</span></div>
        </article>
      </div>
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
    const progress = Core.signupProgress(data.funnel, (data.program || {}).signupTarget);
    const go = ctx.canView('invitations')
      ? `<a href="#invitations" class="btn btn-ghost btn-sm"><span>${T('f.go')}</span>${ui.icon('arrowRight')}</a>` : '';
    const foot = `<div class="ov-card-foot"><span>${esc(t('f.verifiedBeside', { n: ui.num(progress.total), target: ui.num(progress.target) }))}</span>${pending ? `<span>${T('f.referral.pending')}</span>` : ''}</div>`;
    return funnelBlock(ctx, { id: 'ov-referral-h', titleKey: 'f.referral', subKey: 'f.referral.sub', steps, keyStep: 'inviteSignedUp', go, foot });
  }

  function productHtml(ctx) {
    const { data, T, ui, Core } = ctx;
    const esc = ui.esc;
    const steps = Core.funnelSteps(Core.productSteps(data.funnel, data.summary));
    const acquire = Core.funnelSteps(Core.acquisitionSteps(data.funnel));
    const sessions = acquire[0];
    const forms = acquire[1];
    const formRate = forms ? ui.funnelRate(forms, acquire.indexOf(forms)) : '—';
    const foot = `<div class="ov-card-foot"><span>${T('f.acquire')}: <b>${esc(ui.num(sessions ? sessions.value : null))}</b></span><span>${T('funnel.formSignups')}: <b>${esc(ui.num(forms ? forms.value : null))}</b> · ${esc(formRate)}</span></div>`;
    return funnelBlock(ctx, { id: 'ov-product-h', titleKey: 'f.product', subKey: 'f.product.sub', steps, keyStep: 'accountVerified', foot });
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

  function render(el, ctx) {
    el.innerHTML = `<div class="ov-page">${targetsHtml(ctx)}<div class="ov-funnels">${referralHtml(ctx)}</div><div class="ov-mid">${productHtml(ctx)}${activationHtml(ctx)}</div></div>`;
  }

  EB.views.overview = Object.freeze({ titleKey: 'nav.overview', render });
})(window);
