(function (root) {
  'use strict';

  // GF-EVENING1 (#394): a gentle, generated six-minute Evening Full-Body Reset.
  // This curated specialist policy is deliberately local: it does not change shared
  // Generator/Coach eligibility or catalogue metadata. Every entry was reviewed against
  // its catalogue instruction for a small, clear floor area with no wall, chair or
  // other furniture requirement, and for low, unhurried demand (no jumping, travelling,
  // pulse raising, strength/core sets, prone lying, forceful twisting or deep holds).
  var HISTORY_KEY = 'gf_evening_reset_recent_v1';
  var RECENT_SESSIONS = 3;
  var NAME = 'Evening Full-Body Reset';
  var DESCRIPTION = 'Gentle movement and stretching to unwind. Start standing, move to the floor once and finish with calm stretches; a mat is optional. Skip anything that feels uncomfortable. Changeovers are included in six minutes.';
  var SUBTITLE = '6 min · Standing to floor';
  var COMPLETION = 'Reset complete. Nice and easy.';
  var TOTAL_SECONDS = 360;
  var SLOT_SECONDS = 40;
  var SHORT_SLOT_SECONDS = 35;
  var CHANGEOVER_SECONDS = 5;
  var FLOOR_CHANGEOVER_SECONDS = 10;
  var MAX_PER_SIDE = 3;
  var REGIONS = ['upper', 'trunk', 'hips', 'lower'];
  // Floor set-ups settle progressively: hands and knees, then seated, then lying.
  var LEVEL = { standing: 0, kneeling: 1, seated: 2, lying: 3 };
  // Slot plan: three standing movements, one descent, two floor movements and three
  // floor stretches (5 movement/mobility + 3 stretching slots).
  var SLOTS = ['standing', 'standing', 'standing', 'floor', 'floor', 'stretch', 'stretch', 'stretch'];

  // [id, slot kind, set-up, regions]
  var POOL = [
    ['shoulder-rolls', 'standing', 'standing', ['upper']],
    ['arm-side-circles', 'standing', 'standing', ['upper']],
    ['arm-circles-backwards', 'standing', 'standing', ['upper']],
    ['standing-scapular-protraction-retraction', 'standing', 'standing', ['upper']],
    ['controlled-shoulder-rotations', 'standing', 'standing', ['upper']],
    ['standing-cross-body-reaches', 'standing', 'standing', ['upper', 'trunk']],
    ['standing-thoracic-rotation-with-reach', 'standing', 'standing', ['trunk', 'upper']],
    ['alternating-overhead-reach-side-shift', 'standing', 'standing', ['upper', 'trunk', 'hips']],
    ['body-twists', 'standing', 'standing', ['trunk']],
    ['standing-side-bends', 'standing', 'standing', ['trunk']],
    ['body-hoops', 'standing', 'standing', ['hips', 'trunk']],
    ['open-close-gates', 'standing', 'standing', ['hips']],
    ['standing-lateral-weight-shifts', 'standing', 'standing', ['hips', 'lower']],
    ['standing-hinge-and-reach', 'standing', 'standing', ['hips', 'lower']],
    ['hamstring-sweeps', 'standing', 'standing', ['lower', 'hips']],
    ['shallow-knee-bends', 'standing', 'standing', ['lower']],
    ['heel-toe-rocks', 'standing', 'standing', ['lower']],

    ['cat-cow', 'floor', 'kneeling', ['trunk']],
    ['thread-the-needle', 'floor', 'kneeling', ['upper', 'trunk']],
    ['quadruped-thoracic-rotation', 'floor', 'kneeling', ['trunk', 'upper']],
    ['adductor-rock-backs', 'floor', 'kneeling', ['hips', 'lower']],
    ['kneeling-ankle-rocks', 'floor', 'kneeling', ['lower']],
    ['half-kneeling-hip-flexor-rocks-with-reach', 'floor', 'kneeling', ['hips']],
    ['ninety-ninety-hip-switches', 'floor', 'seated', ['hips']],
    ['seated-thoracic-extension', 'floor', 'seated', ['trunk', 'upper']],
    ['side-lying-open-books', 'floor', 'lying', ['trunk', 'upper']],
    ['supine-heel-slides', 'floor', 'lying', ['hips', 'lower']],
    ['bent-knee-fallout', 'floor', 'lying', ['hips']],

    ['childs-pose', 'stretch', 'kneeling', ['trunk', 'hips']],
    ['extended-puppy-pose', 'stretch', 'kneeling', ['upper', 'trunk']],
    ['kneeling-hamstring', 'stretch', 'kneeling', ['lower']],
    ['butterfly-stretch', 'stretch', 'seated', ['hips']],
    ['supine-hamstring-stretch', 'stretch', 'lying', ['lower']],
    ['glute-stretch', 'stretch', 'lying', ['hips']],
    ['lying-torso-twist', 'stretch', 'lying', ['trunk']],
    ['supine-knees-to-chest-stretch', 'stretch', 'lying', ['trunk', 'hips']],
    ['full-body-stretch', 'stretch', 'lying', ['upper', 'trunk']]
  ];

  // Defence in depth against catalogue drift: the curated pool is re-checked against
  // the canonical entry, including its written set-up, before any selection.
  var FURNITURE = /\b(wall|chair|counter|bench|sofa|couch|bed|table|door(way)?|step|box|rail)\b/i;
  var REQUIRED_SUPPORT = /\b(hold(ing)?|face|facing|using|use) (a |the |your )?support\b(?! if needed)/i;
  var SIDE_CUE = /\bside\b/i;
  function sidesValid(ex) {
    return Array.isArray(ex.sideOrder) && ex.sideOrder.length === 2 &&
      ex.sideOrder.indexOf('right') >= 0 && ex.sideOrder.indexOf('left') >= 0;
  }
  function cuesValid(ex) {
    return Array.isArray(ex.timedCues) && ex.timedCues.every(function (cue) {
      return cue && typeof cue.text === 'string' && cue.at && cue.at.type === 'fraction' &&
        Number.isFinite(cue.at.value) && cue.at.value > 0 && cue.at.value < 1 &&
        // A per-side occurrence is one side; a "change side" cue would contradict it.
        !(ex.sidedness === 'per-side' && SIDE_CUE.test(cue.text));
    });
  }
  function entryEligible(ex, kind) {
    if (!ex || typeof ex !== 'object' || typeof ex.id !== 'string' || typeof ex.name !== 'string' || !ex.name) return false;
    if (!Array.isArray(ex.equipment) || ex.equipment.length) return false;
    if (ex.impact !== 'low' || !(ex.cardio <= 2) || !(ex.strength <= 2)) return false;
    if (ex.difficulty === 'moderate' || ex.difficulty === 'hard' || ex.conditioning) return false;
    if (!['bilateral', 'none', 'alternating', 'per-side'].includes(ex.sidedness)) return false;
    if (ex.sidedness === 'per-side' && !sidesValid(ex)) return false;
    if (ex.prescriptionModes && !ex.prescriptionModes.includes('time')) return false;
    if (typeof ex.instruction !== 'string' || ex.instruction.trim().length < 20) return false;
    if (FURNITURE.test(ex.instruction) || REQUIRED_SUPPORT.test(ex.instruction) || /\bface down\b|\bprone\b/i.test(ex.instruction)) return false;
    if (!cuesValid(ex)) return false;
    if (kind === 'standing') return ex.bodyPosition === 'standing' && !ex.cooldown;
    if (kind === 'floor') return ex.bodyPosition === 'floor' && !ex.cooldown;
    return ex.bodyPosition === 'floor' && ex.cooldown === true && Array.isArray(ex.stretchTargets) && ex.stretchTargets.length > 0;
  }
  function eligible(catalogue) {
    catalogue = catalogue || root.GarageFitData.exercises;
    return POOL.map(function (entry) {
      var ex = catalogue[entry[0]];
      if (!ex || ex.id !== entry[0] || !entryEligible(ex, entry[1])) return null;
      return { exercise: ex, kind: entry[1], setup: entry[2], level: LEVEL[entry[2]], regions: entry[3].slice(), perSide: ex.sidedness === 'per-side' };
    }).filter(Boolean);
  }

  function readRecent(storage) {
    try {
      var value = JSON.parse(storage.getItem(HISTORY_KEY));
      return Array.isArray(value) ? value.filter(function (session) {
        return Array.isArray(session) && session.length > 0 && session.length <= SLOTS.length &&
          session.every(function (id) { return typeof id === 'string' && id; }) && new Set(session).size === session.length;
      }).slice(-RECENT_SESSIONS) : [];
    } catch (_) { return []; }
  }
  function planIds(plan) {
    var ids = [];
    plan.exercises.forEach(function (step) { if (!ids.includes(step.id)) ids.push(step.id); });
    return ids;
  }
  // Called only when a run starts; previews and Regenerate never record a session.
  function recordStarted(storage, plan) {
    try { storage.setItem(HISTORY_KEY, JSON.stringify(readRecent(storage).concat([planIds(plan)]).slice(-RECENT_SESSIONS))); }
    catch (_) { /* Playback remains available without local storage. */ }
  }

  function familyOf(ex) { return ex.family || ex.id; }
  function covered(sequence) {
    var set = new Set();
    sequence.forEach(function (item) { item.regions.forEach(function (region) { set.add(region); }); });
    return set;
  }

  function timedSteps(sequence) {
    var perSide = sequence.filter(function (item) { return item.perSide; }).length;
    var shortened = 0, steps = [];
    sequence.forEach(function (item, slot) {
      var ex = item.exercise, last = slot === sequence.length - 1;
      var after = last ? 0 : (slot === 2 ? FLOOR_CHANGEOVER_SECONDS : CHANGEOVER_SECONDS);
      if (item.perSide) {
        // Both sides consecutively, equal halves of a full slot, in canonical order.
        ex.sideOrder.forEach(function (side, index) {
          steps.push({ id: ex.id, name: ex.name + ' - ' + (side === 'right' ? 'Right' : 'Left'), side: side,
            durationSeconds: SLOT_SECONDS / 2, transitionAfter: index === 0 ? CHANGEOVER_SECONDS : after });
        });
        return;
      }
      // Each per-side change of side costs one ordinary changeover. Keep exactly six
      // minutes by trimming that many single-interval movement slots, earliest first.
      var seconds = SLOT_SECONDS;
      if (item.kind !== 'stretch' && shortened < perSide) { seconds = SHORT_SLOT_SECONDS; shortened++; }
      steps.push({ id: ex.id, name: ex.name, durationSeconds: seconds, transitionAfter: after });
    });
    return steps;
  }

  function generate(options) {
    options = options || {};
    var catalogue = options.catalogue || root.GarageFitData.exercises;
    var random = options.random || Math.random;
    var recent = Array.isArray(options.recent) ? options.recent.slice(-RECENT_SESSIONS).flat() : [];
    var pool = eligible(catalogue);
    // Random order within recency bands; recency only reorders valid candidates, so it
    // can never displace safety, coverage, sidedness, calm order or exact timing.
    var ranked = pool.map(function (entry) {
      return { entry: entry, rank: (recent.includes(entry.exercise.id) ? 1 : 0) + random() };
    }).sort(function (a, b) { return a.rank - b.rank; }).map(function (item) { return item.entry; });
    var bySlot = SLOTS.map(function (kind, slot) {
      return ranked.filter(function (entry) { return entry.kind === kind && (slot < SLOTS.length - 1 || entry.setup === 'lying'); });
    });
    var reachable = bySlot.map(function (_, slot) {
      var set = new Set();
      bySlot.slice(slot).forEach(function (list) { list.forEach(function (entry) { entry.regions.forEach(function (r) { set.add(r); }); }); });
      return set;
    });
    var nodes = 0;
    function search(sequence) {
      if (++nodes > 20000) return null;
      var slot = sequence.length;
      if (slot === SLOTS.length) {
        var perSide = sequence.filter(function (item) { return item.perSide; }).length;
        var single = sequence.filter(function (item) { return item.kind !== 'stretch' && !item.perSide; }).length;
        return perSide <= single && covered(sequence).size === REGIONS.length ? sequence : null;
      }
      var have = covered(sequence);
      if (!REGIONS.every(function (region) { return have.has(region) || reachable[slot].has(region); })) return null;
      if (slot === 3 && covered(sequence).size < 2) return null; // a varied standing opener
      var last = sequence[slot - 1];
      for (var i = 0; i < bySlot[slot].length; i++) {
        var entry = bySlot[slot][i];
        if (sequence.some(function (item) { return item.exercise.id === entry.exercise.id || familyOf(item.exercise) === familyOf(entry.exercise); })) continue;
        if (last && entry.level < last.level) continue; // settle down, never back up
        if (entry.perSide && sequence.filter(function (item) { return item.perSide; }).length >= MAX_PER_SIDE) continue;
        var found = search(sequence.concat([entry]));
        if (found) return found;
      }
      return null;
    }
    var selected = bySlot.every(function (list) { return list.length; }) ? search([]) : null;
    if (!selected) throw new Error('Evening Full-Body Reset is unavailable: there are not enough suitable gentle movements and stretches for a balanced six-minute session. Please try again later.');
    var plan = { id: 'eveningFullBodyReset', name: NAME, subtitle: SUBTITLE, description: DESCRIPTION,
      completionMessage: COMPLETION, generated: true,
      termination: { type: 'fixed-sequence', durationSeconds: TOTAL_SECONDS },
      transitionSeconds: CHANGEOVER_SECONDS, exercises: timedSteps(selected) };
    var check = validate(plan, catalogue);
    if (!check.valid) throw new Error('Evening Full-Body Reset could not be prepared. ' + check.errors.join(' '));
    return plan;
  }

  // Shared by the composer and the player: a plan is played only as validated, never
  // repaired or substituted.
  function validate(plan, catalogue) {
    catalogue = catalogue || root.GarageFitData.exercises;
    var errors = [];
    function fail(message) { errors.push(message); return { valid: false, errors: errors }; }
    if (!plan || plan.id !== 'eveningFullBodyReset' || !plan.termination || plan.termination.type !== 'fixed-sequence' ||
        plan.termination.durationSeconds !== TOTAL_SECONDS || !Array.isArray(plan.exercises) || !plan.exercises.length)
      return fail('The plan structure is invalid.');
    var byId = new Map();
    eligible(catalogue).forEach(function (entry) { byId.set(entry.exercise.id, entry); });
    var total = 0, slots = [];
    for (var i = 0; i < plan.exercises.length; i++) {
      var step = plan.exercises[i], entry = byId.get(step && step.id), last = i === plan.exercises.length - 1;
      if (!entry) return fail('An exercise is not eligible for this reset.');
      if (!Number.isInteger(step.durationSeconds) || step.durationSeconds <= 0 ||
          !Number.isInteger(step.transitionAfter) || step.transitionAfter < 0 || (last && step.transitionAfter !== 0))
        return fail('Exercise or changeover durations are malformed.');
      total += step.durationSeconds + step.transitionAfter;
      var previous = slots[slots.length - 1];
      if (entry.perSide) {
        var index = previous && previous.entry === entry && previous.sides.length === 1 ? 1 : 0;
        if (step.side !== entry.exercise.sideOrder[index]) return fail('Sides are missing or out of order.');
        if (index === 1) {
          if (step.durationSeconds !== previous.steps[0].durationSeconds || previous.steps[0].transitionAfter !== CHANGEOVER_SECONDS)
            return fail('Each side needs an equal period.');
          previous.sides.push(step.side); previous.steps.push(step);
          continue;
        }
      } else if (step.side != null) return fail('Only per-side exercises take a side.');
      if (previous && previous.entry.perSide && previous.sides.length !== 2) return fail('Both sides must be played consecutively.');
      slots.push({ entry: entry, sides: entry.perSide ? [step.side] : [], steps: [step] });
    }
    if (slots.length && slots[slots.length - 1].entry.perSide && slots[slots.length - 1].sides.length !== 2) return fail('Both sides must be played consecutively.');
    if (total !== TOTAL_SECONDS) return fail('The plan must last exactly six minutes.');
    if (slots.length !== SLOTS.length) return fail('The plan needs eight activities.');
    var ids = slots.map(function (slot) { return slot.entry.exercise.id; });
    if (new Set(ids).size !== ids.length || new Set(slots.map(function (slot) { return familyOf(slot.entry.exercise); })).size !== ids.length)
      return fail('Activities may not repeat.');
    for (var s = 0; s < slots.length; s++) {
      var slotEntry = slots[s].entry, steps = slots[s].steps, after = steps[steps.length - 1].transitionAfter;
      if (slotEntry.kind !== SLOTS[s]) return fail('The standing, floor and stretching order is unsound.');
      if (s > 0 && slotEntry.level < slots[s - 1].entry.level) return fail('The floor sequence must not move back up.');
      var expected = s === slots.length - 1 ? 0 : s === 2 ? FLOOR_CHANGEOVER_SECONDS : CHANGEOVER_SECONDS;
      if (after !== expected) return fail('Changeovers are malformed.');
      var work = steps.reduce(function (sum, item) { return sum + item.durationSeconds; }, 0);
      if (!(work === SLOT_SECONDS || (!slotEntry.perSide && slotEntry.kind !== 'stretch' && work === SHORT_SLOT_SECONDS)))
        return fail('Exercise durations are malformed.');
    }
    if (slots[slots.length - 1].entry.setup !== 'lying') return fail('The reset must finish lying down.');
    if (slots.filter(function (slot) { return slot.entry.perSide; }).length > MAX_PER_SIDE) return fail('Too many per-side activities.');
    if (covered(slots.map(function (slot) { return slot.entry; })).size !== REGIONS.length) return fail('The plan must cover the whole body.');
    return { valid: true, errors: [] };
  }

  root.GarageFitEveningReset = { generate: generate, validate: validate, eligible: eligible, readRecent: readRecent,
    recordStarted: recordStarted, historyKey: HISTORY_KEY, name: NAME, description: DESCRIPTION, subtitle: SUBTITLE };
})(typeof window !== 'undefined' ? window : globalThis);
