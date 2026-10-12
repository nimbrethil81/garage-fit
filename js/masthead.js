// Canonical GarageFit masthead: the single source of the logo SVG and wordmark.
// Every primary-tab screen declares an empty `<div class="brand" data-masthead></div>` host and this module fills it.
(function (root) {
  const MARK = '<svg class="brand-mark" viewBox="0 0 64 44" aria-hidden="true"><path d="M4 24V18L32 7l28 11v6" fill="none" stroke="#f3f5f3" stroke-width="5"/><rect x="17" y="31" width="7" height="8" fill="#d96b36"/><rect x="29" y="27" width="7" height="12" fill="#d96b36"/><rect x="41" y="22" width="7" height="17" fill="#d96b36"/></svg>';
  const NAME = '<span class="brand-name">Garage<strong>Fit</strong></span>';
  const LABEL = 'GarageFit';

  function fill(host) {
    host.setAttribute('aria-label', LABEL);
    host.innerHTML = MARK + NAME;
    return host;
  }
  function mount(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return 0;
    const hosts = Array.from(doc.querySelectorAll('[data-masthead]'));
    hosts.forEach(fill);
    return hosts.length;
  }

  root.GarageFitMasthead = { MARK, NAME, LABEL, fill, mount };
})(typeof window !== 'undefined' ? window : globalThis);
