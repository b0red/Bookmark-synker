'use strict';
// Translations. The English text is the key: t('Delete {n} bookmarks', { n }) looks it up in the
// dictionary for the app's language (renderer/lang/<lang>.js) and falls back to English.
// The page itself (index.html) is translated once at startup by matching its text, so the HTML
// stays plain English; elements with inline markup (<b>, <kbd>, <code>…) are matched as a whole.

(function () {
  const lang = (window.api && window.api.lang) || 'en';
  const dict = (lang === 'sv' && window.SV_STRINGS) || {};
  const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);

  window.LANG = lang;
  window.LOCALE = lang === 'sv' ? 'sv-SE' : undefined; // dates; English follows Windows' format
  window.t = (s, v) => fill(Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s, v);
  // Singular/plural: tn(n, '1 bookmark', '{n} bookmarks')
  window.tn = (n, one, many, v) => window.t(n === 1 ? one : many, { n, ...v });

  document.documentElement.lang = lang;
  if (lang === 'en') return;

  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const has = (k) => k && Object.prototype.hasOwnProperty.call(dict, k);
  const INLINE = new Set(['B', 'I', 'EM', 'STRONG', 'CODE', 'KBD', 'A', 'SPAN', 'BR', 'SMALL']);
  const ATTRS = ['title', 'placeholder', 'aria-label'];

  function translateAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && has(norm(v))) el.setAttribute(a, dict[norm(v)]);
    }
  }

  function visit(el) {
    translateAttrs(el);
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.hasAttribute('data-no-i18n')) return;
    // A run of text with inline markup is translated as a whole.
    const kids = [...el.children];
    if (kids.length && kids.every(k => INLINE.has(k.tagName)) && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) {
      const key = norm(el.innerHTML);
      if (has(key)) { el.innerHTML = dict[key]; for (const k of el.querySelectorAll('*')) translateAttrs(k); return; }
    }
    for (const n of [...el.childNodes]) {
      if (n.nodeType === 3) {
        const key = norm(n.textContent);
        if (has(key)) n.textContent = n.textContent.replace(n.textContent.trim(), dict[key]);
      } else if (n.nodeType === 1) visit(n);
    }
  }

  // Exposed for the check that lists untranslated text (see scripts/check-i18n.js).
  window.__i18nVisit = visit;
  visit(document.body);
  document.title = window.t(document.title);
})();
