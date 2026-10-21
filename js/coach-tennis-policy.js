(function (root) {
  // Pure Tennis decisions. The injected Generator preflight owns physical timing.
  const copy = value => JSON.parse(JSON.stringify(value));
  const Model = () => root.GarageFitCoachModel;
  const strength = root.GarageFitCoachPolicies.generalStrengthPolicy;
  const DAY = 86400000;
  const roleOverride = 'tennis-session-role';
  const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  // Date arithmetic is calendar-only; timezone/DST never changes the day distance.
  function calendarDate(value) {
    if (!Model().isLocalDate(value)) throw new Error('Tennis needs a valid local calendar date.');
    const [year,month,day] = value.split('-').map(Number), date = new Date(0);
    date.setUTCFullYear(year,month-1,day); date.setUTCHours(0,0,0,0); return date;
  }
  function initialiseState(input) {
    validateSettingsChange({definition: input.definition, previous: null,
      settings: settings(input.definition,null,input.context), context: input.context});
    const initial = strength.initialiseState(input);
    if (input.definition.phasePolicy) initial.currentTargets.tennisDevelopment = {
      schemaVersion: 1, phase: 'development', entryReason: 'programme-start',
      lastTransitionAt: input.context.now, developmentStartedAt: input.context.now,
      eligibleDevelopmentSessions: 0, consolidationSessions: 0, lastEvaluatedResultAt: null,
      sportReview: {lastPromptAt: null, eligibleSessions: 0, latestFeedback: null, easierNextSession: false}};
    return initial;
  }
  function validateState({definition, state}) {
    if (!definition.phasePolicy) return;
    const phase = state.currentTargets.tennisDevelopment;
    if (!phase) throw new Error('The saved Tennis development state is missing. Records have been retained.');
    if (!state.startedAt) throw new Error('Tennis development needs a known programme start timestamp. Records have been retained.');
    if (Date.parse(phase.developmentStartedAt) < Date.parse(state.startedAt)) throw new Error('Invalid Tennis development start.');
  }
  function phaseRecommendation({definition, state, now}) {
    if (!definition.phasePolicy) return null;
    const phase = state.currentTargets.tennisDevelopment, rule = definition.phasePolicy;
    const elapsedDays = Math.max(0, (Date.parse(now)-Date.parse(phase.developmentStartedAt))/DAY);
    const consolidation = phase.phase === 'consolidation' || phase.eligibleDevelopmentSessions >= rule.minimumDevelopmentSessions
      && elapsedDays >= rule.minimumDevelopmentDays;
    return {phase: consolidation ? 'consolidation' : 'development',
      reason: consolidation ? 'routine-consolidation' : phase.entryReason,
      eligiblePerformedSessions: phase.eligibleDevelopmentSessions,
      confidence: 'derived',
      rationale: consolidation
        ? 'A reduced-demand consolidation session is due after at least 6 meaningful Coach sessions and 21 days. Perform Main work to return to development; anchor targets are held.'
        : 'Development uses confirmed comparable anchor results to build reps. Recent performed work guides coverage; absence creates no catch-up work.',
      evidenceNote: 'Session counts and movement coverage describe performed work, not fitness or sporting improvement.'};
  }
  function sportReviewRecommendation({definition, state, now}) {
    if (!definition.sportReviewPolicy) return null;
    const review = state.currentTargets.tennisDevelopment.sportReview, rule = definition.sportReviewPolicy;
    return {due: state.status === 'active' && review.eligibleSessions >= rule.minimumSessions
      && (Date.parse(now)-Date.parse(review.lastPromptAt || state.startedAt))/DAY >= rule.minimumDays,
      latestFeedback: copy(review.latestFeedback), confidence: review.latestFeedback ? 'subjective' : 'unknown'};
  }
  function recordSportReview({definition, state, response, now}) {
    if (!sportReviewRecommendation({definition,state,now})?.due) throw new Error('A sport check-in is not due.');
    if (response !== null && (!response || Array.isArray(response) || typeof response !== 'object'
      || Object.keys(response).some(key => !['movement','endurance','comfort'].includes(key)))) throw new Error('Invalid sport check-in answers.');
    const next = copy(state), review = next.currentTargets.tennisDevelopment.sportReview;
    review.lastPromptAt = now; review.eligibleSessions = 0;
    if (response !== null) {
      review.latestFeedback = {...copy(response), timestamp: now};
      review.easierNextSession = Object.values(response).includes('worse');
    }
    // Model's closed namespace rejects missing, unknown and corrupt answers.
    return Model().assertValid('programme-state',next);
  }
  function beginSession({definition, state, prescription, now}) {
    const next = copy(state), recommendation = phaseRecommendation({definition,state,now});
    if (!recommendation || recommendation.phase !== 'consolidation') return next;
    if (!prescription.programmeContext.overrides.some(item => item.type === 'tennis-phase' && item.value === 'consolidation'))
      throw new Error('Prepare the due consolidation session again.');
    const phase = next.currentTargets.tennisDevelopment;
    if (phase.phase !== 'consolidation') Object.assign(phase, {phase: 'consolidation', entryReason: 'routine-consolidation', lastTransitionAt: now});
    return next;
  }
  function applyPerformedState({definition, state, result, meaningful}) {
    if (!definition.phasePolicy) return copy(state.currentTargets);
    const targets = copy(state.currentTargets), phase = targets.tennisDevelopment;
    const at = result.endedAt || result.startedAt;
    // Late older results cannot rewind a deliberate phase or grant post-review work.
    if (!at || Date.parse(at) < Date.parse(phase.lastEvaluatedResultAt || state.startedAt)) return targets;
    phase.lastEvaluatedResultAt = at;
    if (!meaningful) return targets;
    const overrides = result.overrides || [];
    const consolidation = overrides.some(item => item.type === 'tennis-phase' && item.value === 'consolidation');
    if (phase.phase === 'consolidation' && consolidation && Date.parse(at) >= Date.parse(phase.lastTransitionAt)) {
      phase.consolidationSessions++;
      if (phase.consolidationSessions >= definition.phasePolicy.consolidationSessions) Object.assign(phase, {
        phase: 'development', entryReason: 'performed-consolidation', lastTransitionAt: at,
        developmentStartedAt: at, eligibleDevelopmentSessions: 0, consolidationSessions: 0});
    } else if (phase.phase === 'development' && !consolidation && Date.parse(at) >= Date.parse(phase.developmentStartedAt)) {
      phase.eligibleDevelopmentSessions = Math.min(definition.phasePolicy.minimumDevelopmentSessions, phase.eligibleDevelopmentSessions+1);
    }
    const review = phase.sportReview;
    if (Date.parse(at) >= Date.parse(review.lastPromptAt || state.startedAt))
      review.eligibleSessions = Math.min(definition.sportReviewPolicy.minimumSessions,review.eligibleSessions+1);
    if (review.latestFeedback && Date.parse(at) >= Date.parse(review.latestFeedback.timestamp)
      && overrides.some(item => item.type === 'tennis-feedback-review')) review.easierNextSession = false;
    return targets;
  }
  function eventHorizon({definition, state, today}) {
    const rule = definition.eventPolicy, config = settings(definition,state);
    if (!rule || config.intent !== 'event') return null;
    const localDate = today.localDate === undefined ? today.now.slice(0,10) : today.localDate;
    const daysUntil = (calendarDate(config.significantEventDate)-calendarDate(localDate))/DAY;
    const phase = daysUntil < 0 ? 'expired' : daysUntil >= rule.buildMinimumDays ? 'build'
      : daysUntil >= rule.refineMinimumDays ? 'refine' : daysUntil >= rule.reducedMinimumDays ? 'reduced' : 'final';
    const reasons = {
      build: 'Event preparation: time allows normal progressive development; no compressed build or catch-up work.',
      refine: 'Event preparation: retain established strength and familiar movement; hold progression and avoid unfamiliar difficult or explosive work.',
      reduced: 'Event preparation: reduce demand before your event; prefer light established anchors and avoid power or fatiguing conditioning.',
      final: 'Your event is within two days: gentle trunk/shoulder work only, or rest. No hard legs or power; progression is held.',
      expired: 'Your event date has passed. Return to ongoing development or explicitly choose a new event date; your anchors and progress are retained.'
    };
    return {phase, daysUntil, localDate, eventDate: config.significantEventDate,
      label: config.significantEventLabel || null, holdProgression: phase !== 'build',
      nextAction: phase === 'expired' ? 'return-ongoing-or-change-event' : null,
      rationale: reasons[phase], evidenceNote: 'Conservative pilot preferences, not a guaranteed peak. Dates never confirm sport participation or award training credit.'};
  }
  function validateSettingsChange({definition, previous, settings: config, context}) {
    if (!definition.eventPolicy || config.intent !== 'event'
      || previous?.intent === 'event' && previous.significantEventDate === config.significantEventDate) return;
    const localDate = context.localDate === undefined ? context.now?.slice(0,10) : context.localDate;
    if (!localDate) throw new Error('Selecting an event needs today’s local calendar date.');
    if (calendarDate(config.significantEventDate) < calendarDate(localDate)) throw new Error('Choose an event date today or in the future.');
  }
  function classifyContext({definition, state, today}) {
    const rule = definition.contextPolicy;
    if (!rule) return null; // Preserve the released v1 policy.
    const config = settings(definition,state), context = today.sessionContext || {};
    Model().assertSessionContext(context);
    // Offset-bearing timestamps retain their calendar label. Callers using UTC
    // timestamps for local planning supply localDate (the browser controller does).
    const localDate = today.localDate === undefined ? today.now.slice(0,10) : today.localDate;
    const date = calendarDate(localDate), distance = value => (calendarDate(value)-date)/DAY;
    const checkIn = context.readiness;
    if (checkIn && distance(checkIn.localDate) > 0) throw new Error('Readiness cannot be reported for a future local day.');
    const readiness = checkIn && checkIn.localDate === localDate ? checkIn.value : 'normal';
    const reported = context.reportedSportActivity || [];
    if (reported.some(item => distance(item.localDate) > 0 || distance(item.localDate) < -rule.recentReportDays)) {
      throw new Error('Sport activity must be explicitly reported within the last '+rule.recentReportDays+' local days, never in the future.');
    }
    const confirmed = reported.filter(item => item.sportId === config.sportId);
    const scheduled = [];
    for (let offset = 0; offset <= rule.nearbyDays; offset++) {
      const day = new Date(date.getTime()+offset*DAY);
      if (config.usualPlayingDays.includes(weekdays[day.getUTCDay()])) scheduled.push({
        localDate: day.toISOString().slice(0,10), intensity: config.typicalSportIntensity, confirmation: 'planned'});
    }
    const nearby = value => distance(value) >= 0 && distance(value) <= rule.nearbyDays;
    const matchDate = context.plannedMatchDate && nearby(context.plannedMatchDate) ? context.plannedMatchDate : null;
    const eventDate = config.significantEventDate && nearby(config.significantEventDate) ? config.significantEventDate : null;
    const recentHard = confirmed.some(item => item.intensity === 'hard' && distance(item.localDate) >= -rule.nearbyDays);
    const plannedHard = scheduled.some(item => item.intensity === 'hard');
    const rest = readiness === 'tired' && (recentHard || matchDate === localDate || eventDate === localDate);
    const lighter = readiness === 'tired' || today.easyToday === true || recentHard || plannedHard || !!matchDate || !!eventDate;
    const reasons = [];
    if (readiness === 'tired') reasons.push('tired today');
    if (plannedHard) reasons.push('lighter before planned tennis');
    if (recentHard) reasons.push('lighter after reported hard tennis');
    if (matchDate) reasons.push('lighter before a planned match');
    if (eventDate) reasons.push('lighter before your planned event');
    if (today.easyToday) reasons.push('easy today');
    const requestedDuration = today.duration === undefined ? definition.sessionTemplate.duration : today.duration;
    if (requestedDuration <= 15) reasons.push('short session');
    return {localDate, readiness, scheduledSport: scheduled, reportedSportActivity: copy(confirmed),
      plannedMatchDate: matchDate, plannedEventDate: eventDate,
      classification: rest ? 'rest' : lighter ? 'lighter' : 'usual',
      reasons, recommendation: rest ? 'Rest today; no workout is prescribed. Your anchors and progression are retained.' : null};
  }
  function trainingContext(definition, today, adaptation) {
    if (!adaptation) return today;
    const rule = definition.contextPolicy, lighter = adaptation.classification !== 'usual';
    if (today.allowedImpact !== undefined && (!Array.isArray(today.allowedImpact)
      || today.allowedImpact.some(impact => !['low','medium','high'].includes(impact)))) throw new Error('Invalid availability constraints.');
    const requested = today.duration === undefined ? definition.sessionTemplate.duration : today.duration;
    const final = adaptation.event?.phase === 'final';
    const permittedImpact = final ? definition.eventPolicy.finalImpact : rule.lighterImpact;
    return {...today, smallSpace: today.smallSpace === undefined ? rule.homeSmallSpace : today.smallSpace,
      ...(lighter ? {easyToday: true,
        // Unsupported budgets still fail rather than being silently repaired.
        duration: definition.supportedDurations.includes(requested) ? Math.min(requested,
          final ? definition.eventPolicy.finalDurationMinutes : adaptation.readiness === 'tired' ? rule.tiredDurationMinutes : rule.lighterDurationMinutes) : requested,
        allowedImpact: (today.allowedImpact || permittedImpact).filter(impact => permittedImpact.includes(impact))} : {})};
  }
  function settings(definition, state, context = {}) {
    return Model().createProgrammeSettings(context.programmeSettings
      || state && state.currentTargets.programmeSettings || definition.defaultProgrammeSettings);
  }
  function coveragePolicy(definition, catalogue) {
    const pin = definition.sportPolicy;
    const mapping = root.GarageFitData.sportCapabilityPolicies[pin.sportId][pin.version];
    return root.GarageFitSportCoverage.createPolicy(mapping, catalogue);
  }
  function validateProgrammeSettings({definition, settings: value}) {
    Model().assertProgrammeSettings(value);
    if (value.sportId !== 'tennis') throw new Error('Tennis Conditioning requires tennis settings.');
    if (definition?.eventPolicy && value.intent === 'event' && !value.significantEventDate)
      throw new Error('Event preparation requires an explicitly selected local event date.');
  }
  function validateDefinition(definition) {
    strength.validateDefinition(definition);
    validateProgrammeSettings({settings: settings(definition)});
    if (definition.anchorRotationPolicy !== undefined &&
      (definition.anchorRotationPolicy.tieBreak !== 'last-performed' || Object.keys(definition.anchorRotationPolicy).length !== 1))
      throw new Error('Invalid Tennis anchor rotation policy.');
    if (definition.type !== 'tennis-conditioning' || !definition.openEnded
      || definition.coverageTargets.windowDays !== 14 || definition.progressionPolicy.strategy !== 'double-progression'
      || definition.progressionPolicy.minReps !== 6 || definition.progressionPolicy.maxReps !== 10
      || definition.shortSessionPolicy.tiers.length || !Number.isFinite(definition.preparationTimingReserveSeconds)
      || definition.preparationTimingReserveSeconds < 0) throw new Error('Invalid Tennis training contract.');
    const requirements = definition.anchorSelectionPolicy.requirements;
    if (requirements.length !== 4 || new Set(requirements.map(item => item.roleId)).size !== 4
      || requirements.some(item => !['knee','hinge','push','pull'].includes(item.roleId)
        || item.importance !== 'required' || item.targetSets !== 2 || item.targetExposures !== undefined
        || item.prescriptionMode !== 'reps' || item.target.minReps !== 6 || item.target.maxReps !== 6
        || !Array.isArray(item.patterns) || !item.patterns.length || item.patterns.some(pattern => !Model().MOVEMENT_PATTERNS.includes(pattern))
        || item.allowedProtocols.length !== 1 || item.allowedProtocols[0] !== 'rounds')) throw new Error('Tennis needs four two-set rounds anchors.');
    const pin = definition.sportPolicy, mappings = root.GarageFitData && root.GarageFitData.sportCapabilityPolicies;
    if (!root.GarageFitSportCoverage || !pin || pin.sportId !== 'tennis' || !mappings || !mappings.tennis[pin.version]) throw new Error('Tennis needs its pinned sport capability mapping.');
    const capabilities = mappings.tennis[pin.version].capabilities.map(item => item.id);
    if (definition.roleCompositionPolicy && (pin.version < 2
      || Object.entries(definition.roleCompositionPolicy.roles || {}).some(([id, caps]) =>
        !Object.values(definition.sessionRoles).flat().some(role => role.id === id)
        || !Array.isArray(caps) || !caps.length || caps.some(cap => !capabilities.includes(cap)))))
      throw new Error('Invalid Tennis role composition policy.');
    [1,2,3].forEach(frequency => {
      const roles = definition.sessionRoles && definition.sessionRoles[frequency];
      if (!Array.isArray(roles) || roles.length !== frequency || new Set(roles.map(role => role.id)).size !== frequency
        || roles.some(role => !role.id || !role.label || !Array.isArray(role.capabilities) || !role.capabilities.length
          || role.capabilities.some(id => !capabilities.includes(id)) || !Array.isArray(role.anchorLimits)
          || role.anchorLimits.length !== definition.supportedDurations.length
          || role.anchorLimits.some(value => !Number.isInteger(value) || value < 0 || value > 4))) throw new Error('Invalid Tennis session roles.');
    });
    if (definition.contextPolicy) {
      const rule = definition.contextPolicy;
      if (rule.nearbyDays !== 1 || rule.recentReportDays !== 7 || rule.lighterAnchorLimit !== 1 || rule.tiredAnchorSets !== 1
        || rule.homeSmallSpace !== true || !definition.supportedDurations.includes(rule.lighterDurationMinutes)
        || !definition.supportedDurations.includes(rule.tiredDurationMinutes) || rule.tiredDurationMinutes > rule.lighterDurationMinutes
        || !Array.isArray(rule.lighterImpact) || rule.lighterImpact.join(',') !== 'low,medium') throw new Error('Invalid Tennis context policy.');
    }
    if (definition.phasePolicy || definition.sportReviewPolicy) {
      const phase = definition.phasePolicy, review = definition.sportReviewPolicy;
      if (!definition.contextPolicy || !phase || !review || phase.minimumDevelopmentDays !== 21
        || phase.minimumDevelopmentSessions !== 6 || phase.consolidationSessions !== 1 || phase.consolidationAnchorSets !== 1
        || review.minimumDays !== 28 || review.minimumSessions !== 4) throw new Error('Invalid Tennis development pilot thresholds.');
    }
    if (definition.eventPolicy) {
      const rule = definition.eventPolicy;
      if (!definition.phasePolicy || rule.buildMinimumDays !== 15 || rule.refineMinimumDays !== 8
        || rule.reducedMinimumDays !== 3 || rule.reducedAnchorSets !== 1 || rule.finalAnchorLimit !== 0
        || rule.finalDurationMinutes !== 15 || !Array.isArray(rule.finalImpact) || rule.finalImpact.join(',') !== 'low')
        throw new Error('Invalid Tennis event pilot thresholds.');
    }
  }
  function anchorEligible(exercise, context, requirement) {
    if (!exercise || !exercise.main || !exercise.generator
      || !(exercise.equipment || []).every(group => group.some(id => (context.equipment || []).includes(id)))
      || (context.easyToday || context.difficulty === 'easy') && exercise.difficulty === 'hard') return false;
    return requirement.patterns.some(pattern => exercise.patterns.includes(pattern))
      && exercise.mainRole === 'primary' && !exercise.conditioning && exercise.strength >= exercise.cardio
      && !exercise.prescription.type.includes('timed') && exercise.mainProtocols.includes('rounds');
  }
  function anchorAlternatives({definition, catalogue, context, state, requirementId}) {
    const requirement = definition.anchorSelectionPolicy.requirements.find(item => item.requirementId === requirementId);
    if (!requirement) throw new Error('Unknown Tennis anchor role.');
    const adaptation = definition.contextPolicy && context.now ? classifyContext({definition,state,today:context}) : null;
    const today = trainingContext(definition,context,adaptation);
    const availability = adaptation ? coveragePolicy(definition,catalogue).availability(today) : [];
    return requirement.exerciseIds.filter(id => anchorEligible(catalogue[id], today, requirement)
      && (!adaptation || !today.allowedImpact || today.allowedImpact.includes(catalogue[id].impact))
      && !(adaptation && today.smallSpace && availability.some(cap => cap.candidates.some(candidate => candidate.exerciseId === id && candidate.reasons.includes('space'))))
      && !(adaptation && (today.avoidConstraints || []).some(avoid => avoid.importance === 'hard'
        && (avoid.exerciseId === id || avoid.pattern && catalogue[id].patterns.includes(avoid.pattern) || avoid.bodyRegion === catalogue[id].bodyFocus)))
      && !state.anchors.some(anchor => anchor.requirementId !== requirementId && anchor.exerciseId === id));
  }
  function anchorRequest(anchor) {
    const target = anchor.currentTarget || anchor;
    const request = {requirementId: anchor.requirementId, exerciseId: anchor.exerciseId, importance: 'required'};
    ['targetSets','target','prescriptionMode','allowedProtocols','suggestedLoad','loadUnit','loadInterpretation','progressionIntent'].forEach(key => {
      if (target[key] !== undefined) request[key] = copy(target[key]);
    });
    return request;
  }
  function fullAnchor(work, catalogue) {
    if (!work.length || work.some(item => item.status !== 'completed' || item.exposure.value < 1)) return false;
    const exercise = catalogue[work[0].exerciseId];
    if (!exercise || work.some(item => item.exerciseId !== exercise.id)) return false;
    const sides = exercise.sidedness === 'per-side' ? ['left','right'] : [null];
    return sides.every(side => work.filter(item => item.side === side).length >= 2);
  }
  function calculatePriorities({definition, catalogue, state, history, today, forFeasibility = false}) {
    const adaptation = forFeasibility ? null : classifyContext({definition,state,today});
    const event = forFeasibility ? null : eventHorizon({definition,state,today});
    if (adaptation && event) {
      adaptation.event = event;
      adaptation.reasons.push(event.rationale);
      if (event.phase === 'expired') {
        adaptation.classification = 'rest'; adaptation.recommendation = event.rationale;
      } else if (['reduced','final'].includes(event.phase) && adaptation.classification === 'usual') adaptation.classification = 'lighter';
    }
    const phase = forFeasibility ? null : phaseRecommendation({definition,state,now:today.now});
    const feedbackReview = !forFeasibility && definition.phasePolicy && state.currentTargets.tennisDevelopment.sportReview.easierNextSession;
    if (adaptation && (phase?.phase === 'consolidation' || feedbackReview)) {
      if (adaptation.classification === 'usual') adaptation.classification = 'lighter';
      if (phase?.phase === 'consolidation') adaptation.reasons.push('routine consolidation');
      if (feedbackReview) adaptation.reasons.push('easier session after your sport feedback; this is subjective context, not proof of a fitness decline');
    }
    today = trainingContext(definition,today,adaptation);
    const config = settings(definition, state), sport = coveragePolicy(definition, catalogue);
    const scope = {programmeInstanceId: state.programmeInstanceId, sections: ['main'], until: today.now,
      since: new Date(Date.parse(today.now) - 14 * DAY).toISOString()};
    const summary = sport.summarize(history, {...scope, now: today.now, focus: config.focus,
      equipment: today.equipment || [], allowedImpact: today.allowedImpact, smallSpace: today.smallSpace});
    const roles = definition.sessionRoles[config.weeklyCoachFrequency];
    const earnedRoles = Object.fromEntries(roles.map(role => [role.id,0]));
    // A preview/label alone cannot move the rotation. Tiny partial loops earn no turn.
    for (const result of history.sessionsForProgramme(state.programmeInstanceId, scope)) {
      if (!['completed','partial'].includes(result.finalStatus)) continue;
      const role = roles.find(item => (result.overrides || []).some(override => override.type === roleOverride && override.value === item.id));
      if (!role) continue;
      const work = history.sessionEvidence(result.sessionResultId).performances.filter(item => item.section === 'main' && item.semanticConfidence === 'derived');
      const anchorCredit = state.anchors.some(anchor => {
        const requirement = definition.anchorSelectionPolicy.requirements.find(item => item.requirementId === anchor.requirementId);
        const performed = work.filter(item => item.requirementId === anchor.requirementId);
        return performed.every(item => requirement.exerciseIds.includes(item.exerciseId)) && fullAnchor(performed,catalogue);
      });
      const supportCredit = work.some(item => item.requirementId && item.requirementId.startsWith('tennis-support-')
        && item.status === 'completed' && item.exposure.value >= 1
        && sport.classifyExercise(item.exerciseId).contributions.some(contribution => role.capabilities.includes(contribution.capabilityId)));
      if (anchorCredit || supportCredit) earnedRoles[role.id]++;
    }
    const role = roles.slice().sort((a,b) => earnedRoles[a.id]-earnedRoles[b.id] || roles.indexOf(a)-roles.indexOf(b))[0];
    const anchors = state.anchors.map((anchor,index) => {
      const requirement = definition.anchorSelectionPolicy.requirements.find(item => item.requirementId === anchor.requirementId);
      const earlierWork = history.performances.filter(item => item.programmeInstanceId === state.programmeInstanceId
        && item.requirementId === anchor.requirementId && item.section === 'main' && item.semanticConfidence === 'derived'
        && requirement.exerciseIds.includes(item.exerciseId)
        && item.occurredAt && Date.parse(item.occurredAt) <= Date.parse(scope.until));
      const work = earlierWork.filter(item => Date.parse(item.occurredAt) >= Date.parse(scope.since));
      const passes = work.reduce((sum,item) => sum + item.exposure.value / (catalogue[item.exerciseId].sidedness === 'per-side' ? 2 : 1),0);
      const tieWork = definition.anchorRotationPolicy?.tieBreak === 'last-performed' ? earlierWork : work;
      return {requirementId: anchor.requirementId, index, passes,
        lastPerformedAt: tieWork.filter(item => item.exposure.value > 0).map(item => new Date(item.occurredAt).toISOString()).at(-1) || null};
    }).sort((a,b) => a.passes-b.passes || (a.lastPerformedAt || '').localeCompare(b.lastPerformedAt || '') || a.index-b.index);
    const roleOrder = definition.roleCompositionPolicy?.roles[role.id] || role.capabilities;
    const roleRank = cap => roleOrder.includes(cap.capabilityId) ? roleOrder.indexOf(cap.capabilityId) : 99;
    const capabilities = summary.capabilities.slice().sort((a,b) => (definition.roleCompositionPolicy ? roleRank(a)-roleRank(b) : 0)
      || Number(b.priority === 'core' && b.coverage !== 'observed')-Number(a.priority === 'core' && a.coverage !== 'observed')
      || Number(b.coverage !== 'observed')-Number(a.coverage !== 'observed') || Number(b.preferred)-Number(a.preferred)
      || (role.capabilities.includes(a.capabilityId) ? role.capabilities.indexOf(a.capabilityId) : 99)
        -(role.capabilities.includes(b.capabilityId) ? role.capabilities.indexOf(b.capabilityId) : 99));
    if (adaptation && (adaptation.classification !== 'usual'
      && adaptation.reasons.some(reason => ['tired today','lighter before planned tennis','lighter after reported hard tennis',
        'lighter before a planned match','lighter before your planned event','easy today'].includes(reason))
      || ['reduced','final'].includes(event?.phase))) {
      // Prefer upper/trunk work around demanding tennis without banning all legs.
      anchors.sort((a,b) => Number(['knee','hinge'].includes(state.anchors[a.index].roleId))
        -Number(['knee','hinge'].includes(state.anchors[b.index].roleId)) || a.passes-b.passes || a.index-b.index);
      capabilities.sort((a,b) => Number(['trunk','upper-body'].includes(b.capabilityId))-Number(['trunk','upper-body'].includes(a.capabilityId)));
    }
    return {role, earnedRoles, anchors, capabilities, coverage: summary, movements: [], bodyRegions: [],
      ...(event ? {event} : {}),
      ...(phase ? {phase, sportReview: sportReviewRecommendation({definition,state,now:today.now}), feedbackReview: !!feedbackReview} : {}),
      ...(adaptation ? {adaptation} : {})};
  }
  function supportRequest(capabilityId, exercise) {
    const timed = exercise.prescription.type.includes('timed');
    return {requirementId: 'tennis-support-'+capabilityId, exerciseId: exercise.id, importance: 'required', targetSets: 1,
      prescriptionMode: timed ? 'time' : 'reps', allowedProtocols: ['rounds'],
      target: timed ? {type: 'timed', seconds: exercise.prescription.value}
        : {type: 'reps', minReps: exercise.prescription.value, maxReps: exercise.prescription.value}};
  }
  function buildPrescription({definition, catalogue, state, history, today, priorities, assessSessionPrescription, allowRoleFallback = true}) {
    const adaptation = priorities.adaptation;
    const event = priorities.event, final = event?.phase === 'final';
    const requestedDuration = today.duration === undefined ? definition.sessionTemplate.duration : today.duration;
    today = trainingContext(definition,today,adaptation);
    const lighter = adaptation && adaptation.classification !== 'usual';
    const config = settings(definition, state), role = priorities.role, sport = coveragePolicy(definition, catalogue);
    const duration = today.duration === undefined ? definition.sessionTemplate.duration : today.duration;
    // Preparation uses whole timed steps, including both sides. Reserve its rounding
    // allowance before selecting hard work; never shorten preparation or rest later.
    const availableMainSeconds = assessSessionPrescription && definition.supportedDurations.includes(duration)
      ? assessSessionPrescription(Model().createSessionPrescription({...definition.sessionTemplate, duration,
        prescriptionId: today.prescriptionId, programmeInstanceId: state.programmeInstanceId, sessionRole: role.id,
        equipment: today.equipment || []})).availableMainSeconds : null;
    const availability = sport.availability({equipment: today.equipment || [], allowedImpact: today.allowedImpact, smallSpace: today.smallSpace});
    const lowLoad = role.id === 'conditioning-resilience';
    const roleCapabilities = definition.roleCompositionPolicy?.roles[role.id];
    // Reviewed sport membership distinguishes lateral control from generic lunges.
    // Intrinsic mainRole/conditioning then excludes strength-heavy trunk compounds.
    const roleFitting = exercise => exercise.impact !== 'high' && sport.classifyExercise(exercise.id).contributions.some(item =>
      roleCapabilities?.includes(item.capabilityId) && (item.capabilityId !== 'trunk'
        || exercise.mainRole === 'supporting' || exercise.bodyFocus === 'core' && exercise.strength <= 3));
    const familiar = new Set(history.performances.filter(item => item.programmeInstanceId === state.programmeInstanceId
      && item.section === 'main' && item.status === 'completed' && item.exposure.value > 0
      && item.occurredAt && Date.parse(item.occurredAt) <= Date.parse(today.now)).map(item => item.exerciseId));
    // Safety constraints precede hard anchor selection and apply to preparation,
    // supporting targets, filler and swaps through the existing Generator seam.
    const eventAvoids = event && ['refine','reduced','final'].includes(event.phase) ? Object.values(catalogue).filter(exercise => {
      const power = sport.classifyExercise(exercise.id).contributions.some(item => item.capabilityId === 'power');
      return !familiar.has(exercise.id) && (exercise.impact === 'high' || exercise.difficulty === 'hard' || power
        || event.phase === 'reduced' && state.anchors.some(anchor => anchor.exerciseId === exercise.id))
        || final && exercise.main && (!['core','upper'].includes(exercise.bodyFocus)
          || exercise.difficulty !== 'easy' || exercise.conditioning || power
          || exercise.mainRole === 'primary' && exercise.bodyFocus !== 'core');
    }).map(exercise => ({requirementId: 'tennis-event-avoid-'+exercise.id, importance: 'hard', exerciseId: exercise.id})) : [];
    const numeric = exercise => exercise.equipment.some(group => group.some(id => definition.progressionPolicy.numericLoadEquipment.includes(id)));
    const prescription = Model().createSessionPrescription({...copy(definition.sessionTemplate), duration,
      ...(Number.isFinite(availableMainSeconds) ? {
        mainTimeLimitSeconds: Math.max(1,availableMainSeconds-definition.preparationTimingReserveSeconds), maximumDurationSeconds: duration*60} : {}),
      prescriptionId: today.prescriptionId, programmeInstanceId: state.programmeInstanceId, sessionRole: role.id,
      equipment: today.equipment || [], difficulty: today.easyToday ? 'easy' : definition.sessionTemplate.difficulty,
      ...(event && event.phase !== 'build' ? {variationPreference: 'familiar'} : {}),
      bodyFocus: today.bodyFocus || definition.sessionTemplate.bodyFocus, requiredAnchors: [], preferredAnchors: [],
      protocolConstraints: [{requirementId: 'tennis-protocols', importance: 'hard',
        allowedProtocols: roleCapabilities ? ['rounds','paired_sets','timed_intervals'] : ['rounds','paired_sets']}],
      ...(roleCapabilities ? {
        optionalMainExerciseIds: Object.values(catalogue).filter(roleFitting).map(exercise => exercise.id),
        movementPriorities: [{requirementId:'tennis-role-core',pattern:'core',priority:'primary'},
          {requirementId:'tennis-role-lunge',pattern:'lunge',priority:'secondary'}],
        bodyRegionPriorities: [{requirementId:'tennis-role-trunk',bodyRegion:'core',priority:'high'}]
      } : {}),
      avoidConstraints: [...(definition.sessionTemplate.avoidConstraints || []), ...(adaptation ? today.avoidConstraints || [] : []), ...eventAvoids,
        ...(definition.roleCompositionPolicy ? ['jumping-jacks','star-jumps'].map(exerciseId =>
          ({requirementId:'tennis-no-'+exerciseId,importance:'hard',exerciseId})) : []), ...Object.values(catalogue)
        .filter(exercise => today.allowedImpact && !today.allowedImpact.includes(exercise.impact)
          || today.smallSpace && availability.some(cap => cap.candidates.some(candidate => candidate.exerciseId === exercise.id && candidate.reasons.includes('space')))
          || lowLoad && exercise.main && exercise.strength >= exercise.cardio && !exercise.conditioning && exercise.mainRole === 'primary'
            && !(roleCapabilities && roleFitting(exercise)))
        .map(exercise => ({requirementId: 'tennis-avoid-'+exercise.id, importance: 'hard', exerciseId: exercise.id}))],
      programmeContext: {objective: definition.objective, mode: state.mode, frequency: {minSessionsPerWeek: config.weeklyCoachFrequency, maxSessionsPerWeek: config.weeklyCoachFrequency},
        roleLabel: role.label, repsInReserve: 2, warnings: [], deferredAnchorRequirementIds: [],
        ...(adaptation ? {adaptation, requestedDuration} : {}),
        ...(priorities.phase ? {phase: priorities.phase} : {}),
        ...(event ? {event} : {}),
        anchorResistance: Object.fromEntries(state.anchors.map(anchor => [anchor.requirementId, {exerciseId: anchor.exerciseId,
          numericLoad: numeric(catalogue[anchor.exerciseId]), setup: anchor.comparisonBaseline && anchor.comparisonBaseline.resistanceSetup || 'initial',
          ready: !event?.holdProgression && anchor.currentTarget.progressionIntent === definition.progressionPolicy.setupResistanceIntent}])),
        overrides: [{type: roleOverride, value: role.id}, ...(today.easyToday ? [{type: 'easy-today'}] : []),
          ...(event ? [{type: 'tennis-event', value: event.phase, eventDate: event.eventDate, localDate: event.localDate}] : []),
          ...(priorities.phase ? [{type: 'tennis-phase', value: priorities.phase.phase}] : []),
          ...(priorities.feedbackReview ? [{type: 'tennis-feedback-review'}] : []),
          ...(adaptation && adaptation.reasons.length ? [{type: 'tennis-adaptation', localDate: adaptation.localDate,
            readiness: adaptation.readiness, classification: adaptation.classification, reasons: adaptation.reasons}] : []),
          ...(today.duration !== undefined ? [{type: 'duration', value: duration}] : []), ...(today.bodyFocus ? [{type: 'body-focus', value: today.bodyFocus}] : [])]}});
    const warnings = prescription.programmeContext.warnings;
    const assess = request => assessSessionPrescription && assessSessionPrescription(Model().createSessionPrescription(request));
    const fits = request => { const assessment = assess(request); return assessment && assessment.status !== 'infeasible' && !assessment.hardConflicts.length; };
    const add = request => {
      if (prescription.requiredAnchors.some(item => item.exerciseId === request.exerciseId)) return false;
      if (!fits({...prescription, requiredAnchors: [...prescription.requiredAnchors,request]})) return false;
      prescription.requiredAnchors.push(request); return true;
    };
    if (adaptation && adaptation.classification === 'rest') {
      prescription.programmeContext.restRecommendation = adaptation.recommendation;
      prescription.programmeContext.deferredAnchorRequirementIds = state.anchors.map(anchor => anchor.requirementId);
      prescription.programmeContext.preflightAvailable = typeof assessSessionPrescription === 'function';
      return prescription;
    }
    const limit = Math.min(role.anchorLimits[definition.supportedDurations.indexOf(duration)] || 0,
      final ? definition.eventPolicy.finalAnchorLimit : lighter ? definition.contextPolicy.lighterAnchorLimit : 4);
    for (const priority of priorities.anchors) {
      const anchor = state.anchors.find(item => item.requirementId === priority.requirementId), request = anchorRequest(anchor);
      if (event?.holdProgression) request.progressionIntent = 'Hold established resistance and reps for event preparation; leave comfortable reps in reserve';
      if (priorities.phase?.phase === 'consolidation') request.targetSets = definition.phasePolicy.consolidationAnchorSets;
      if (adaptation && adaptation.readiness === 'tired') request.targetSets = definition.contextPolicy.tiredAnchorSets;
      if (event?.phase === 'reduced') request.targetSets = definition.eventPolicy.reducedAnchorSets;
      if (prescription.requiredAnchors.length < limit && add(request)) continue;
      prescription.programmeContext.deferredAnchorRequirementIds.push(anchor.requirementId);
      if (!lowLoad && !fits({...prescription, requiredAnchors: [request]})) warnings.push({code: 'tennis-anchor-unavailable', requirementId: anchor.requirementId,
        message: catalogue[anchor.exerciseId].name+' cannot fit its full target with today’s time/equipment. Its baseline is retained.'});
    }
    if (lighter) {
      // Limit filler demand as well as the hard subset. These stronger constraints
      // precede supporting selection and never relax an already selected target.
      const selected = new Set(prescription.requiredAnchors.map(item => item.exerciseId));
      Object.values(catalogue).filter(exercise => exercise.main && !selected.has(exercise.id)
        && (exercise.conditioning || exercise.mainRole === 'primary' && exercise.strength >= exercise.cardio
          && !(exercise.bodyFocus === 'core' && exercise.difficulty === 'easy')
          || sport.classifyExercise(exercise.id).contributions.some(item => item.capabilityId === 'power' || item.capabilityId === 'endurance')))
        .forEach(exercise => {
          if (!prescription.avoidConstraints.some(item => item.exerciseId === exercise.id && item.importance === 'hard'))
            prescription.avoidConstraints.push({requirementId: 'tennis-demand-avoid-'+exercise.id, importance: 'hard', exerciseId: exercise.id});
        });
    }
    const recent = exerciseId => history.exactExercisePerformances(exerciseId, {programmeInstanceId: state.programmeInstanceId, until: today.now, sections: ['main']})
      .filter(item => item.exposure.value > 0).map(item => new Date(item.occurredAt).toISOString()).at(-1) || '';
    // Re-sort for explicit feasibility/fallback roles too, without changing the
    // performed coverage summary or discarding long-term lower/upper coverage.
    const orderedCapabilities = definition.roleCompositionPolicy ? priorities.capabilities.slice().sort((a,b) =>
      ((roleCapabilities || role.capabilities).indexOf(a.capabilityId) < 0 ? 99 : (roleCapabilities || role.capabilities).indexOf(a.capabilityId))
      -((roleCapabilities || role.capabilities).indexOf(b.capabilityId) < 0 ? 99 : (roleCapabilities || role.capabilities).indexOf(b.capabilityId))) : priorities.capabilities;
    for (const capability of orderedCapabilities) {
      const available = availability.find(item => item.capabilityId === capability.capabilityId);
      const allowed = available.candidates.filter(item => item.available && !(prescription.difficulty === 'easy' && item.difficulty === 'hard')
        && !prescription.avoidConstraints.some(avoid => avoid.importance === 'hard' && avoid.exerciseId === item.exerciseId)
        && (!lowLoad || catalogue[item.exerciseId].mainRole === 'supporting' || catalogue[item.exerciseId].conditioning
          || roleCapabilities && roleFitting(catalogue[item.exerciseId])));
      if (!allowed.length) warnings.push({code: 'tennis-capability-unavailable', capabilityId: capability.capabilityId,
        message: capability.label+' has no suitable exercise with today’s equipment, space, impact or session constraints.'});
      if (available.missingFacets.length) warnings.push({code: 'tennis-capability-facets-unavailable', capabilityId: capability.capabilityId, facets: available.missingFacets,
        message: capability.label+': '+available.missingFacets.join(', ')+' are unavailable; no coverage is assumed.'});
      if (prescription.requiredAnchors.some(request => sport.classifyExercise(request.exerciseId).contributions.some(item => item.capabilityId === capability.capabilityId))) continue;
      // Complementary power/endurance follow their session roles, rather than
      // forcing every session to contain every capability or a ballistic target.
      if (capability.priority === 'complementary' && !role.capabilities.includes(capability.capabilityId)) continue;
      // Movement roles retain their selected stable anchors, then reserve their
      // own purpose before generic strength gaps. Other roles own those gaps.
      if (roleCapabilities && !roleCapabilities.includes(capability.capabilityId)) continue;
      const candidates = allowed.filter(item => !state.anchors.some(anchor => anchor.exerciseId === item.exerciseId)
        && (!roleCapabilities || roleFitting(catalogue[item.exerciseId])))
        .sort((a,b) => (event && event.phase !== 'build' ? -1 : 1)*recent(a.exerciseId).localeCompare(recent(b.exerciseId))
          || Number(catalogue[b.exerciseId].mainRole === 'supporting')-Number(catalogue[a.exerciseId].mainRole === 'supporting')
          || catalogue[a.exerciseId].estimatedSeconds-catalogue[b.exerciseId].estimatedSeconds || a.exerciseId.localeCompare(b.exerciseId));
      if (!candidates.some(candidate => add(supportRequest(capability.capabilityId,catalogue[candidate.exerciseId]))) && candidates.length) warnings.push({
        code: 'tennis-capability-time-limit', capabilityId: capability.capabilityId,
        message: capability.label+' does not fit alongside today’s selected work. Priorities will be recomputed from performed history.'});
    }
    if (roleCapabilities) {
      const contributions = prescription.requiredAnchors.filter(item => item.requirementId.startsWith('tennis-support-'))
        .flatMap(item => sport.classifyExercise(item.exerciseId).contributions);
      if (!contributions.some(item => item.capabilityId === 'lateral-movement')
        || !contributions.some(item => ['trunk','endurance','power'].includes(item.capabilityId))) warnings.push({
        code:'tennis-role-movement-shortfall', sessionRole:role.id,
        message: role.label+' is limited today: a controlled lateral target plus complementary trunk, conditioning or power work cannot both fit your time, equipment, impact or readiness constraints. This is a lighter/partial alternative, not a full movement session.'});
    }
    prescription.programmeContext.emptySession = !prescription.requiredAnchors.length;
    if (event && ['reduced','final'].includes(event.phase) && prescription.programmeContext.emptySession) {
      prescription.programmeContext.restRecommendation = 'Rest is sensible before your event: no gentle, useful work fits today’s equipment, time and constraints. Your anchors and progress are retained.';
    }
    prescription.programmeContext.preflightAvailable = typeof assessSessionPrescription === 'function';
    if (prescription.programmeContext.emptySession && assessSessionPrescription && allowRoleFallback) {
      const alternatives = definition.sessionRoles[config.weeklyCoachFrequency].filter(item => item.id !== role.id)
        .sort((a,b) => priorities.earnedRoles[a.id]-priorities.earnedRoles[b.id]);
      for (const alternative of alternatives) {
        const fallback = buildPrescription({definition,catalogue,state,history,today,assessSessionPrescription,
          priorities: {...priorities,role: alternative},allowRoleFallback: false});
        if (fallback.programmeContext.emptySession) continue;
        fallback.programmeContext.requestedRole = role.id;
        fallback.programmeContext.warnings.unshift({code: 'tennis-session-role-unavailable', sessionRole: role.id,
          message: role.label+' has no attainable target today. '+alternative.label+' provides useful work with preparation and rest; no missed-session debt is created.'});
        return fallback;
      }
    }
    return Model().createSessionPrescription(prescription);
  }
  function assessPlannedSession({prescription}) {
    const conflicts = [];
    if (prescription.programmeContext.restRecommendation) return {conflicts: [{code: 'tennis-rest-recommended',
      message: prescription.programmeContext.restRecommendation}]};
    if (!prescription.programmeContext.preflightAvailable) conflicts.push({code: 'tennis-preflight-required', message: 'Tennis requires Generator preflight to preserve preparation, targets and rest.'});
    if (prescription.programmeContext.emptySession) conflicts.push({code: 'tennis-no-useful-session', message: 'No useful Tennis target fits. Choose more time or suitable equipment; preparation and rest are preserved.'});
    return {conflicts};
  }
  function assessFeasibility({definition, catalogue, context, assessSessionPrescription}) {
    const config = settings(definition, null, context); validateProgrammeSettings({settings: config});
    const anchors = [], conflicts = [], selected = context.anchorSelections || {};
    const requirements = definition.anchorSelectionPolicy.requirements;
    Object.keys(selected).filter(id => !requirements.some(item => item.requirementId === id))
      .forEach(requirementId => conflicts.push({code: 'unknown-anchor-selection', requirementId}));
    for (const requirement of requirements) {
      const ids = selected[requirement.requirementId] ? [selected[requirement.requirementId]] : requirement.exerciseIds;
      const exerciseId = ids.find(id => requirement.exerciseIds.includes(id) && anchorEligible(catalogue[id], context, requirement)
        && !anchors.some(anchor => anchor.exerciseId === id));
      if (!exerciseId) conflicts.push({code: 'anchor-unavailable', requirementId: requirement.requirementId, exerciseIds: ids,
        message: 'Add equipment for a '+requirement.roleId+' anchor or explicitly choose a suitable catalogue alternative.'});
      else anchors.push({...copy(requirement), exerciseId, pattern: catalogue[exerciseId].patterns.find(pattern => requirement.patterns.includes(pattern))});
    }
    if (context.duration !== undefined && !definition.supportedDurations.includes(context.duration)) conflicts.push({code: 'unsupported-duration'});
    if (!assessSessionPrescription) conflicts.push({code: 'tennis-preflight-required'});
    if (conflicts.length) return {status: 'infeasible', conflicts, anchors, prescription: null};
    const state = {programmeInstanceId: context.programmeInstanceId || 'tennis-feasibility', mode: 'development',
      anchors: strength.initialiseState({assessment: {anchors}, context}).anchors, currentTargets: {programmeSettings: config}};
    const history = root.GarageFitTrainingHistory.createHistory([], catalogue);
    const now = context.now || '2000-01-01T00:00:00Z'; // No clock/evidence involved in start feasibility.
    const durationAssessments = definition.supportedDurations.map(duration => ({duration, roles: definition.sessionRoles[config.weeklyCoachFrequency].map(role => {
      // Programme feasibility evaluates enduring shapes, not a dated check-in or
      // calendar prediction. Start independently plans today's session afterwards.
      const today = {...context, duration, now, ...(definition.contextPolicy ? {
        smallSpace: context.smallSpace === undefined ? definition.contextPolicy.homeSmallSpace : context.smallSpace} : {}),
        prescriptionId: 'tennis-feasibility-'+duration+'-'+role.id};
      const priorities = {...calculatePriorities({definition,catalogue,state,history,today,forFeasibility: true}),role};
      const prescription = buildPrescription({definition,catalogue,state,history,today,priorities,assessSessionPrescription,allowRoleFallback:false});
      const assessment = assessSessionPrescription(prescription);
      const failures = [...assessment.hardConflicts, ...assessPlannedSession({prescription}).conflicts];
      return {sessionRole: role.id, status: failures.length ? 'infeasible' : assessment.status, prescription, conflicts: failures,
        warnings: prescription.programmeContext.warnings};
    })}));
    const current = durationAssessments.find(item => item.duration === (context.duration === undefined ? definition.sessionTemplate.duration : context.duration));
    // A long default session may start even when a short budget cannot offer every role.
    // Today's actual plan is still independently checked and can truthfully fail.
    if (current.roles.every(item => item.status === 'infeasible')) conflicts.push(...current.roles.flatMap(item => item.conflicts));
    return {status: conflicts.length ? 'infeasible' : current.roles.some(item => item.status !== 'feasible') ? 'partially-feasible' : 'feasible', conflicts, anchors, prescription: null, durationAssessments,
      warnings: current.roles.flatMap(item => item.warnings)};
  }
  const policy = {...strength, validateDefinition, validateState, initialiseState, validateProgrammeSettings, validateSettingsChange, eventHorizon, assessFeasibility, calculatePriorities, buildPrescription, classifyContext,
    phaseRecommendation, sportReviewRecommendation, recordSportReview, beginSession, applyPerformedState,
    interpretDose: input => ['completed','partial'].includes(input.result.finalStatus) ? strength.interpretDose(input)
      : {meaningful:false,exposure:{value:0,confidence:'unknown'},patterns:{},bodyRegions:{}},
    interpretProgression: input => ['completed','partial'].includes(input.result.finalStatus)
      && !(input.result.overrides || []).some(item => item.type === 'tennis-phase' && item.value === 'consolidation' || item.type === 'tennis-feedback-review'
        || input.definition.eventPolicy && item.type === 'tennis-event' && ['refine','reduced','final','expired'].includes(item.value))
      ? strength.interpretProgression(input) : copy(input.state.anchors),
    assessPlannedSession, anchorAlternatives, reduceForShortSession: ({prescription}) => copy(prescription),
    // Tennis has phase/event/feedback holds beyond the shared strength holds, so it does
    // not inherit variation-progression support; a future version must define its own.
    progressionHold: undefined,
    getModeSettings: ({definition,state}) => {
      const frequency = settings(definition,state).weeklyCoachFrequency;
      return {frequency: {minSessionsPerWeek: frequency,maxSessionsPerWeek: frequency}, allowProgression: state.mode !== 'maintenance'};
    }, isComplete: () => false};
  root.GarageFitCoachTennisPolicy = Object.freeze(policy);
})(typeof window !== 'undefined' ? window : globalThis);
