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
      const frequency = selectField('PickSetGo sessions per week', profile.weeklyCoachFrequencies.map(value => [value,String(value)]), settings.weeklyCoachFrequency);
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
      wrap.append(days,intensity.field,paragraph('Coach plans around your usual playing days. Adding a day to your schedule does not record training.'));
      let intent, date;
      if (includeEvent) {
        intent = selectField('Training intent', [['ongoing','Ongoing development'],['event','Prepare for an important event']],settings.intent);
        const eventField = document.createElement('label'); eventField.className = 'coach-setting';
        date = document.createElement('input'); date.type = 'date'; date.min = localDate; date.value = settings.significantEventDate || '';
        date.setAttribute('aria-label','Important event date'); eventField.append(paragraph('Important event date'),date);
        const update = () => { eventField.hidden = intent.select.value !== 'event'; date.disabled = eventField.hidden; };
        intent.select.onchange = update; update();
        wrap.append(intent.field,eventField,paragraph('Choose the event you want to train for. You can change or cancel it and keep your programme, targets and history.'));
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
    const eventMessages = {
      build: 'There’s time to build gradually before your event. You don’t need to make up missed workouts.',
      refine: 'Stick with familiar strength and movement exercises. Keep your targets steady and avoid unfamiliar, difficult or explosive work.',
      reduced: 'Keep training light before your event. Use familiar exercises and avoid power work or tiring conditioning.',
      final: 'With your event at most two days away, stick to gentle core and shoulder work or rest. Avoid hard leg work and power exercises, and keep your targets steady.',
      expired: 'Your event date has passed. Return to ongoing training or choose a new date. You’ll keep your targets and progress.'
    };
    const eventNote = 'Your event date guides the plan. It records no training and cannot predict how you’ll perform.';
    // Adaptation reasons are stored with prescriptions. Keep their original values in policy.
    const adaptationMessages = {
      'tired today': 'You reported feeling tired today.',
      'lighter before planned tennis': 'Training is lighter before tennis on your schedule.',
      'lighter after reported hard tennis': 'Training is lighter after the hard tennis you reported.',
      'lighter before a planned match': 'Training is lighter before your match.',
      'lighter before your planned event': 'Training is lighter before your event.',
      'easy today': 'You chose Easy today.',
      'short session': 'The workout fits the shorter time you chose.',
      'easier session after your sport feedback; this is subjective context, not proof of a fitness decline': 'Today is easier because of how tennis felt at your last check-in. That feedback guides the plan and does not measure your fitness.'
    };
    const eventMessage = event => eventMessages[event.phase];
    function whyToday(plan) {
      const {adaptation, event, phase} = plan.rationale.priorities;
      const eventCopy = event ? eventMessage(event)+' '+eventNote : null;
      if (event?.phase === 'expired') return eventCopy;
      const reasons = (adaptation?.reasons || []).map(reason => adaptationMessages[reason]).filter(Boolean);
      if (adaptation?.classification === 'rest') return ['Rest today and keep your current targets.', ...reasons, eventCopy].filter(Boolean).join(' ');
      const consolidation = phase?.phase === 'consolidation'
        ? 'A lighter workout is due. Your targets stay the same. Record enough work from the main part of this workout for it to count, then return to building fitness.' : null;
      return [eventCopy, consolidation, ...reasons].filter(Boolean).join(' ')
        || 'The workouts you’ve recorded and your training focus guide what you’ll work on today.';
    }
    // Concise two-week coverage lines for Why this workout?; Your progress keeps the detail.
    function coverageSummary(summary) {
      const names = state => summary.capabilities.filter(cap => cap.coverage === state).map(cap => cap.label).join(', ');
      const missing = names('not-observed'), unknown = names('unknown');
      const incomplete = summary.unclassifiedObservations.some(item => item.classification.status === 'unknown-exercise');
      return [
        missing || unknown ? 'Your last two weeks of training.' : 'You recorded training in every area over the last two weeks.',
        ...(missing ? [incomplete ? 'Not enough information to check '+missing+'.' : 'No exercises recorded for '+missing+'.'] : []),
        ...(unknown ? ['Some work was recorded without an amount for '+unknown+'.'] : []),
        ...(summary.unclassifiedObservations.length ? ['Some saved exercises could not be linked to a training area.'] : []),
        'This shows the training you recorded. It cannot tell you how much your tennis has improved. Some exercises count in more than one area. You don’t need to make up missed workouts. See Your progress for details.'
      ];
    }
    return {settingsForm,selectField,whyToday,eventMessage,eventNote,coverageSummary,focusName: value=>focusNames[value] || value};
  }
  root.GarageFitCoachTennisUI = {createViews};
})(typeof window !== 'undefined' ? window : globalThis);
