(function (root) {
  'use strict';
  const LADDER = Object.freeze([25, 50, 50, 50, 50, 50, 25]);
  const HISTORY_KEY = 'gf_300_challenge_history_v1';
  const copy = value => JSON.parse(JSON.stringify(value));
  const catalogue = options => options.catalogue || root.GarageFitData.exercises;
  const generator = () => root.GarageFitGenerator;
  // Challenge-specific dose review, not a second catalogue. Only these controlled,
  // countable movements have been reviewed for this much total work in mini-sets.
  // 25-only movements limit impact, overhead loading or demanding suspension work.
  // Absence means unreviewed, regardless of an exercise's generic difficulty tag.
  const CAPS = Object.freeze(Object.fromEntries([
    ['air-squat',50], ['walking-lunge',50], ['push-up',50], ['hand-release-push-up',50],
    ['bicycle-crunch',50], ['leg-raises',50], ['seated-knee-tucks',50], ['glute-bridge',50],
    ['cossack-squat',50], ['curtsy-lunge',50], ['alternating-lateral-lunge',50],
    ['burpees',25], ['squat-jumps',25],
    ['goblet-squat',50], ['dumbbell-front-squat',50], ['dumbbell-sumo-squat',50],
    ['dumbbell-romanian-deadlift',50], ['dumbbell-deadlift',50],
    ['dumbbell-floor-press',50], ['dumbbell-bench-press',50], ['dumbbell-bent-over-row',50],
    ['dumbbell-close-grip-floor-press',50], ['dumbbell-shoulder-press',25],
    ['kettlebell-goblet-squat',50], ['kettlebell-deadlift',50], ['kettlebell-sumo-squat',50],
    ['kettlebell-swing',50], ['kettlebell-dead-stop-swing',25],
    ['band-row',50], ['band-chest-press',50], ['banded-squat',50], ['band-romanian-deadlift',50],
    ['ring-row',50], ['ring-press-up',25], ['trx-row',50], ['trx-chest-press',50],
    ['trx-knee-tuck',25], ['trx-glute-bridge',50], ['trx-hamstring-curl',25],
    ['barbell-deadlift',50], ['barbell-romanian-deadlift',50], ['barbell-bent-over-row',50],
    ['barbell-floor-press',50], ['barbell-overhead-press',25], ['barbell-front-squat',25]
  ]));
  function error(message) { return Object.assign(new Error(message), {code:'challenge-infeasible'}); }
  function eligible(ex, reps, equipment) {
    return !!ex && CAPS[ex.id] >= reps && ex.generator && ex.main && ex.mainRole === 'primary'
      && ex.prescription.type === 'reps' && ['bilateral','alternating'].includes(ex.sidedness)
      && (ex.sidedness !== 'alternating' || reps % 2 === 0)
      && generator().requirementsMet(ex, equipment);
  }
  const lower = ex => ex.patterns.some(p => ['squat','hinge','lunge'].includes(p)) && ex.bodyFocus !== 'upper';
  const pureCore = ex => ex.patterns.includes('core') && !ex.patterns.some(p => ['push','pull','hinge'].includes(p));
  function compatible(sequence, ex) {
    if (sequence.some(other => other.id === ex.id || generator().sameFamily(other, ex))) return false;
    const previous = sequence.at(-1);
    if (previous && (generator().sharedPatterns(previous,ex).some(p => ['push','pull','squat','hinge','lunge','core'].includes(p)))) return false;
    const all = sequence.concat(ex);
    return all.filter(lower).length <= 3 && all.filter(pureCore).length <= 2
      && all.filter(item => item.impact === 'high').length <= 1
      && all.filter(item => item.patterns.includes('push')).length <= 2
      && all.filter(item => item.patterns.includes('hinge')).length <= 2;
  }
  function balance(exercises, available) {
    const patterns = new Set(exercises.flatMap(ex => ex.patterns));
    return patterns.has('push') && patterns.has('hinge') && patterns.has('core')
      && (patterns.has('squat') || patterns.has('lunge'))
      && exercises.some(ex => ex.conditioning && ex.cardio >= 4)
      && exercises.filter(ex => ex.difficulty !== 'easy' && ex.strength >= 3).length >= 3
      && (!available.some(ex => ex.patterns.includes('pull')) || patterns.has('pull'));
  }
  function shuffle(items, random) {
    const result = items.slice();
    for (let i=result.length-1;i>0;i--) {
      const value = random();
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw error('The challenge random source is invalid.');
      const j=Math.floor(value*(i+1)); [result[i],result[j]]=[result[j],result[i]];
    }
    return result;
  }
  function slot(ex, reps) {
    const loaded = ex.equipment.some(group => group.some(id => ['dumbbells','kettlebell','barbell','bands'].includes(id)));
    const suspended = ex.equipment.some(group => group.some(id => ['rings','trx'].includes(id)));
    return {exerciseId:ex.id,name:ex.name,reps,load:loaded ? 'Self-selected manageable resistance; never a maximal load.' : null,
      setup:loaded ? 'Choose controlled resistance; use mini-sets if needed and stop before technique fails.' : suspended ? 'Set a stable anchor and an angle you can control for the full target; mini-sets are optional.' : 'Use controlled full-range reps; stop before technique fails.',
      counting:ex.sidedness === 'alternating' ? 'Count each side as one rep; alternate evenly.' : 'Count one complete movement as one rep.',
      instruction:ex.instruction};
  }
  function generate(options = {}) {
    const equipment = (options.equipment || []).slice(), random = options.random || Math.random;
    const available = Object.values(catalogue(options)).filter(ex => eligible(ex,25,equipment) || eligible(ex,50,equipment));
    const pools = LADDER.map(reps => shuffle(available.filter(ex => eligible(ex,reps,equipment)), random));
    let visits=0;
    function search(chosen) {
      if (++visits > 100000) return null;
      if (chosen.length === 7) return balance(chosen,available) ? chosen : null;
      for (const ex of pools[chosen.length]) {
        if (!compatible(chosen,ex)) continue;
        const result=search(chosen.concat(ex)); if (result) return result;
      }
      return null;
    }
    const selected=search([]);
    if (!selected) throw error('Your equipment cannot currently support a balanced Hard 300-rep challenge with seven reviewed exercises. Add suitable equipment or choose another workout.');
    return {schemaVersion:1,policyVersion:1,workoutId:'workout300',title:'300-Rep Challenge',difficulty:'hard',equipment,
      exercises:selected.map((ex,index) => slot(ex,LADDER[index]))};
  }
  function prescriptionShape(value) {
    return value && value.schemaVersion === 1 && value.policyVersion === 1 && value.workoutId === 'workout300'
      && value.title === '300-Rep Challenge' && value.difficulty === 'hard'
      && Array.isArray(value.equipment) && value.equipment.every(id => typeof id === 'string')
      && Array.isArray(value.exercises) && value.exercises.length === 7
      && new Set(value.exercises.map(ex => ex?.exerciseId)).size === 7
      && value.exercises.every((ex,i) => ex && typeof ex.exerciseId === 'string' && ex.exerciseId.length > 0
        && ex.reps === LADDER[i] && ['name','setup','counting','instruction'].every(key => typeof ex[key] === 'string' && ex[key].length > 0)
        && (ex.load === null || typeof ex.load === 'string'));
  }
  function validate(value, options = {}) {
    const issues=[];
    if (!prescriptionShape(value)) return {valid:false,issues:['Invalid Challenge prescription.']};
    const equipment=options.equipment || value.equipment, definitions=catalogue(options);
    const available=Object.values(definitions).filter(ex => eligible(ex,25,equipment) || eligible(ex,50,equipment));
    const selected=[];
    for (const item of value.exercises) {
      const ex=definitions[item.exerciseId];
      if (!eligible(ex,item.reps,equipment)) issues.push('An exercise is unavailable or unsuitable for its repetition target.');
      else {
        if (!compatible(selected,ex)) issues.push('The sequence repeats movement fatigue or exceeds the impact limit.');
        selected.push(ex);
      }
    }
    if (selected.length !== 7 || !balance(selected,available)) issues.push('The challenge does not meet Hard full-body balance.');
    return {valid:issues.length===0,issues};
  }
  function swap(value, index, options = {}) {
    if (Object.isFrozen(value)) throw error('This challenge has started and its prescription is locked.');
    if (!Number.isInteger(index) || index < 0 || index > 6) throw error('Choose a valid challenge exercise.');
    const equipment=options.equipment || value.equipment;
    const candidates=shuffle(Object.values(catalogue(options)).filter(ex => ex.id !== value.exercises[index].exerciseId
      && eligible(ex,LADDER[index],equipment)), options.random || Math.random);
    for (const ex of candidates) {
      const next=copy(value); next.equipment=equipment.slice(); next.exercises[index]=slot(ex,LADDER[index]);
      if (validate(next,{...options,equipment}).valid) return next;
    }
    throw error('No compatible replacement preserves this challenge\'s rep target, movement balance and fatigue limits. Try regenerating the complete challenge.');
  }
  function deepFreeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  }
  function freeze(value, options = {}) {
    const checked=validate(value,options);
    if (!checked.valid) throw error(checked.issues.join(' '));
    return deepFreeze(copy(value));
  }
  function validResult(value) {
    return value && value.schemaVersion === 1 && typeof value.resultId === 'string' && value.resultId.length > 0
      && ['completed','partial','abandoned'].includes(value.status)
      && Number.isSafeInteger(value.elapsedSeconds) && value.elapsedSeconds >= 0
      && typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt))
      && prescriptionShape(value.prescription);
  }
  function validHistory(value) {
    return value && value.version === 1 && Array.isArray(value.results) && value.results.every(validResult)
      && new Set(value.results.map(result => result.resultId)).size === value.results.length;
  }
  function createResult(prescription, {resultId,elapsedSeconds,completedAt,status='completed'} = {}) {
    const result={schemaVersion:1,resultId,elapsedSeconds,completedAt,status,prescription:copy(prescription)};
    if (!validResult(result)) throw error('The challenge result is incomplete or invalid.');
    return deepFreeze(result);
  }
  function readHistory(storage) {
    const raw=storage.getItem(HISTORY_KEY);
    if (raw === null) return {version:1,results:[]};
    let history; try { history=JSON.parse(raw); } catch (_) { throw error('The saved challenge history is damaged.'); }
    if (!validHistory(history)) throw error('The saved challenge history is damaged.');
    return history;
  }
  function saveResult(storage,result) {
    if (!validResult(result)) throw error('The challenge result is incomplete or invalid.');
    const history=readHistory(storage), existing=history.results.find(item => item.resultId === result.resultId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(result)) throw error('A different challenge result already uses this identity.');
      return existing;
    }
    history.results.push(copy(result)); storage.setItem(HISTORY_KEY,JSON.stringify(history)); return result;
  }
  root.GarageFitChallenge300=Object.freeze({LADDER,HISTORY_KEY,generate,validate,eligible,swap,freeze,createResult,validHistory,readHistory,saveResult});
})(typeof window !== 'undefined' ? window : globalThis);
