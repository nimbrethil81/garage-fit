(function (root) {
  const equipment = [
    { id: 'dumbbells', name: 'Dumbbells' },
    { id: 'kettlebell', name: 'Kettlebell' },
    { id: 'pullup-bar', name: 'Pull-up bar' },
    { id: 'trx', name: 'TRX' },
    { id: 'barbell', name: 'Barbell' },
    { id: 'bench', name: 'Bench' },
    { id: 'box', name: 'Box' },
    { id: 'bands', name: 'Resistance bands' }
  ];

  root.GarageFitData = root.GarageFitData || {};
  root.GarageFitData.equipment = equipment;

  // Ramp-up UI is loaded after the page's inline app code so it can safely
  // extend the generated preview/player functions. The version query prevents
  // stale PWA/browser caches from serving an older copy after updates.
  if (root.addEventListener && root.document) {
    root.addEventListener('load', () => {
      if (root.document.querySelector('script[data-rampup-ui]')) return;
      const script = root.document.createElement('script');
      script.src = 'js/rampup-ui.js?v=4';
      script.dataset.rampupUi = 'true';
      root.document.body.appendChild(script);
    });
  }
})(window);
