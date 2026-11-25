(function (root) {
  'use strict';

  const keyOf = group => JSON.stringify([...group].sort());
  const list = (items, conjunction) => items.length < 2 ? items[0] || ''
    : items.slice(0, -1).join(', ') + ' ' + conjunction + ' ' + items.at(-1);

  function createResolver(catalogue, equipment, sectionEquipmentSetup, owned) {
    const names = new Map(equipment.map(item => [item.id, item.name.toLowerCase()]));
    const available = owned || [];
    return {
      groups(exercise) {
        const groups = exercise?.equipment?.length ? exercise.equipment : catalogue[exercise?.id]?.equipment || [];
        const choices = groups.map(group => [...new Set(group.filter(id => names.has(id)))]);
        return unique(choices.filter(group => group.length).map(group => {
          // Pass only owned alternatives to the shared resolver; its fallback to the
          // first member is for setup planning, where a definite setup key is needed.
          const resolved = group.filter(id => available.includes(id));
          return resolved.length ? sectionEquipmentSetup({equipment: [resolved]}, available) : group;
        }));
      },
      label(groups) {
        return list(groups.map(group => {
          const label = list(group.map(id => names.get(id)), 'or');
          return groups.length > 1 && group.length > 1 ? 'either ' + label : label;
        }), 'and');
      }
    };
  }

  function unique(groups) {
    const singletons = new Set(groups.filter(group => group.length === 1).map(group => group[0]));
    const seen = new Set();
    return groups.filter(group => {
      const key = keyOf(group);
      if (seen.has(key) || group.length > 1 && group.some(id => singletons.has(id))) return false;
      seen.add(key);
      return true;
    });
  }

  function covered(group, keys) {
    return keys.has(keyOf(group)) || group.some(id => keys.has(keyOf([id])));
  }

  function speechSeconds(text) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
    return words ? words / 2.5 + 1.2 : 0;
  }

  // Include room to poll an idle synthesiser and yield before the phase boundary.
  const preparationSeconds = text => Math.max(3.25, speechSeconds(text));
  function spokenText(label, active = false) { return 'Get your ' + label + (active ? ' ready when you can.' : ' ready.'); }

  // Prefer recovery around the movement change. Look back past a short
  // changeover, including the recovery before the preceding exercise.
  function opportunity(path, target, label) {
    let work = null, exercises = 0;
    for (let i = target - 1; i >= 0; i--) {
      const slot = path[i];
      if (slot.ready) break;
      if (slot.exercise && ++exercises > 1) break;
      if (slot.window < preparationSeconds(spokenText(label, !!slot.exercise && !slot.recovery))) continue;
      if (slot.recovery) return i;
      if (work === null) work = i;
    }
    return work;
  }

  function createSession(resolver, preview = []) {
    const introduced = new Set(preview.map(keyOf)), used = new Set(introduced), spoken = new Set();
    const visible = new Map();
    let startGroups = [], currentKey;

    function visualLabel() {
      return resolver.label(unique([...startGroups, ...[...visible.values()].map(item => item.group)]));
    }

    function update(path, present = true) {
      if (!path.length) {
        visible.clear();
        startGroups = [];
        currentKey = undefined;
        return {visual: '', speech: null};
      }
      const current = path[0];
      const reachable = new Set(path.slice(1).filter(slot => slot.exercise).map(slot => slot.key));
      for (const [key, item] of visible) {
        if (!reachable.has(item.target)) visible.delete(key);
      }
      if (currentKey !== current.key) {
        currentKey = current.key;
        startGroups = [];
      }
      // Keep eligible cues already presented and discard obsolete ones. New cues
      // are only introduced when the player can actually show them.
      if (!present) return {visual: visualLabel(), speech: null};
      if (current.exercise) {
        startGroups.push(...current.groups.filter(group => !covered(group, introduced)));
        current.groups.forEach(group => {
          introduced.add(keyOf(group));
          used.add(keyOf(group));
        });
      }

      const requested = [];
      const planned = new Set(used);
      let passedExercise = false;
      for (let i = 1; i < path.length; i++) {
        const slot = path[i];
        if (!slot.exercise) continue;
        const groups = slot.groups.filter(group => !covered(group, planned));
        const chosen = groups.length && !current.ready ? opportunity(path, i, resolver.label(groups)) : null;
        for (const group of groups) {
          const key = keyOf(group);
          planned.add(key);
          if (chosen === 0 || chosen === null && !passedExercise) {
            if (!covered(group, introduced)) {
              visible.set(key, {target: slot.key, group});
              introduced.add(key);
            }
            // A shown visual counts as fallback. An interrupted utterance can still
            // complete on another useful slot for this same, still-upcoming exercise.
            if (chosen === 0 && visible.get(key)?.target === slot.key && !covered(group, spoken)) requested.push(group);
          }
        }
        passedExercise = true;
      }

      const groups = unique(requested);
      const text = groups.length ? spokenText(resolver.label(groups), !!current.exercise && !current.recovery) : '';
      return {
        visual: visualLabel(),
        speech: text ? {text, groups, seconds: preparationSeconds(text)} : null
      };
    }

    return {update, complete: offer => offer.groups.forEach(group => spoken.add(keyOf(group)))};
  }

  root.GarageFitEquipmentCues = {createResolver, createSession, spokenText, speechSeconds};
})(typeof window === 'undefined' ? globalThis : window);
