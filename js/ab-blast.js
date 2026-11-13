(function (root) {
  'use strict';
  // Deliberately curated for continuous core work. These action groups are
  // specialist sequencing policy, not new catalogue metadata or Main eligibility.
  var POLICY = [
    ['sit-up','curl',false], ['side-plank','lateral',true],
    ['reverse-crunch','hip-curl',false], ['plank','brace',true],
    ['dead-bug','contralateral',false], ['bicycle-crunch','rotation',false],
    ['flutter-kicks','leg-work',false], ['hollow-body-hold','brace',true],
    ['leg-raises','leg-work',false], ['seated-knee-tucks','hip-curl',false],
    ['bear-plank-hold','brace',true], ['plank-up-downs','arm-support',false],
    ['bodyweight-russian-twist','rotation',false], ['heel-touches','lateral',false],
    ['supine-arm-pulses','arm-pulses',false], ['v-ups','curl',false],
    ['bird-dog','contralateral',false], ['superman','posterior-extension',false]
  ];
  // Specialist intensity is independent of global difficulty (e.g. dead bug).
  var LOWER_INTENSITY = ['bird-dog','superman'];
  function lowerCount(sequence) {
    return sequence.filter(function (p) { return LOWER_INTENSITY.includes(p[0]); }).length;
  }
  function eligible(catalogue) {
    return POLICY.filter(function (p) {
      var ex = catalogue[p[0]];
      return ex && ex.equipment.length === 0 && ex.bodyPosition === 'floor' && ex.bodyFocus === 'core' && !!ex.instruction;
    });
  }
  function balanced(sequence) {
    return sequence.filter(function (p) { return p[2]; }).length >= 2 &&
      sequence.filter(function (p) { return !p[2]; }).length >= 3 &&
      sequence.every(function (p) { return sequence.filter(function (q) { return p[1] === q[1]; }).length <= 3; });
  }
  function validate(plan, options) {
    var catalogue = (options || {}).catalogue || root.GarageFitData.exercises;
    var pool = eligible(catalogue), errors = [], steps = plan && plan.exercises;
    if (!Array.isArray(steps)) return {valid:false, errors:['Missing activities']};
    if (!plan.termination || plan.termination.type !== 'timed-sequence' || plan.termination.durationSeconds !== 300 ||
        (plan.transitionSeconds || 0) !== 0 || plan.blocks || plan.rounds) errors.push('Expected one continuous 300-second sequence');
    if (steps.length < 7 || steps.length > 9) errors.push('Expected 7–9 activities');
    if (steps.reduce(function (n,s) { return n+s.durationSeconds; },0) !== 300) errors.push('Expected exactly 300 exercise seconds');
    var sequence = [], seen = new Set();
    steps.forEach(function (step,i) {
      var policy = pool.find(function (p) { return p[0] === step.id; });
      if (!policy) { errors.push('Ineligible activity'); return; }
      if (![30,35,40,45].includes(step.durationSeconds) || (step.transitionAfter || 0) !== 0) errors.push('Invalid interval');
      if (i && Math.abs(step.durationSeconds-steps[i-1].durationSeconds)>10) errors.push('Adjacent timing jump');
      var ex = catalogue[step.id];
      if (ex.sidedness === 'per-side') {
        var pair = steps.filter(function (s) { return s.id === step.id; });
        if (pair.length !== 2 || pair[0].side !== 'left' || pair[1].side !== 'right' || pair[0].durationSeconds !== pair[1].durationSeconds ||
            steps.indexOf(pair[1]) !== steps.indexOf(pair[0])+1) errors.push('Unbalanced side pair');
        if (step.side === 'right') return;
      } else if (step.side != null) errors.push('Unexpected side');
      if (seen.has(step.id)) errors.push('Repeated movement');
      seen.add(step.id);
      var last = sequence[sequence.length-1];
      if (last && (last[1] === policy[1] || (ex.repetitionClass && ex.repetitionClass === catalogue[last[0]].repetitionClass))) errors.push('Adjacent overlapping movements');
      sequence.push(policy);
    });
    if (lowerCount(sequence) > 1) errors.push('Too many lower-intensity movements');
    if (!balanced(sequence)) errors.push('Insufficient core movement balance');
    return {valid:errors.length === 0,errors:errors};
  }
  function generate(options) {
    options = options || {};
    var catalogue = options.catalogue || root.GarageFitData.exercises, random = options.random || Math.random;
    function rank(items) { return items.map(function (value) { return {value:value,rank:random()}; }).sort(function (a,b) { return a.rank-b.rank; }).map(function (x) { return x.value; }); }
    // Draw once per composition, including Regenerate; no session counters.
    var desiredLower = random() < 0.2 ? 1 : 0;
    var targets = rank([7,8,9]), pool = rank(eligible(catalogue));
    if (!pool.some(function (p) { return LOWER_INTENSITY.includes(p[0]); })) desiredLower = 0;
    function slots(p) { return catalogue[p[0]].sidedness === 'per-side' ? 2 : 1; }
    function allocate(sequence) {
      var choices = sequence.map(function () { return rank([30,35,40,45]); });
      function visit(i,total,last,result) {
        if (i === sequence.length) return total === 300 ? result : null;
        var remaining = sequence.slice(i+1).reduce(function (n,p) { return n+slots(p); },0);
        for (var seconds of choices[i]) {
          var sum = total+seconds*slots(sequence[i]);
          if ((last && Math.abs(seconds-last)>10) || sum+remaining*30>300 || sum+remaining*45<300) continue;
          var found = visit(i+1,sum,seconds,result.concat(seconds));
          if (found) return found;
        }
        return null;
      }
      return visit(0,0,0,[]);
    }
    function search(sequence,count,target) {
      if (count === target) {
        if (!balanced(sequence) || lowerCount(sequence) !== desiredLower) return null;
        var durations = allocate(sequence);
        return durations ? {sequence:sequence,durations:durations} : null;
      }
      for (var p of pool) {
        var last = sequence[sequence.length-1], ex = catalogue[p[0]];
        if (lowerCount(sequence) + (LOWER_INTENSITY.includes(p[0]) ? 1 : 0) > desiredLower || count+slots(p)>target || sequence.includes(p) || (last && (last[1] === p[1] ||
            (ex.repetitionClass && ex.repetitionClass === catalogue[last[0]].repetitionClass)))) continue;
        var found = search(sequence.concat([p]),count+slots(p),target);
        if (found) return found;
      }
      return null;
    }
    var selected;
    if (pool.length >= 6) for (var target of targets) { selected = search([],0,target); if (selected) break; }
    // A constrained catalogue may lack a feasible lower-intensity composition.
    // Fall back to demanding work without relaxing timing or balance.
    if (!selected && desiredLower === 1 && pool.length >= 6) {
      desiredLower = 0;
      for (var fallbackTarget of targets) { selected = search([],0,fallbackTarget); if (selected) break; }
    }
    if (!selected) throw new Error('Ab Blast is unavailable: not enough suitable movements for a balanced five-minute workout.');
    var exercises = [];
    selected.sequence.forEach(function (p,i) {
      var ex = catalogue[p[0]], name = ex.id === 'plank' ? 'Front plank' : ex.name;
      (slots(p) === 2 ? ['left','right'] : [null]).forEach(function (side) {
        var step = {id:ex.id,name:name+(side ? ' - '+side[0].toUpperCase()+side.slice(1) : ''),durationSeconds:selected.durations[i]};
        if (side) step.side = side;
        exercises.push(step);
      });
    });
    var plan = {id:'abBlast',name:'5-Minute Ab Blast',subtitle:'5 min continuous',transitionSeconds:0,
      completionMessage:'Five minutes complete. Nice work.',termination:{type:'timed-sequence',durationSeconds:300},exercises:exercises};
    var checked = validate(plan,{catalogue:catalogue});
    if (!checked.valid) throw new Error('Invalid Ab Blast: '+checked.errors.join(', '));
    return plan;
  }
  root.GarageFitAbBlast = {generate:generate,validate:validate};
})(window);
