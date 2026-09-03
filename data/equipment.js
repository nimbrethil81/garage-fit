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
})(window);
