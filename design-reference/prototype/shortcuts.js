/* =========================================================================
   Klinika — OS detection + shortcut hint helpers
   Used by all pages to surface ⌘ on Mac vs Ctrl+ on Windows/Linux.
   Reads:
     [data-os-search-placeholder]   — input/element whose placeholder uses {⌘K}
     [data-os-shortcut="save|new-visit|search"] — adds title="..." + sets .kbd-hint text
     .topbar-search kbd              — auto-rewrites to ⌘K / Ctrl+K
   Listens for keystrokes:
     Cmd/Ctrl+S         — fire save  (window dispatches 'klinika:save')
     Cmd/Ctrl+Enter     — save + new visit ('klinika:save-new')
     Cmd/Ctrl+K  or  /  — focus search ('klinika:focus-search')
   ========================================================================= */
(function () {
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  const ua = navigator.userAgent || '';
  const isMac = /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X/.test(ua);

  const SHORTCUT_TEXT = {
    save:        isMac ? '⌘S'  : 'Ctrl+S',
    'new-visit': isMac ? '⌘↩'  : 'Ctrl+Enter',
    search:      isMac ? '⌘K'  : 'Ctrl+K',
  };

  function decorate() {
    // Topbar search kbd
    document.querySelectorAll('.topbar-search kbd').forEach(el => {
      el.textContent = SHORTCUT_TEXT.search;
    });

    // Placeholders containing {⌘K}
    document.querySelectorAll('[data-os-search-placeholder]').forEach(el => {
      const tpl = el.getAttribute('data-os-search-placeholder');
      el.placeholder = tpl.replace('{shortcut}', SHORTCUT_TEXT.search);
    });

    // Buttons / elements wanting a shortcut hint
    document.querySelectorAll('[data-os-shortcut]').forEach(el => {
      const key = el.getAttribute('data-os-shortcut');
      const label = SHORTCUT_TEXT[key] || '';
      if (!label) return;
      const prefix = el.getAttribute('data-title-prefix') || el.textContent.trim();
      el.setAttribute('title', `${prefix}  ${label}`);
      const hint = el.querySelector('.kbd-hint');
      if (hint) hint.textContent = label;
    });
  }

  function onKey(e) {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    // Spec: both Cmd and Ctrl should fire on either OS (cross-platform keyboards).
    const anyMod = e.metaKey || e.ctrlKey;

    const inField = e.target && /^(input|textarea|select)$/i.test(e.target.tagName);

    // Cmd/Ctrl+S → save
    if (anyMod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('klinika:save'));
      return;
    }
    // Cmd/Ctrl+Enter → save + new visit
    if (anyMod && !e.shiftKey && !e.altKey && (e.key === 'Enter' || e.key === 'Return')) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('klinika:save-new'));
      return;
    }
    // Cmd/Ctrl+K  or  /  → focus search (when not editing text)
    if ((anyMod && e.key.toLowerCase() === 'k') || (e.key === '/' && !inField)) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('klinika:focus-search'));
      return;
    }
  }

  // Focus search when the event fires
  window.addEventListener('klinika:focus-search', () => {
    const input = document.querySelector('.topbar-search input');
    if (input) input.focus();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decorate);
  } else {
    decorate();
  }
  document.addEventListener('keydown', onKey);

  window.KlinikaOS = { isMac, SHORTCUT_TEXT };
})();
