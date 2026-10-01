(function (root) {
  // Reusable equipment icons keyed by the canonical ids in data/equipment.js, plus
  // 'bodyweight' for the no-equipment case. All icons share one 24x24 single-colour
  // stroke style and inherit the surrounding text colour (currentColor).
  const ICONS = {
    bodyweight: '<circle cx="12" cy="5" r="2.5"/><path d="M12 8.5v6M6.5 11h11M12 14.5l-3.5 6M12 14.5l3.5 6"/>',
    kettlebell: '<path d="M9 9.5V7a3 3 0 0 1 6 0v2.5"/><circle cx="12" cy="15" r="5.5"/>',
    dumbbells: '<path d="M8 12h8M2 10.5v3M22 10.5v3"/><rect x="4" y="8" width="3" height="8" rx="1"/><rect x="17" y="8" width="3" height="8" rx="1"/>',
    barbell: '<path d="M2 12h20M6 6v12M9 8v8M18 6v12M15 8v8"/>',
    trx: '<circle cx="12" cy="3.5" r="1.5"/><path d="M12 5l-5 11M12 5l5 11"/><rect x="5" y="16" width="4" height="5" rx="1.5"/><rect x="15" y="16" width="4" height="5" rx="1.5"/>',
    'pullup-bar': '<path d="M3 5h18M9 5l3 5M15 5l-3 5M12 14v4M12 18l-2 3M12 18l2 3"/><circle cx="12" cy="12" r="2"/>',
    bands: '<ellipse cx="9" cy="12" rx="6" ry="4"/><ellipse cx="15" cy="12" rx="6" ry="4"/>',
    bench: '<rect x="3" y="10" width="18" height="4" rx="1.5"/><path d="M6 14v6M18 14v6"/>',
    box: '<path d="M12 3l8 4v10l-8 4-8-4V7zM4 7l8 4 8-4M12 11v10"/>'
  };

  function has(id) { return Object.prototype.hasOwnProperty.call(ICONS, id); }

  // Markup for one icon. Decorative by default (aria-hidden); the caller supplies any
  // accessible text. Unknown ids return an empty string.
  function svg(id, size) {
    if (!has(id)) return '';
    const px = size || 26;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + px + '" height="' + px +
      '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      ICONS[id] + '</svg>';
  }

  // The single most characteristic equipment id for an exercise: the first option of its
  // first equipment group, or 'bodyweight' when it needs none.
  function primaryEquipmentId(exercise) {
    const groups = (exercise && exercise.equipment) || [];
    return groups.length && groups[0].length ? groups[0][0] : 'bodyweight';
  }

  root.GarageFitEquipmentIcons = { ids: Object.keys(ICONS), has, svg, primaryEquipmentId };
})(typeof window !== 'undefined' ? window : globalThis);
