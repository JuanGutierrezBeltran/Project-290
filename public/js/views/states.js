
// State screens: Data Unavailable (in-shell, with retry and attempt log),
// Sign In (full page; Microsoft button only — token exchange lives on the
// Think4ever app, not in this view), Forbidden (403) and Auth not configured (503).
(function (root) {
  'use strict';
  const EB = root.EB = root.EB || {};
  const ui = () => EB.ui;
  const t = (k, v) => EB.i18n.t(k, v);
  const T = (k, v) => ui().esc(t(k, v));

  const VIEWS = ['overview', 'builders', 'invitations', 'sources'];

  function themeButton() {
    return `<button type="button" class="btn btn-secondary btn-sm theme-toggle" data-theme-toggle aria-pressed="false"><span class="theme-toggle-label"></span></button>`;
  }

  function topHtml() {
    const lang = EB.i18n.getLang();
    return `<header class="login-top">
      <div class="login-brand"><span class="logo-mark">${ui().icon('logo')}</span>Think4Ever <span class="sub">Builders</span></div>
      <div class="login-tools">
        ${themeButton()}
        <div class="login-lang" role="group" aria-label="${T('ctl.language')}">
          <button type="button" data-lang="es" aria-pressed="${lang === 'es'}">ES</button><button type="button" data-lang="en" aria-pressed="${lang === 'en'}">EN</button>
        </div>
      </div>
    </header>`;
  }

  function wireLang(el, onLang) {
    el.querySelectorAll('.login-lang button').forEach((b) => b.addEventListener('click', () => onLang(b.dataset.lang)));
  }

  function unavailable(el, info, onRetry) {
    const u = ui();
    const esc = u.esc;
    const attempts = Array.isArray(info.attempts) ? info.attempts : [];
    const last = attempts[attempts.length - 1];
    const response = info.reason === 'network' ? t('es.network') : info.reason === 'malformed' ? t('es.malformed') : `HTTP ${info.status}`;
    const log = attempts.slice(-8).reverse().map((a) => `<li><span class="t">${esc(u.clock(a.time))}</span><span class="${a.ok ? 's' : 'f'}">${a.ok ? '200 OK' : `FAILED — ${esc(a.text)}`}</span></li>`).join('');
    const impact = VIEWS.map((v) => `<li><span class="es-impact-name">${u.icon(v)}${T(`nav.${v}`)}</span><span class="es-impact-val">${u.dash()}</span></li>`).join('');
    const steps = [1, 2, 3].map((n) => `<li><span class="es-step-n">${n}</span><div><div class="es-step-t">${T(`es.s${n}.t`)}</div><div class="es-step-d">${T(`es.s${n}.d`)}</div></div></li>`).join('');

    el.innerHTML = `<div class="es-wrap">
      <div class="es-hero">
        <section class="es-panel" role="alert" aria-labelledby="err-message">
          <div class="es-panel-head">
            <div class="es-panel-icon">${u.icon('plug')}</div>
            <div>
              <div class="error-code"><span class="dot"></span>GET api/dashboard — ${esc(response)}</div>
              <h2 class="es-title" id="err-message">${T('es.msg')}</h2>
              <p class="es-lede">${T('es.lede')}</p>
            </div>
          </div>
          <div class="es-cmd">
            <div class="es-cmd-label">${T('es.cmdLabel')}</div>
            <div class="code-block"><span><span class="tok-c"># project root</span>
<span class="tok-k">npm</span> start</span><button type="button" class="btn btn-secondary btn-sm" data-action="copy">${T('es.copy')}</button></div>
          </div>
          <div class="error-actions">
            <button type="button" class="btn btn-primary" data-action="retry">${u.icon('refresh')}<span>${T('es.retry')}</span></button>
          </div>
          <p class="es-action-note" aria-live="polite"></p>
        </section>
        <section class="card es-check" aria-labelledby="es-check-title">
          <div class="card-header"><div><div class="card-title" id="es-check-title">${T('es.check')}</div><div class="card-sub">${T('es.check.sub')}</div></div>${u.icon('server', 'muted-ico')}</div>
          <div class="es-kv">
            <div class="es-kv-row"><span class="es-kv-key">${T('es.kv.endpoint')}</span><span class="es-kv-val">api/dashboard</span></div>
            <div class="es-kv-row"><span class="es-kv-key">${T('es.kv.response')}</span><span class="es-kv-val bad">${esc(response)}</span></div>
            <div class="es-kv-row"><span class="es-kv-key">${T('es.kv.last')}</span><span class="es-kv-val muted">${last ? esc(u.clock(last.time)) : '—'}</span></div>
            <div class="es-kv-row"><span class="es-kv-key">${T('es.kv.attempts')}</span><span class="es-kv-val">${attempts.length}</span></div>
          </div>
          <div class="es-log-head"><span class="stat-label">${T('es.log')}</span></div>
          <ul class="es-log">${log}</ul>
        </section>
      </div>
      <div class="es-grid">
        <section class="card"><div class="card-header"><div><div class="card-title">${T('es.steps')}</div><div class="card-sub">${T('es.steps.sub')}</div></div></div><ol class="es-steps">${steps}</ol></section>
        <section class="card"><div class="card-header"><div><div class="card-title">${T('es.impact')}</div><div class="card-sub">${T('es.impact.sub')}</div></div></div><ul class="es-impact">${impact}</ul></section>
      </div>
      <div class="alert alert-warning">${u.icon('alert')}<div><b class="alert-title">${T('es.nofallback.t')}</b><p>${T('es.nofallback.d')}</p></div></div>
    </div>`;

    const wrap = el.querySelector('.es-wrap');
    const note = wrap.querySelector('.es-action-note');
    wrap.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'retry') {
        action.disabled = true;
        action.setAttribute('aria-busy', 'true');
        note.textContent = t('es.retrying');
        onRetry();
      }
      if (action.dataset.action === 'copy') {
        const done = () => { action.textContent = t('es.copied'); setTimeout(() => { action.textContent = t('es.copy'); }, 1400); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText('npm start').then(done, done);
        else done();
      }
    });
  }

  function signIn(el, info, onLang) {
    const u = ui();
    el.innerHTML = `<div class="login-page login-page-narrow">
      ${topHtml()}
      <section class="login-card login-card-solo" aria-labelledby="login-title">
        <span class="login-kicker"><i class="sq"></i>${T('si.kicker')}</span>
        <h1 class="login-title" id="login-title">${T('si.title')}</h1>
        <p class="login-lede">${T('si.lede')}</p>
        <div class="login-form">
          <a class="btn btn-primary login-submit" href="auth/microsoft/start">${u.icon('login')}<span>${T('si.microsoft')}</span></a>
          <p class="login-hint">${T('si.domain')}</p>
        </div>
      </section>
      <footer class="login-foot"><span>THINK4EVER DEVELOPER NETWORK · EARLY BUILDERS</span><span class="ok"><i></i>${T('si.foot')}</span></footer>
    </div>`;
    wireLang(el, onLang);
    if (EB.theme) EB.theme.sync();
  }

  function errorPage(el, code, titleKey, textKey, extra, onLang) {
    const u = ui();
    el.innerHTML = `<div class="login-page">
      ${topHtml()}
      <section class="state-panel" role="alert">
        <div class="error-code">${u.esc(code)}</div>
        <h2>${T(titleKey)}</h2>
        <p>${T(textKey)}</p>
        ${extra || ''}
        <div class="error-actions"><a class="btn btn-secondary" href="auth/logout">${u.icon('logout')}<span>${T('common.logout')}</span></a></div>
      </section>
      <footer class="login-foot"><span>THINK4EVER DEVELOPER NETWORK · EARLY BUILDERS</span><span class="ok"><i></i>${T('si.foot')}</span></footer>
    </div>`;
    wireLang(el, onLang);
  }

  function forbidden(el, info, onLang) {
    errorPage(el, 'HTTP 403', 'fb.title', 'fb.text', '', onLang);
  }

  function notConfigured(el, info, onLang) {
    const extra = `<div class="field-legend mt-16">${T('nc.hint')}</div><div class="code-block"><span class="tok-c"># service variables</span>
<span class="tok-k">ACCESS_PASSWORD</span>=<span class="tok-s">"&lt;12+ characters&gt;"</span>
<span class="tok-k">SESSION_SECRET</span>=<span class="tok-s">"&lt;32+ random characters&gt;"</span></div>`;
    errorPage(el, 'HTTP 503', 'nc.title', 'nc.text', extra, onLang);
  }

  EB.states = Object.freeze({ unavailable, signIn, forbidden, notConfigured });
})(window);
