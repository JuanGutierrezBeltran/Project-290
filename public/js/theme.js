// Dark / light theme. The choice is stored in localStorage and applied on <html>.
// A tiny inline script in index.html sets the attribute before first paint.
(function (root) {
  'use strict';
  const EB = root.EB = root.EB || {};
  const KEY = 't4_theme';

  function current() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function label(theme) {
    const key = theme === 'light' ? 'theme.light' : 'theme.dark';
    if (EB.i18n) {
      const text = EB.i18n.t(key);
      if (text !== key) return text;
    }
    return theme === 'light' ? 'Light' : 'Dark';
  }

  function apply(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', next);
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    sync();
  }

  function toggle() {
    apply(current() === 'light' ? 'dark' : 'light');
  }

  function sync() {
    const theme = current();
    const text = label(theme);
    const name = EB.i18n ? EB.i18n.t('theme.label') : 'Color theme';
    const aria = name === 'theme.label' ? text : `${name}: ${text}`;
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      btn.setAttribute('aria-label', aria);
      const span = btn.querySelector('.theme-toggle-label');
      if (span) span.textContent = text;
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!btn) return;
    e.preventDefault();
    toggle();
  });

  EB.theme = Object.freeze({ current, apply, toggle, sync });
})(window);
