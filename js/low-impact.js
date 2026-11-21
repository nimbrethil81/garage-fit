(function (root) {
  'use strict';

  // GF-LOW1 (#421): a generated, quiet, equipment-free Low Impact workout for a small
  // clear floor space. This is a light-to-moderate full-body fitness session (warm-up,
  // standing and floor Main work, cool-down), not a recovery routine. The curated policy
  // is deliberately local: it changes no shared Generator/Coach eligibility, catalogue
  // metadata or other specialist composer. Every entry was reviewed against its catalogue
  // instruction for a small room: no wall, chair or other furniture, no travelling, no
  // jumping or hopping, and a controlled effort. Only timed-compatible entries are used:
  // a timed canonical prescription or the catalogue's timed-interval protocol; rep-only
  // movements (for example dead bug or bird dog) are never converted into timed work.
  var HISTORY_KEY = 'gf_low_impact_recent_v1';
  var RECENT_SESSIONS = 3;
  var NAME = 'Low Impact';
  var DURATIONS = [10, 15, 20, 30];
  var DEFAULT_DURATION = 20;
  var DESCRIPTION = 'Controlled strength and low-impact conditioning with no jumping and no equipment. Warm up, work through standing and floor exercises, then cool down. You need a small clear floor space; a mat is optional. Work at a comfortable, moderate effort and skip anything that feels uncomfortable. Changeovers are included in the time.';
  var COMPLETION = 'Low Impact complete. Nicely done.';

  // Changeovers (seconds) after a step.
  var CHANGE = { warmup: 5, cooldown: 5, side: 5, main: 10, position: 15, phase: 10 };
  // Default work bounds (seconds; per side for per-side entries), in 5-second steps.
  var BOUNDS = {
    warmup: { min: 25, max: 45 },
    main: { min: 30, max: 55, sideMin: 20, sideMax: 30 },
    cooldown: { min: 25, max: 45, sideMin: 20, sideMax: 30 }
  };

  // Phase allocations include every changeover: 10 = 2/7/1, 15 = 2/11/2, 20 = 3/15/2, 30 = 4/23/3.
  // Main alternates coherent standing and floor blocks, finishing on the floor for the cool-down.
  var WARMUP_SLOTS = {
    3: [['pulse'], ['upper', 'trunk'], ['lower']],
    4: [['pulse'], ['upper'], ['trunk'], ['lower']],
    5: [['pulse'], ['upper'], ['trunk'], ['lower'], ['pulse']]
  };
  var BLOCK_SLOTS = {
    standing: { 3: [['cardio', 'punch'], ['lower'], ['cardio', 'punch']], 4: [['lower'], ['cardio', 'punch'], ['lower', 'balance'], ['cardio', 'punch']] },
    floor: { 3: [['support'], ['core'], ['support']], 4: [['support'], ['core'], ['support', 'core'], ['core']] }
  };
  var PROFILES = {
    10: { warmup: 120, main: 420, cooldown: 60, warmupSlots: 3, blocks: [['standing', 4], ['floor', 4]], cooldownSlots: 2, repeats: 1, pushUps: 1 },
    15: { warmup: 120, main: 660, cooldown: 120, warmupSlots: 3, blocks: [['standing', 3], ['floor', 3], ['standing', 3], ['floor', 3]], cooldownSlots: 3, repeats: 1, pushUps: 1 },
    20: { warmup: 180, main: 900, cooldown: 120, warmupSlots: 4, blocks: [['standing', 4], ['floor', 4], ['standing', 4], ['floor', 4]], cooldownSlots: 3, repeats: 2, pushUps: 1 },
    30: { warmup: 240, main: 1380, cooldown: 180, warmupSlots: 5, blocks: [['standing', 4], ['floor', 4], ['standing', 4], ['floor', 4], ['standing', 4], ['floor', 4]], cooldownSlots: 4, repeats: 2, pushUps: 2 }
  };
  // A repeated Main movement must be in a later block with at least this many slots between.
  var REPEAT_GAP = 5;
  var LEVEL = { kneeling: 1, seated: 2, lying: 3 };

  // [id, section, position, tags, similarity group, work bounds override]
  var POOL = [
    // Warm-up: standing pulse raisers and mobility.
    ['marching-on-the-spot', 'warmup', 'standing', ['pulse'], 'march'],
    ['side-step-touches', 'warmup', 'standing', ['pulse'], 'side-step'],
    ['knee-to-opposite-elbow', 'warmup', 'standing', ['pulse'], 'knee-elbow'],
    ['arm-circles-forwards', 'warmup', 'standing', ['upper'], 'arm-circle'],
    ['arm-circles-backwards', 'warmup', 'standing', ['upper'], 'arm-circle'],
    ['arm-side-circles', 'warmup', 'standing', ['upper'], 'arm-circle'],
    ['shoulder-rolls', 'warmup', 'standing', ['upper'], 'shoulder-roll'],
    ['standing-scapular-protraction-retraction', 'warmup', 'standing', ['upper'], 'scapular'],
    ['body-twists', 'warmup', 'standing', ['trunk'], 'rotation'],
    ['standing-thoracic-rotation-with-reach', 'warmup', 'standing', ['trunk'], 'rotation'],
    ['standing-cross-body-reaches', 'warmup', 'standing', ['trunk'], 'cross-reach'],
    ['standing-side-bends', 'warmup', 'standing', ['trunk'], 'side-bend'],
    ['alternating-overhead-reach-side-shift', 'warmup', 'standing', ['trunk'], 'side-bend'],
    ['body-hoops', 'warmup', 'standing', ['trunk'], 'hip-circle'],
    ['shallow-knee-bends', 'warmup', 'standing', ['lower'], 'squat'],
    ['standing-hinge-and-reach', 'warmup', 'standing', ['lower'], 'hinge'],
    ['hamstring-sweeps', 'warmup', 'standing', ['lower'], 'hinge'],
    ['standing-lateral-weight-shifts', 'warmup', 'standing', ['lower'], 'weight-shift'],
    ['open-close-gates', 'warmup', 'standing', ['lower'], 'hip-circle'],

    // Main, standing: controlled lower-body strength, balance and grounded conditioning.
    ['air-squat', 'main', 'standing', ['lower'], 'squat', { max: 45 }],
    ['squat-to-alternating-knee-drive', 'main', 'standing', ['lower'], 'squat', { max: 45 }],
    ['squat-pulses', 'main', 'standing', ['lower'], 'squat', { max: 40 }],
    ['step-back-lunge', 'main', 'standing', ['lower'], 'lunge', { sideMax: 25 }],
    ['single-leg-balance-reach', 'main', 'standing', ['balance'], 'balance-reach', { sideMax: 25 }],
    ['clock-step-balance', 'main', 'standing', ['balance'], 'balance-tap', { sideMax: 25 }],
    ['lateral-step-and-stick', 'main', 'standing', ['balance'], 'balance-step', { max: 45 }],
    ['tandem-step-and-hold', 'main', 'standing', ['balance'], 'balance-step', { max: 40 }],
    ['power-march', 'main', 'standing', ['cardio'], 'march'],
    ['standing-knee-drive-march', 'main', 'standing', ['cardio'], 'march'],
    ['high-knee-power-steps', 'main', 'standing', ['cardio'], 'march', { max: 45 }],
    ['step-jacks', 'main', 'standing', ['cardio'], 'step-jack'],
    ['side-step-knee-lift', 'main', 'standing', ['cardio'], 'side-step'],
    ['alternating-hamstring-curl-steps', 'main', 'standing', ['cardio'], 'side-step'],
    ['low-impact-speed-skaters', 'main', 'standing', ['cardio'], 'skater', { max: 45 }],
    ['alternating-straight-punches', 'main', 'standing', ['punch'], 'punch'],
    ['alternating-hooks', 'main', 'standing', ['punch'], 'punch'],
    ['boxer-step-and-punches', 'main', 'standing', ['punch'], 'boxing-steps', { max: 45 }],
    ['boxing-slip-and-punch', 'main', 'standing', ['punch'], 'boxing-steps', { max: 45 }],

    // Main, floor: upper-body strength (standard press-ups), supported holds and core.
    ['push-up', 'main', 'floor', ['support', 'push'], 'push-up', { max: 40 }],
    ['plank', 'main', 'floor', ['support'], 'plank-hold', { max: 45 }],
    ['bear-plank-hold', 'main', 'floor', ['support'], 'plank-hold', { max: 30 }],
    ['bear-plank-shoulder-taps', 'main', 'floor', ['support'], 'plank-taps', { max: 40 }],
    ['side-plank', 'main', 'floor', ['support'], 'side-plank', { sideMax: 25 }],
    ['side-plank-knees', 'main', 'floor', ['support'], 'side-plank'],
    ['heel-touches', 'main', 'floor', ['core'], 'crunch', { max: 45 }],
    ['abdominal-crunch', 'main', 'floor', ['core'], 'crunch', { max: 45 }],
    ['bicycle-crunch', 'main', 'floor', ['core'], 'crunch', { max: 45 }],
    ['bodyweight-russian-twist', 'main', 'floor', ['core'], 'seated-twist', { max: 40 }],
    ['dead-bug-isometric-press', 'main', 'floor', ['core'], 'dead-bug', { sideMax: 25 }],
    ['superman', 'main', 'floor', ['core'], 'back-extension', { max: 40 }],

    // Cool-down: floor stretches that settle from kneeling to seated to lying.
    ['childs-pose', 'cooldown', 'kneeling', ['spine'], 'kneeling-reach'],
    ['extended-puppy-pose', 'cooldown', 'kneeling', ['spine'], 'kneeling-reach'],
    ['kneeling-hamstring', 'cooldown', 'kneeling', ['lower'], 'hamstring'],
    ['butterfly-stretch', 'cooldown', 'seated', ['lower'], 'adductor'],
    ['glute-stretch', 'cooldown', 'lying', ['lower'], 'glute'],
    ['supine-hamstring-stretch', 'cooldown', 'lying', ['lower'], 'hamstring'],
    ['lying-torso-twist', 'cooldown', 'lying', ['spine'], 'twist'],
    ['supine-knees-to-chest-stretch', 'cooldown', 'lying', ['spine'], 'knees-to-chest'],
    ['full-body-stretch', 'cooldown', 'lying', ['spine'], 'lengthen']
  ];

  // Defence in depth against catalogue drift: each curated entry is re-checked against its
  // canonical metadata and written set-up before any selection or playback.
  var FURNITURE = /\b(wall|chair|counter|bench|sofa|couch|bed|table|door(way)?|step-?up|box|rail|stairs?)\b/i;
  var REQUIRED_SUPPORT = /\b(hold(ing)?|face|facing|using|use) (a |the |your )?support\b(?! if needed)/i;
  var BALLISTIC = /\b(jump(s|ing)?|hop(s|ping)?|bounc(e|es|ing)|jog(s|ging)?|run(s|ning)?|sprint(s|ing)?|leap(s|ing)?|skip(s|ping)?|travel(s|ling)?|crawl(s|ing)?|explosive(ly)?)\b/i;
  var NEGATED = /\b(without|no|not|never) (jumping|hopping|bouncing|travelling|running)\b/gi;
  var SIDE_CUE = /\bside\b/i;
  var SECTIONS = ['warmup', 'main', 'cooldown'];

  function timedCompatible(ex) {
    if (ex.prescriptionModes && !ex.prescriptionModes.includes('time')) return false;
    var type = ex.prescription && ex.prescription.type;
    if (ex.sidedness === 'per-side') return type === 'unilateral-timed';
    return type === 'timed' || (Array.isArray(ex.mainProtocols) && ex.mainProtocols.includes('timed_intervals'));
  }
  function cuesValid(ex) {
    return Array.isArray(ex.timedCues) && ex.timedCues.every(function (cue) {
      return cue && typeof cue.text === 'string' && cue.at && cue.at.type === 'fraction' &&
        Number.isFinite(cue.at.value) && cue.at.value > 0 && cue.at.value < 1 &&
        !(ex.sidedness === 'per-side' && SIDE_CUE.test(cue.text));
    });
  }
  function entryEligible(ex, section, position) {
    if (!ex || typeof ex !== 'object' || typeof ex.id !== 'string' || typeof ex.name !== 'string' || !ex.name) return false;
    if (!Array.isArray(ex.equipment) || ex.equipment.length) return false;
    if (!['low', 'medium'].includes(ex.impact) || ex.difficulty === 'hard') return false;
    if (!(ex.cardio <= 3) || !(ex.strength <= 4)) return false;
    if (!['bilateral', 'none', 'alternating', 'per-side'].includes(ex.sidedness)) return false;
    if (ex.sidedness === 'per-side' && !(Array.isArray(ex.sideOrder) && ex.sideOrder.length === 2 &&
        ex.sideOrder.indexOf('right') >= 0 && ex.sideOrder.indexOf('left') >= 0)) return false;
    if (!timedCompatible(ex) || !cuesValid(ex)) return false;
    if (typeof ex.instruction !== 'string' || ex.instruction.trim().length < 20) return false;
    var text = ex.name + ' ' + ex.instruction;
    if (FURNITURE.test(ex.instruction) || REQUIRED_SUPPORT.test(ex.instruction)) return false;
    if (BALLISTIC.test(text.replace(NEGATED, ''))) return false;
    // Medium impact is accepted only for controlled squats and lunges, never conditioning.
    if (ex.impact === 'medium' && (ex.conditioning || !(ex.patterns || []).some(function (p) { return p === 'squat' || p === 'lunge'; }))) return false;
    if (section === 'cooldown') return ex.cooldown === true && ex.bodyPosition === 'floor';
    if (ex.cooldown) return false;
    return ex.bodyPosition === position;
  }
  function eligible(catalogue) {
    catalogue = catalogue || root.GarageFitData.exercises;
    return POOL.map(function (item) {
      var ex = catalogue[item[0]];
      if (!ex || ex.id !== item[0] || !entryEligible(ex, item[1], item[2])) return null;
      var bounds = BOUNDS[item[1]], override = item[5] || {}, perSide = ex.sidedness === 'per-side';
      var min = perSide ? override.sideMin || bounds.sideMin : override.min || bounds.min;
      var max = perSide ? override.sideMax || bounds.sideMax : override.max || bounds.max;
      if (!min || !max || min > max) return null;
      return { exercise: ex, section: item[1], position: item[1] === 'cooldown' ? 'floor' : item[2],
        level: item[1] === 'cooldown' ? LEVEL[item[2]] : 0, tags: item[3].slice(), group: item[4],
        perSide: perSide, min: min, max: max };
    }).filter(Boolean);
  }

  function readRecent(storage) {
    try {
      var value = JSON.parse(storage.getItem(HISTORY_KEY));
      return Array.isArray(value) ? value.filter(function (session) {
        return Array.isArray(session) && session.length > 0 && session.length <= 80 &&
          session.every(function (id) { return typeof id === 'string' && id; }) && new Set(session).size === session.length;
      }).slice(-RECENT_SESSIONS) : [];
    } catch (_) { return []; }
  }
  function planIds(plan) {
    var ids = [];
    plan.exercises.forEach(function (step) { if (!ids.includes(step.id)) ids.push(step.id); });
    return ids;
  }
  // Called only when a run starts; previews, duration changes and Regenerate never record.
  function recordStarted(storage, plan) {
    try { storage.setItem(HISTORY_KEY, JSON.stringify(readRecent(storage).concat([planIds(plan)]).slice(-RECENT_SESSIONS))); }
    catch (_) { /* Playback remains available without local storage. */ }
  }

  // Slot plan for a profile: one entry per activity (per-side activities are one slot).
  function slotPlan(profile) {
    var slots = [];
    WARMUP_SLOTS[profile.warmupSlots].forEach(function (tags) { slots.push({ section: 'warmup', position: 'standing', tags: tags, block: -1 }); });
    profile.blocks.forEach(function (block, index) {
      BLOCK_SLOTS[block[0]][block[1]].forEach(function (tags) { slots.push({ section: 'main', position: block[0], tags: tags, block: index }); });
    });
    for (var i = 0; i < profile.cooldownSlots; i++) slots.push({ section: 'cooldown', position: 'floor', tags: ['spine', 'lower'], block: -2 });
    return slots;
  }
  function changeoverAfter(current, next) {
    if (!next) return 0;
    if (current.section !== next.section) return CHANGE.phase;
    if (current.position !== next.position) return CHANGE.position;
    return CHANGE[current.section];
  }
  // Distribute a phase's exact work time over its activities in 5-second steps, as evenly
  // as each entry's bounds allow. Returns per-activity seconds (per side when per-side).
  function fitPhase(entries, workSeconds) {
    var values = entries.map(function (entry) { return entry.min; });
    var sides = entries.map(function (entry) { return entry.perSide ? 2 : 1; });
    var diff = workSeconds - values.reduce(function (sum, value, i) { return sum + value * sides[i]; }, 0);
    if (diff < 0 || diff % 5) return null;
    while (diff > 0) {
      var best = -1;
      for (var i = 0; i < entries.length; i++) {
        if (values[i] + 5 > entries[i].max || 5 * sides[i] > diff) continue;
        if (best < 0 || values[i] * sides[i] < values[best] * sides[best]) best = i;
      }
      if (best < 0) return null;
      values[best] += 5; diff -= 5 * sides[best];
    }
    return values;
  }
  // The slot plan is fixed, so a phase's changeovers (including the one into the next
  // phase) are known as soon as its activities are chosen.
  function phaseChangeovers(sequence, slots, section) {
    var total = 0;
    sequence.forEach(function (item, index) {
      if (item.slot.section !== section) return;
      if (item.entry.perSide) total += CHANGE.side;
      total += changeoverAfter(item.slot, slots[index + 1] || null);
    });
    return total;
  }

  function generate(options) {
    options = options || {};
    var duration = options.duration == null ? DEFAULT_DURATION : options.duration;
    var profile = PROFILES[duration];
    if (!profile) throw new Error('Low Impact is available for 10, 15, 20 or 30 minutes.');
    var catalogue = options.catalogue || root.GarageFitData.exercises;
    var random = options.random || Math.random;
    var recent = new Set(Array.isArray(options.recent) ? options.recent.slice(-RECENT_SESSIONS).flat() : []);
    var pool = eligible(catalogue).map(function (entry) { return { entry: entry, order: random() }; });
    var slots = slotPlan(profile);
    var timings = {};
    var nodes = 0;

    function candidates(slot, sequence) {
      var used = {};
      sequence.forEach(function (item) { used[item.entry.exercise.id] = (used[item.entry.exercise.id] || 0) + 1; });
      // Fresh movements first, then those not used in the last few started sessions, then a
      // random order. Recency only reorders valid candidates; it never displaces a rule.
      return pool.filter(function (item) {
        var entry = item.entry;
        return entry.section === slot.section && entry.position === slot.position &&
          entry.tags.some(function (tag) { return slot.tags.includes(tag); });
      }).sort(function (a, b) {
        var ua = used[a.entry.exercise.id] || 0, ub = used[b.entry.exercise.id] || 0;
        if (ua !== ub) return ua - ub;
        var ra = recent.has(a.entry.exercise.id) ? 1 : 0, rb = recent.has(b.entry.exercise.id) ? 1 : 0;
        return ra - rb || a.order - b.order;
      }).map(function (item) { return item.entry; });
    }
    function allowed(entry, slot, sequence) {
      var index = sequence.length, last = sequence[index - 1], id = entry.exercise.id;
      if (last && (last.entry.exercise.id === id || last.entry.group === entry.group)) return false;
      var previous = sequence.filter(function (item) { return item.entry.exercise.id === id; });
      if (previous.length) {
        if (slot.section !== 'main' || previous.length >= profile.repeats) return false;
        var latest = sequence.lastIndexOf(previous[previous.length - 1]);
        if (previous.some(function (item) { return item.slot.block === slot.block; }) || index - latest <= REPEAT_GAP) return false;
      }
      var inBlock = sequence.filter(function (item) { return item.slot.section === slot.section && item.slot.block === slot.block; });
      if (entry.tags.includes('push')) {
        if (sequence.filter(function (item) { return item.entry.tags.includes('push'); }).length >= profile.pushUps) return false;
        if (inBlock.some(function (item) { return item.entry.tags.includes('push'); })) return false;
      }
      if (entry.perSide && inBlock.filter(function (item) { return item.entry.perSide; }).length >= (slot.section === 'main' ? 1 : 2)) return false;
      if (entry.tags.includes('balance') && inBlock.some(function (item) { return item.entry.tags.includes('balance'); })) return false;
      if (slot.section === 'cooldown' && last && last.slot.section === 'cooldown' && entry.level < last.entry.level) return false;
      return true;
    }
    function phaseComplete(sequence, section) {
      var items = sequence.filter(function (item) { return item.slot.section === section; });
      if (section === 'main') {
        // Every standing block includes lower-body strength.
        var standingBlocks = {};
        items.forEach(function (item) { if (item.slot.position === 'standing') standingBlocks[item.slot.block] = standingBlocks[item.slot.block] || item.entry.tags.includes('lower'); });
        if (Object.keys(standingBlocks).some(function (block) { return !standingBlocks[block]; })) return false;
        if (identicalBlocks(items)) return false;
      }
      if (section === 'cooldown' && items.length >= 2) {
        var regions = new Set(items.flatMap(function (item) { return item.entry.tags; }));
        if (!regions.has('lower') || !regions.has('spine')) return false;
      }
      var work = profile[section] - phaseChangeovers(sequence, slots, section);
      var values = fitPhase(items.map(function (item) { return item.entry; }), work);
      if (!values) return false;
      timings[section] = values;
      return true;
    }
    function search(sequence) {
      if (++nodes > 60000) return null;
      var index = sequence.length;
      if (index === slots.length) return sequence;
      var slot = slots[index];
      var list = candidates(slot, sequence);
      for (var i = 0; i < list.length; i++) {
        if (!allowed(list[i], slot, sequence)) continue;
        var next = sequence.concat([{ entry: list[i], slot: slot }]);
        var nextSlot = slots[index + 1];
        if ((!nextSlot || nextSlot.section !== slot.section) && !phaseComplete(next, slot.section)) continue;
        var found = search(next);
        if (found) return found;
      }
      return null;
    }
    var selected = search([]);
    if (!selected) throw new Error('Low Impact is unavailable: there are not enough suitable exercises for a balanced ' + duration + '-minute session. Please try again later.');

    var steps = [], counters = { warmup: 0, main: 0, cooldown: 0 };
    selected.forEach(function (item, index) {
      var ex = item.entry.exercise, section = item.slot.section, seconds = timings[section][counters[section]++];
      var next = selected[index + 1], after = changeoverAfter(item.slot, next ? next.slot : null);
      var base = { id: ex.id, section: section, position: item.slot.position };
      if (item.entry.perSide) {
        ex.sideOrder.forEach(function (side, sideIndex) {
          steps.push(Object.assign({}, base, { name: ex.name + ' - ' + (side === 'right' ? 'Right' : 'Left'), side: side,
            durationSeconds: seconds, transitionAfter: sideIndex === 0 ? CHANGE.side : after }));
        });
      } else steps.push(Object.assign({}, base, { name: ex.name, durationSeconds: seconds, transitionAfter: after }));
    });
    var plan = { id: 'lowImpact', name: NAME, durationMinutes: duration, subtitle: duration + ' min · Quiet full-body',
      description: DESCRIPTION, completionMessage: COMPLETION, generated: true,
      phases: { warmup: profile.warmup, main: profile.main, cooldown: profile.cooldown },
      termination: { type: 'fixed-sequence', durationSeconds: duration * 60 },
      transitionSeconds: CHANGE.main, exercises: steps };
    var check = validate(plan, catalogue);
    if (!check.valid) throw new Error('Low Impact could not be prepared. ' + check.errors.join(' '));
    return plan;
  }

  function identicalBlocks(items) {
    var blocks = {};
    items.forEach(function (item) { (blocks[item.slot.block] = blocks[item.slot.block] || []).push(item.entry.exercise.id); });
    var keys = Object.keys(blocks).map(function (block) { return blocks[block].join(); });
    return new Set(keys).size !== keys.length;
  }

  // Shared by the composer and the player: a plan is played only as validated, never
  // repaired or substituted.
  function validate(plan, catalogue) {
    catalogue = catalogue || root.GarageFitData.exercises;
    var errors = [];
    function fail(message) { errors.push(message); return { valid: false, errors: errors }; }
    var profile = plan && PROFILES[plan.durationMinutes];
    if (!plan || plan.id !== 'lowImpact' || !profile || !plan.termination || plan.termination.type !== 'fixed-sequence' ||
        plan.termination.durationSeconds !== plan.durationMinutes * 60 || !Array.isArray(plan.exercises) || !plan.exercises.length)
      return fail('The plan structure is invalid.');
    var byId = new Map();
    eligible(catalogue).forEach(function (entry) { byId.set(entry.exercise.id, entry); });
    var slots = [], total = 0, phaseSeconds = { warmup: 0, main: 0, cooldown: 0 };
    for (var i = 0; i < plan.exercises.length; i++) {
      var step = plan.exercises[i], entry = byId.get(step && step.id), last = i === plan.exercises.length - 1;
      if (!entry) return fail('An exercise is not eligible for Low Impact.');
      if (step.section !== entry.section || step.position !== entry.position) return fail('An exercise is in the wrong part of the workout.');
      if (!Number.isInteger(step.durationSeconds) || step.durationSeconds <= 0 ||
          !Number.isInteger(step.transitionAfter) || step.transitionAfter < 0 || (last && step.transitionAfter !== 0))
        return fail('Exercise or changeover durations are malformed.');
      total += step.durationSeconds + step.transitionAfter;
      phaseSeconds[entry.section] += step.durationSeconds + step.transitionAfter;
      var previous = slots[slots.length - 1];
      if (entry.perSide) {
        var sideIndex = previous && previous.entry === entry && previous.steps.length === 1 ? 1 : 0;
        if (step.side !== entry.exercise.sideOrder[sideIndex]) return fail('Sides are missing or out of order.');
        if (sideIndex === 1) {
          if (step.durationSeconds !== previous.steps[0].durationSeconds || previous.steps[0].transitionAfter !== CHANGE.side)
            return fail('Each side needs an equal period.');
          previous.steps.push(step);
          continue;
        }
      } else if (step.side != null) return fail('Only per-side exercises take a side.');
      if (previous && previous.entry.perSide && previous.steps.length !== 2) return fail('Both sides must be played consecutively.');
      slots.push({ entry: entry, steps: [step] });
    }
    var final = slots[slots.length - 1];
    if (final.entry.perSide && final.steps.length !== 2) return fail('Both sides must be played consecutively.');
    if (total !== plan.durationMinutes * 60) return fail('The plan must last exactly ' + plan.durationMinutes + ' minutes.');
    if (SECTIONS.some(function (section) { return phaseSeconds[section] !== profile[section]; })) return fail('Warm-up, Main and cool-down times are unbalanced.');
    var sectionIndex = slots.map(function (slot) { return SECTIONS.indexOf(slot.entry.section); });
    if (sectionIndex[0] !== 0 || sectionIndex[sectionIndex.length - 1] !== 2 || !sectionIndex.includes(1) ||
        sectionIndex.some(function (value, index) { return index && value < sectionIndex[index - 1]; }))
      return fail('The plan needs a warm-up, Main work and a cool-down in order.');
    var counts = {}, runs = [], pushes = 0;
    for (var s = 0; s < slots.length; s++) {
      var current = slots[s].entry, before = s ? slots[s - 1].entry : null, nextSlot = slots[s + 1];
      var work = slots[s].steps[0].durationSeconds, after = slots[s].steps[slots[s].steps.length - 1].transitionAfter;
      if (work < current.min || work > current.max || work % 5) return fail('Exercise durations are outside their safe range.');
      if (after !== changeoverAfter(current, nextSlot ? nextSlot.entry : null)) return fail('Changeovers are malformed.');
      if (before && (before.exercise.id === current.exercise.id || before.group === current.group)) return fail('Similar movements may not be back to back.');
      if (before && before.section === 'cooldown' && current.level < before.level) return fail('The cool-down must settle towards the floor.');
      var id = current.exercise.id, seen = counts[id] || [];
      if (seen.length && (current.section !== 'main' || seen.length >= profile.repeats || s - seen[seen.length - 1] <= REPEAT_GAP))
        return fail('Movements repeat too often or too closely.');
      counts[id] = seen.concat([s]);
      if (current.tags.includes('push')) pushes++;
      if (current.section === 'main') {
        var run = runs[runs.length - 1];
        if (!run || run.position !== current.position) runs.push(run = { position: current.position, entries: [] });
        run.entries.push(current);
      }
    }
    if (pushes > profile.pushUps) return fail('Press-ups may not dominate the session.');
    if (runs.length > profile.blocks.length || runs[0].position !== 'standing' || runs[runs.length - 1].position !== 'floor' ||
        runs.some(function (run) { return run.entries.length < 3; }))
      return fail('Standing and floor work must be grouped into coherent blocks.');
    if (runs.some(function (run) {
      var ids = run.entries.map(function (entry) { return entry.exercise.id; });
      var perSide = run.entries.filter(function (entry) { return entry.perSide; }).length;
      return new Set(ids).size !== ids.length || perSide > 1 || run.entries.filter(function (entry) { return entry.tags.includes('push'); }).length > 1 ||
        (run.position === 'standing' && !run.entries.some(function (entry) { return entry.tags.includes('lower'); }));
    })) return fail('A Main block is unbalanced.');
    var signatures = runs.map(function (run) { return run.entries.map(function (entry) { return entry.exercise.id; }).join(); });
    if (new Set(signatures).size !== signatures.length) return fail('Main blocks may not repeat identically.');
    var mainTags = new Set(slots.filter(function (slot) { return slot.entry.section === 'main'; }).flatMap(function (slot) { return slot.entry.tags; }));
    if (!mainTags.has('lower') || !mainTags.has('support') || !mainTags.has('core') || !(mainTags.has('cardio') || mainTags.has('punch')))
      return fail('Main work must cover lower body, upper body and core, and conditioning.');
    return { valid: true, errors: [] };
  }

  root.GarageFitLowImpact = { generate: generate, validate: validate, eligible: eligible, readRecent: readRecent,
    recordStarted: recordStarted, historyKey: HISTORY_KEY, name: NAME, description: DESCRIPTION,
    durations: DURATIONS.slice(), defaultDuration: DEFAULT_DURATION,
    profiles: JSON.parse(JSON.stringify(PROFILES)) };
})(typeof window !== 'undefined' ? window : globalThis);
