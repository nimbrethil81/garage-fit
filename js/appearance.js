/* Apply before styles/paint; appearance changes never touch workout state. */
(function (root) {
  'use strict';
  const key = 'gf_appearance_v1';
  const valid = value => ['automatic', 'light', 'dark'].includes(value);
  const media = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
  let preference = 'automatic';
  try { const saved = root.localStorage.getItem(key); if (valid(saved)) preference = saved; } catch (_) {}
  function apply() {
    const resolved = preference === 'automatic' ? (media && media.matches ? 'dark' : 'light') : preference;
    root.document.documentElement.setAttribute('data-appearance', resolved);
    const meta = root.document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#263238' : '#f7f3ec');
    const select = root.document.getElementById('appearance');
    if (select) select.value = preference;
  }
  root.GarageFitAppearance = {
    choose(value) {
      if (!valid(value)) return;
      preference = value;
      try {
        root.localStorage.setItem(key, value);
        const status = root.document.getElementById('appearanceStatus');
        if (status) status.textContent = '';
      } catch (_) {
        const status = root.document.getElementById('appearanceStatus');
        if (status) status.textContent = 'Appearance changed for now. This browser could not save your preference.';
      }
      apply();
    }
  };
  if (media) {
    if (media.addEventListener) media.addEventListener('change', apply);
    else if (media.addListener) media.addListener(apply);
  }
  root.document.addEventListener('DOMContentLoaded', apply);
  apply();
})(window);
