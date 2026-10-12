(function (root) {
  // Tennis presentation only. Planning, validation and persistence stay in Coach.
  const focusNames = {balanced: 'Balanced', movement: 'Movement & agility', power: 'Strength & power',
    endurance: 'Match endurance', resilience: 'Resilience & stability'};
  const title = value => value.charAt(0).toUpperCase()+value.slice(1);
  function createViews({button, paragraph, heading, catalogue}) {
    function selectField(label, choices, value) {
      const field = document.createElement('label'), select = document.createElement('select');
      field.className = 'coach-setting'; select.setAttribute('aria-label', label);
      choices.forEach(([value,text]) => {
        const option = document.createElement('option'); option.value = String(value); option.textContent = text; select.append(option);
      });
      select.value = String(value); field.append(paragraph(label), select);
      return {field, select};
    }
    function settingsForm(settings, {includeEvent = false, localDate} = {}) {
      const wrap = document.createElement('div'); wrap.className = 'coach-settings';
      const profile = root.GarageFitData.sportProfiles.tennis.configuration;
      const focus = selectField('Training focus', profile.focuses.map(value => [value,focusNames[value]]), settings.focus);
      const frequency = selectField('GarageFit sessions per week', profile.weeklyCoachFrequencies.map(value => [value,String(value)]), settings.weeklyCoachFrequency);
      const intensity = selectField('Typical tennis intensity', profile.sportIntensities.map(value => [value,title(value)]), settings.typicalSportIntensity);
      wrap.append(focus.field, frequency.field);
      const days = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = 'Usual tennis playing days'; days.append(legend);
      const irregular = document.createElement('input'); irregular.type = 'checkbox'; irregular.checked = !settings.usualPlayingDays.length;
      irregular.setAttribute('aria-label','Irregular / no fixed days');
      const irregularLabel = document.createElement('label'); irregularLabel.append(irregular,paragraph('Irregular / no fixed days')); days.append(irregularLabel);
      const dayChoices = document.createElement('div'); dayChoices.hidden = irregular.checked;
      const controls = profile.playingDays.map(day => {
        const check = document.createElement('input'), label = document.createElement('label'); check.type = 'checkbox';
        check.checked = settings.usualPlayingDays.includes(day); check.setAttribute('aria-label',title(day));
        check.disabled = irregular.checked;
        check.onchange = () => { if (check.checked) irregular.checked = false; };
        label.append(check,paragraph(title(day))); dayChoices.append(label); return {day,check};
      });
      days.append(dayChoices);
      irregular.onchange = () => {
        dayChoices.hidden = irregular.checked;
        controls.forEach(({check}) => { check.disabled = irregular.checked; if (irregular.checked) check.checked = false; });
      };
      wrap.append(days,intensity.field,paragraph('Your usual tennis schedule helps plan sessions. Playing days are preferences; only confirmed performed work earns progress.'));
      let intent, date;
      if (includeEvent) {
        intent = selectField('Training intent', [['ongoing','Ongoing development'],['event','Prepare for an important event']],settings.intent);
        const eventField = document.createElement('label'); eventField.className = 'coach-setting';
        date = document.createElement('input'); date.type = 'date'; date.min = localDate; date.value = settings.significantEventDate || '';
        date.setAttribute('aria-label','Important event date'); eventField.append(paragraph('Important event date · local calendar date'),date);
        const update = () => { eventField.hidden = intent.select.value !== 'event'; date.disabled = eventField.hidden; };
        intent.select.onchange = update; update();
        wrap.append(intent.field,eventField,paragraph('Choose an important event explicitly. You can change or cancel it later while keeping the same programme, anchors and history.'));
      }
      function read() {
        const patch = {focus: focus.select.value, weeklyCoachFrequency: Number(frequency.select.value),
          usualPlayingDays: irregular.checked ? [] : controls.filter(({check}) => check.checked).map(({day}) => day),
          typicalSportIntensity: intensity.select.value};
        if (intent) {
          patch.intent = intent.select.value;
          patch.significantEventDate = patch.intent === 'event' ? date.value : null;
          if (patch.intent === 'event' && (!root.GarageFitCoachModel.isLocalDate(date.value) || date.value < localDate)) throw new Error('Choose a valid event date today or in the future.');
        }
        // Validate exactly what the controls contain, including unsupported values.
        root.GarageFitCoachModel.updateProgrammeSettings(settings,patch);
        return patch;
      }
      return {wrap,read};
    }
    function whyToday(plan) {
      const priorities = plan.rationale.priorities;
      if (priorities.adaptation?.recommendation) return priorities.adaptation.recommendation;
      const reasons = priorities.adaptation?.reasons || [];
      const reason = priorities.event?.rationale || (priorities.phase?.phase === 'consolidation' ? priorities.phase.rationale : null);
      return [reason, reasons.filter(value => value !== reason).join(' · ')
        || 'Recent performed work and your training focus guide today’s priorities.'].filter(Boolean).join(' ');
    }
    function coverage(wrap, summary) {
      const details = document.createElement('details'), label = document.createElement('summary');
      label.textContent = 'Capability coverage · last two weeks'; details.append(label);
      summary.capabilities.forEach(cap => {
        const observed = cap.coverage === 'observed' ? 'Performed exposure observed' : cap.coverage === 'unknown' ? 'Exposure unknown' : 'No performed exposure observed';
        const qualifiers = [cap.observations.some(work => work.exposure.confidence === 'unknown') ? 'some work is unmeasured' : null,
          !cap.achievable ? 'unachievable with today’s equipment and constraints' : null,
          cap.missingFacets.length ? 'limited coverage: '+cap.missingFacets.join(', ').replaceAll('-',' ')+' unavailable' : null].filter(Boolean);
        details.append(paragraph(cap.label+' · '+observed+(qualifiers.length ? ' · '+qualifiers.join(' · ') : '')));
      });
      if (summary.unclassifiedObservations.length) details.append(paragraph('Some performed work cannot be classified; no capability coverage is assumed for it.'));
      details.append(paragraph('Exercise exposure describes performed conditioning work, not proven tennis skill improvement. Capabilities overlap; no catch-up debt.'));
      wrap.append(details);
    }
    function progress(wrap, {definition, state, results, now, localDate, plan, equipment}) {
      const details = document.createElement('details'), label = document.createElement('summary'); label.textContent = 'Programme progress and management'; details.append(label);
      const phase = state.currentTargets.tennisDevelopment;
      details.append(paragraph(state.meaningfulSessionsCompleted+' meaningful performed sessions'),
        paragraph('Training phase · '+title(phase?.phase || 'development')+(plan?.rationale.priorities.phase?.phase === 'consolidation' && phase?.phase !== 'consolidation' ? ' · consolidation recommended next' : '')));
      const event = root.GarageFitCoachTennisPolicy.eventHorizon({definition,state,today:{localDate}});
      if (event) details.append(paragraph('Event horizon · '+(event.daysUntil < 0 ? 'date passed' : event.daysUntil+' days away')+' · '+event.eventDate),paragraph(event.rationale));
      else details.append(paragraph('Ongoing development · no fixed end date'));
      details.append(heading('Four persistent anchor targets'));
      state.anchors.forEach(anchor => {
        const target = anchor.currentTarget || anchor;
        details.append(paragraph(catalogue[anchor.exerciseId].name+' · '+target.targetSets+' × '+target.target.maxReps+' reps · '+(target.progressionIntent || 'Confirm actual work')));
      });
      details.append(paragraph('These are programme targets. Only the selected anchors are required today; other anchors keep their progress.'));
      const pin = definition.sportPolicy, policy = root.GarageFitSportCoverage.createPolicy(root.GarageFitData.sportCapabilityPolicies[pin.sportId][pin.version],catalogue);
      const summary = plan?.rationale.priorities.coverage || policy.summarize(root.GarageFitTrainingHistory.createHistory(results,catalogue),
        {now,programmeInstanceId:state.programmeInstanceId,focus:state.currentTargets.programmeSettings.focus,equipment,
          smallSpace:definition.contextPolicy?.homeSmallSpace});
      coverage(details,summary);
      results.slice(-5).reverse().forEach(result => details.append(paragraph(new Date(result.endedAt).toLocaleDateString()+' · '+result.finalStatus+' · '+result.performedWork.filter(work => ['completed','partial'].includes(work.status)).length+' performed work occurrences')));
      details.append(paragraph('History is local to this browser and device. Clearing site data or changing devices can remove access to it.'));
      wrap.append(details); return details;
    }
    return {settingsForm,selectField,whyToday,coverage,progress};
  }
  root.GarageFitCoachTennisUI = {createViews};
})(typeof window !== 'undefined' ? window : globalThis);
