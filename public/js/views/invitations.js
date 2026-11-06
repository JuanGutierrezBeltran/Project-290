
// Invitations / enrollment: the funnel (HubSpot sessions and form submissions, PostHog
// registration started, account created and account verified, plus the person-level cross
// form -> verified account by HMAC email hash). Conversion is shown only inside one source
// or across the person match; other steps say "sources not matched". Also: funnel shape,
// stage detail, landing channels and the real invitation states from HubSpot marketing emails
// (or "pending source" while HUBSPOT_INVITE_EMAIL_IDS / EMAIL_HASH_KEY are missing).
(function (root) {
  'use strict';
  const EB = root.EB = root.EB || {};
  EB.views = EB.views || {};

  const SOURCE_PILL = {
    hubspot: ['pill-success', 'src.hubspot'],
    posthog: ['pill-success', 'src.posthog'],
    cross: ['pill-lime', 'src.cross'],
  };
  const STATES = ['invited', 'sent', 'delivered', 'replied', 'closed', 'accepted', 'enrolled', 'opened'];
  const LOW_STEP = 40;

  function statesHtml(ctx) {
    const { data, T, ui, t } = ctx;
    const esc = ui.esc;
    const inv = data.invitations || {};
    const live = inv.available === true;
    const invited = live ? Number(inv.invited) || 0 : 0;
    const rows = STATES.map((k) => {
      const value = live ? Number(inv[k]) || 0 : null;
      const share = live && k !== 'invited' && invited > 0
        ? `<small>${esc(t('inv.es.ofInvited', { p: Math.round(value / invited * 100) }))}</small>` : '';
      const right = live ? `<b class="mono">${esc(ui.num(value))}</b>` : ui.pill('pill-neutral', t('inv.es.pending'));
      return `<div class="inv-state"><div>${T(`inv.es.${k}`)}${share}</div>${right}</div>`;
    }).join('');
    const alert = live
      ? `<div class="alert alert-info" role="note">${ui.icon('info')}<div><b class="alert-title">${T('inv.rule.live.t')}</b><p>${T('inv.rule.live.d')}</p></div></div>`
      : `<div class="alert alert-warning" role="note">${ui.icon('alert')}<div><b class="alert-title">${T('inv.rule.pending.t')}</b><p>${T('inv.rule.pending.d')}</p></div></div>`;
    return `${alert}<div class="inv-states">${rows}</div>`;
  }

  function render(el, ctx) {
    const { data, T, ui, Core, t } = ctx;
    const esc = ui.esc;
    const steps = Core.funnelSteps(data.funnel);
    const insights = Core.funnelInsights(data.funnel);
    const byKey = (key) => steps.find((s) => s.key === key);
    const first = steps[0] ? steps[0].value : null;
    const verified = byKey('accountVerified');
    const cross = byKey('formToVerified');
    const drop = insights.largestDrop;
    const labelOf = (key) => { const s = byKey(key); return s ? ui.funnelLabel(s) : key; };
    const total = String(steps.length).padStart(2, '0');
    const srcPill = (step) => {
      const p = SOURCE_PILL[step.source];
      return p ? ui.pill(p[0], t(p[1])) : ui.pill('pill-neutral', t('state.unknown'));
    };
    const countOf = (step) => (step.reason === 'pending' ? '—' : ui.num(step.value));

    const cards = steps.map((step, i) => {
      const na = i > 0 && step.conversion === null;
      const low = !na && i > 0 && step.conversion < LOW_STEP;
      const conv = i ? ui.funnelRate(step, i) : '100%';
      const width = i ? (na ? 0 : Math.min(100, step.conversion)) : 100;
      return `<li class="inv-stage">
        <div class="inv-stage-top"><span class="inv-step">${String(i + 1).padStart(2, '0')} / ${total}</span></div>
        <div class="inv-stage-name">${esc(ui.funnelLabel(step))}<span class="inv-stage-alias">${esc(step.key)}</span></div>
        <div class="stat-value">${esc(countOf(step))}</div>
        <div class="inv-conv"><span>${T(i ? 'inv.step' : 'inv.base')}</span><b class="${low ? 'is-low' : ''}${na ? ' is-na' : ''}">${esc(conv)}</b></div>
        <div class="inv-mini" aria-hidden="true"><i class="${low ? 'is-low' : ''}" style="width:${width}%"></i></div>
        <div class="inv-stage-src">${srcPill(step)}</div>
      </li>`;
    }).join('');

    const shape = steps.map((step) => {
      const width = step.value > 0 ? Math.min(100, Math.max(1.5, step.percentOfSource)) : 0;
      return `<div class="inv-frow"><span class="inv-flabel">${esc(ui.funnelLabel(step))}</span>
      <span class="inv-fbar" role="img" aria-label="${esc(`${ui.funnelLabel(step)} ${countOf(step)}`)}"><i class="${step.key === 'accountVerified' ? 'is-mid' : ''}" style="width:${width.toFixed(1)}%"></i></span>
      <span class="inv-fcount">${esc(countOf(step))}</span><span class="inv-frate">${step.reason === 'pending' ? '—' : `${step.percentOfSource}%`}</span></div>`;
    }).join('');

    const tableRows = steps.map((step, i) => `<tr><td class="td-id">${esc(ui.funnelLabel(step))}</td><td class="mono td-num">${esc(countOf(step))}</td><td class="mono td-num">${esc(ui.funnelRate(step, i))}</td><td class="mono td-num">${step.reason === 'pending' ? '—' : `${step.percentOfSource}%`}</td></tr>`).join('');

    const dropText = drop ? `${labelOf(drop.from)} → ${labelOf(drop.to)}` : '—';
    let overallFoot = '—';
    if (cross && cross.reason === 'pending') overallFoot = t('inv.sum.overall.pending');
    else if (cross) overallFoot = `${ui.num(cross.value)} / ${ui.num(cross.baseValue)}`;
    const notes = [1, 2, 3, 4].map((n) => `<li${n === 1 ? ' class="is-first"' : ''}><div><b>${T(`inv.o${n}.t`)}</b><p>${T(`inv.o${n}.d`)}</p></div></li>`).join('');

    el.innerHTML = `<div class="inv-page">
      <header class="inv-head">
        <div><h2 class="section-title">${T('inv.title')}</h2><p class="page-lede">${T('inv.lede')}</p></div>
      </header>
      <section class="inv-summary">
        <div class="inv-sum"><div class="inv-sum-head"><span class="stat-label">${T('inv.sum.invited')}</span>${ui.icon('list')}</div><div class="stat-value">${esc(ui.num(first))}</div><div class="inv-sum-foot">${T('inv.sum.invited.f')}</div></div>
        <div class="inv-sum is-hero"><div class="inv-sum-head"><span class="stat-label">${T('inv.sum.signed')}</span>${ui.icon('userCheck')}</div><div class="stat-value hero">${esc(ui.num(verified ? verified.value : null))}</div><div class="inv-sum-foot">${T('inv.sum.signed.f')}</div></div>
        <div class="inv-sum"><div class="inv-sum-head"><span class="stat-label">${T('inv.sum.overall')}</span>${ui.icon('percent')}</div><div class="stat-value">${insights.overall === null ? '—' : `${esc(insights.overall)}%`}</div><div class="inv-sum-foot mono">${esc(overallFoot)}</div></div>
        <div class="inv-sum"><div class="inv-sum-head"><span class="stat-label">${T('inv.sum.drop')}</span>${ui.icon('trendDown')}</div><div class="stat-value">${drop ? `${esc(drop.conversion)}%` : '—'}</div><div class="inv-sum-foot">${esc(dropText)}</div></div>
      </section>
      <section aria-labelledby="inv-stages-title">
        <div class="section-head tight"><h2 class="section-title" id="inv-stages-title">${T('inv.stages')}</h2></div>
        <ol class="inv-stages">${cards || `<li class="inv-stage is-empty">${ui.dash()}</li>`}</ol>
      </section>
      <section class="inv-row">
        <div class="card">
          <div class="card-header"><div><div class="card-title">${T('inv.shape')}</div><div class="card-sub">${T('inv.shape.sub')}</div></div></div>
          <div class="inv-funnel">${shape}</div>
          ${drop ? `<div class="inv-drop">${ui.icon('alert')}<span>${T('inv.sum.drop')}: ${esc(dropText)} · ${esc(drop.conversion)}%</span></div>` : ''}
        </div>
        <div class="card inv-card-pad0">
          <div class="card-header"><div><div class="card-title">${T('inv.detail')}</div><div class="card-sub">${T('inv.detail.sub')}</div></div></div>
          <div class="table-scroll"><table class="compact-table">
            <thead><tr><th scope="col">${T('th.stage')}</th><th scope="col" class="td-num">${T('th.count')}</th><th scope="col" class="td-num">${T('th.step')}</th><th scope="col" class="td-num">${T('inv.th.cumul')}</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table></div>
        </div>
      </section>
      ${Array.isArray(data.channels) ? ui.channelTable(data.channels) : ''}
      <section class="inv-notes">
        <div class="card">
          <div class="card-header no-mb"><div><div class="card-title">${T('inv.order')}</div><div class="card-sub">${T('inv.order.sub')}</div></div></div>
          <ol class="inv-olist">${notes}</ol>
        </div>
        <div class="card inv-rule">
          <div class="card-header no-mb"><div><div class="card-title">${T('inv.rule')}</div><div class="card-sub">${T('inv.rule.sub')}</div></div>${ui.icon('invitations', 'muted-ico')}</div>
          ${statesHtml(ctx)}
          ${ctx.canView('sources') ? `<div class="row mt-16"><a class="btn btn-secondary btn-sm" href="#sources">${ui.icon('sources')}<span>${T('inv.go.sources')}</span></a></div>` : ''}
        </div>
      </section>
    </div>`;
  }

  EB.views.invitations = Object.freeze({ titleKey: 'nav.invitations', render });
})(window);
