
// State screens: Data Unavailable (in-shell, with retry and attempt log),
// Sign In (full page; shared-password access form when ACCESS_PASSWORD is set,
// dev-login role links when the server offers them, SSO marked planned),
// Forbidden (403) and Auth not configured (503).
(function (root) {
  'use strict';
  const EB = root.EB = root.EB || {};
  const ui = () => EB.ui;
  const t = (k, v) => EB.i18n.t(k, v);
  const T = (k, v) => ui().esc(t(k, v));

  // Display-only mirror of lib/access.js. The server is the source of truth.
  const ROLE_MATRIX = [
    { id: 'admin', views: ['overview', 'builders', 'invitations', 'sources'], records: 'full' },
    { id: 'program_manager', views: ['overview', 'builders', 'invitations', 'sources'], records: 'full' },
    { id: 'research', views: ['overview', 'builders', 'invitations', 'sources'], records: 'pseudonymous' },
    { id: 'executive', views: ['overview'], records: 'none' },
    { id: 'marketing', views: ['overview', 'invitations'], records: 'none' },
  ];
  const VIEWS = ['overview', 'builders', 'invitations', 'sources'];

  function roleLabel(id, fallback) {
    const key = `role.${id}`;
    const label = t(key);
    return label === key ? (fallback || id) : label;
  }

  function topHtml() {
    const lang = EB.i18n.getLang();
    return `<header class="login-top">
      <div class="login-brand"><span class="logo-mark">${ui().icon('logo')}</span>Think4Ever <span class="sub">Builders</span></div>
      <div class="login-lang" role="group" aria-label="${T('ctl.language')}">
        <button type="button" data-lang="es" aria-pressed="${lang === 'es'}">ES</button><button type="button" data-lang="en" aria-pressed="${lang === 'en'}">EN</button>
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

  function passwordFormHtml(roles, scopeOf) {
    const u = ui();
    const esc = u.esc;
    const options = roles.map((r, i) => `<label class="role-option pw-role${i === 0 ? ' is-checked' : ''}"><input type="radio" name="role" value="${esc(r.id)}"${i === 0 ? ' checked' : ''}><span class="role-name">${esc(roleLabel(r.id, r.label))}</span><span class="role-scope">${esc(scopeOf(r.id))}</span></label>`).join('');
    return `<form class="pw-form" novalidate>
              <div><div class="field-legend">${T('si.pw.title')}</div><p class="login-hint">${T('si.pw.lede')}</p></div>
              <div><label class="pw-label" for="access-password">${T('si.pw.password')}</label><input class="pw-input" id="access-password" name="password" type="password" autocomplete="current-password" maxlength="256" required></div>
              <fieldset class="pw-roles"><legend class="pw-label">${T('si.pw.role')}</legend><div class="role-list">${options}</div></fieldset>
              <p class="pw-error" role="alert" hidden></p>
              <button type="submit" class="btn btn-primary login-submit">${u.icon('login')}<span>${T('si.pw.submit')}</span></button>
            </form>`;
  }

  function wirePasswordForm(el, onSignedIn) {
    const form = el.querySelector('.pw-form');
    if (!form) return;
    const input = form.querySelector('#access-password');
    const errorEl = form.querySelector('.pw-error');
    const submit = form.querySelector('button[type="submit"]');
    const showError = (text) => { errorEl.textContent = text; errorEl.hidden = false; };
    const setBusy = (busy) => {
      submit.disabled = busy;
      if (busy) submit.setAttribute('aria-busy', 'true'); else submit.removeAttribute('aria-busy');
    };

    form.addEventListener('change', (e) => {
      if (!e.target || e.target.name !== 'role') return;
      form.querySelectorAll('.pw-role').forEach((label) => label.classList.toggle('is-checked', label.querySelector('input').checked));
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      const password = input.value;
      const role = form.querySelector('input[name="role"]:checked');
      if (!password) { showError(t('si.pw.err.empty')); input.focus(); return; }
      if (!role) { showError(t('si.pw.err.role')); return; }
      errorEl.hidden = true;
      setBusy(true);

      let res;
      try {
        res = await fetch('auth/password-login', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ password, role: role.value }),
        });
      } catch (err) {
        setBusy(false);
        showError(t('si.pw.err.network'));
        return;
      }

      if (res.ok) {
        input.value = '';
        if (typeof onSignedIn === 'function') onSignedIn(); else location.reload();
        return;
      }
      setBusy(false);
      if (res.status === 401) {
        input.value = '';
        input.focus();
        showError(t('si.pw.err.password'));
        return;
      }
      if (res.status === 429) {
        const seconds = Number(res.headers.get('Retry-After'));
        const minutes = Math.max(1, Math.ceil((Number.isFinite(seconds) && seconds > 0 ? seconds : 900) / 60));
        showError(t('si.pw.err.limit', { m: minutes }));
        return;
      }
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        if (body && body.error === 'unknown_role') { showError(t('si.pw.err.role')); return; }
      }
      showError(t('si.pw.err.generic', { s: res.status }));
    });
  }

  function signIn(el, info, onLang, onSignedIn) {
    const u = ui();
    const esc = u.esc;
    const roles = info && Array.isArray(info.roles) ? info.roles : [];
    const devRoles = info && info.devLogin ? roles : [];
    const pwRoles = info && info.passwordLogin ? roles : [];
    const scopeOf = (id) => {
      const m = ROLE_MATRIX.find((r) => r.id === id);
      return m ? `${t(`si.rec.${m.records}`)} · ${t('si.views', { n: m.views.length })}` : '';
    };
    const roleLinks = devRoles.map((r) => `<a class="role-option" href="auth/dev-login?role=${encodeURIComponent(r.id)}"><span class="role-name">${esc(roleLabel(r.id, r.label))}</span><span class="role-scope">${esc(scopeOf(r.id))}</span></a>`).join('');
    const matrix = ROLE_MATRIX.map((r) => `<tr><td>${esc(roleLabel(r.id))}</td>${VIEWS.map((v) => (r.views.includes(v)
      ? `<td class="yes">${u.icon('check')}<span class="sr-only">✓</span></td>`
      : '<td class="no">—</td>')).join('')}<td class="rec">${T(`si.rec.${r.records}`)}</td></tr>`).join('');

    el.innerHTML = `<div class="login-page">
      ${topHtml()}
      <div class="login-grid">
        <section class="login-card" aria-labelledby="login-title">
          <span class="login-kicker"><i class="sq"></i>${T('si.kicker')}</span>
          <h1 class="login-title" id="login-title">${T('si.title')}</h1>
          <p class="login-lede">${T('si.lede')}</p>
          <div class="login-form">
            ${pwRoles.length ? passwordFormHtml(pwRoles, scopeOf) : ''}
            ${devRoles.length
    ? `<div><div class="field-legend">${T('si.devRoles')}</div><div class="role-list">${roleLinks}</div><p class="login-hint">${T('si.devHint')}</p></div>`
    : ''}
            ${!pwRoles.length && !devRoles.length
    ? `<div class="alert alert-warning" role="note">${u.icon('info')}<div><p>${T('si.noDev')}</p></div></div>`
    : ''}
            <button type="button" class="btn ${pwRoles.length ? 'btn-secondary' : 'btn-primary'} login-submit" disabled aria-disabled="true">${u.icon('login')}<span>${T('si.sso')}</span></button>
            <p class="login-hint">${T('si.help')}</p>
          </div>
          <div class="alert alert-warning" role="note">${u.icon('alert')}<div><b class="alert-title">${T('si.alert.t')}</b><p>${T('si.alert.d')}</p></div></div>
        </section>
        <aside class="access-panel" aria-labelledby="access-title">
          <div class="access-head"><div class="card-title" id="access-title">${T('si.matrix')}</div><p>${T('si.matrix.sub')}</p></div>
          <div class="table-scroll"><table class="access-table">
            <thead><tr><th scope="col">${T('si.th.role')}</th>${VIEWS.map((v) => `<th scope="col">${T(`nav.${v}`)}</th>`).join('')}<th scope="col">${T('si.th.records')}</th></tr></thead>
            <tbody>${matrix}</tbody>
          </table></div>
          <div><div class="field-legend">${T('si.flow')}</div>
            <ol class="access-flow">${[1, 2, 3].map((n) => `<li${n === 1 ? ' class="now"' : ''}><div class="flow-step">0${n}</div><div class="flow-name">${T(`si.f${n}.t`)}</div><div class="flow-desc">${T(`si.f${n}.d`)}</div></li>`).join('')}</ol>
          </div>
        </aside>
      </div>
      <footer class="login-foot"><span>THINK4EVER DEVELOPER NETWORK · EARLY BUILDERS</span><span class="ok"><i></i>${T('si.foot')}</span></footer>
    </div>`;
    wireLang(el, onLang);
    wirePasswordForm(el, onSignedIn);
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
