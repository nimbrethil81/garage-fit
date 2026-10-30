(function (root) {
  // Shared read-only views. Persistence and performed-evidence interpretation stay
  // in the existing store/history modules; no writes or programme credit here.
  const known = value => value !== null && value !== undefined;
  const timestamp = result => result.endedAt || result.startedAt;
  const supporting = result => result.source === 'fixed' && ['deskBreak','postRunReset'].includes(result.workoutId);
  function isTraining(result) {
    if (supporting(result) || !['coach','generator','fixed'].includes(result.source)
      || !['completed','partial'].includes(result.finalStatus)) return false;
    const planned = new Map((result.plannedWork || []).map(work => [work.occurrenceId, work]));
    return (result.performedWork || []).some(work => planned.has(work.occurrenceId)
      && root.GarageFitCoachRecovery.meaningful(work, planned.get(work.occurrenceId)));
  }
  function label(result) {
    if (supporting(result)) return result.workoutId === 'deskBreak' ? 'Desk Break' : 'Post-run Stretch';
    return root.GarageFitCoachProgressUI.workoutIdentity(result)?.label || 'Recorded session';
  }
  const classification = result => supporting(result) ? result.workoutId === 'deskBreak' ? 'Movement break' : 'Recovery'
    : isTraining(result) ? 'Training' : 'Recorded activity';
  const status = result => ({completed:'Completed',partial:'Partial',abandoned:'Ended early','skipped-before-start':'Not started'})[result.finalStatus];
  const source = result => ({coach:'Coach',generator:'Generator',fixed:'Workouts',external:'Reported activity'})[result.source] || 'Source unknown';
  function summary(results, now = new Date()) {
    const end = new Date(now), week = new Date(end), fourWeeks = new Date(end);
    week.setHours(0,0,0,0); week.setDate(week.getDate() - (week.getDay()+6)%7);
    fourWeeks.setDate(fourWeeks.getDate()-28);
    const count = since => results.filter(result => isTraining(result) && timestamp(result)
      && Date.parse(timestamp(result)) >= +since && Date.parse(timestamp(result)) <= +end).length;
    return {week:count(week),fourWeeks:count(fourWeeks)};
  }
  function insights(history) {
    const series = new Map(), messages = [], bySession = new Map();
    history.performances.filter(item=>item.section==='main').forEach(item=>{
      if(!bySession.has(item.sessionResultId))bySession.set(item.sessionResultId,[]);
      bySession.get(item.sessionResultId).push(item);
    });
    // Match the whole exercise/side dose in the latest two sessions. Comparing
    // the last round of one session with the first of another can invent a gain.
    for (const session of history.sessions) {
      const groups = new Map();
      const plan = session.plannedWork || [];
      const work = bySession.get(session.sessionResultId) || [];
      work.forEach(item => {
        const key=JSON.stringify([item.exerciseId,item.side]);
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push(item);
      });
      groups.forEach((items,key) => {
        const ordered=items.slice().sort((a,b)=>plan.findIndex(p=>p.occurrenceId===a.occurrenceId)-plan.findIndex(p=>p.occurrenceId===b.occurrenceId));
        const expected=plan.filter(p=>p.section==='main' && p.exerciseId===items[0].exerciseId && p.prescription?.side===items[0].side).length;
        const entry={items:ordered,complete:expected===items.length && items.every(item=>item.status==='completed')};
        if(!series.has(key))series.set(key,[]);
        series.get(key).push(entry);
      });
    }
    series.forEach(entries => {
      const [before,after]=entries.slice(-2);
      if(!before || !after || !before.complete || !after.complete || before.items.length!==after.items.length)return;
      const comparisons=after.items.map((item,i)=>root.GarageFitTrainingHistory.comparePerformanceEvidence(before.items[i],item));
      if(!comparisons.every(item=>item.comparable && ['improved-reps','improved-time','improved-load','unchanged-or-insufficient'].includes(item.change)
        && item.performanceDelta>=0 && (item.loadDelta===null || item.loadDelta>=0)))return;
      const improvement=comparisons.find(item=>item.change==='improved-load') || comparisons.find(item=>['improved-reps','improved-time'].includes(item.change));
      if(improvement)messages.push({previous:before.items[0],current:after.items[0],change:improvement.change});
    });
    return messages.sort((a,b)=>Date.parse(a.current.occurredAt)-Date.parse(b.current.occurredAt)).slice(-2);
  }
  function mount({store, catalogue, showScreen, getProgramme, openProgramme, returnToOrigin, clock = () => new Date()}) {
    const el = id => document.getElementById(id);
    let results = [], history = null, errors = [], programme = null, origin = 'more', filter = 'all';
    let historyScroll = 0, overviewScroll = 0, selected = null, detailParent = 'trainingHistory', detailFocus = null, programmeOpened = false, generation = 0;
    const node = (tag, text, className) => {const n=document.createElement(tag); if (text !== undefined) n.textContent=text; if(className)n.className=className; return n;};
    const p = text => node('p',text);
    function button(text, action, className = 'progress-row') {const n=node('button',undefined,className);n.type='button';n.onclick=action;if(text)n.append(node('strong',text));return n;}
    function section(title) {const n=node('section',undefined,'progress-section');n.append(node('h2',title));return n;}
    function card(title, copy) {const n=node('div',undefined,'progress-card');n.append(node('strong',title),p(copy));return n;}
    function focusBack(id) {el(id).querySelector?.('.back-btn')?.focus?.({preventScroll:true});}
    function show(id, scroll = 0) {showScreen(id);el(id).scrollTop=scroll;focusBack(id);}
    function warnings(wrap) {
      if (!errors.length) return;
      const alert=p('Some saved activity could not be read. Available records are shown; totals may be incomplete.');alert.setAttribute('role','alert');wrap.append(alert);
      wrap.append(button('Try again',()=>open(origin),'progress-retry'));
    }
    function dateText(result, relative = true) {
      const value=timestamp(result);if(!value)return 'Date not recorded';
      const date=new Date(value), today=new Date(clock()), yesterday=new Date(today);yesterday.setDate(today.getDate()-1);
      if(relative && date.toDateString()===today.toDateString())return 'Today';
      if(relative && date.toDateString()===yesterday.toDateString())return 'Yesterday';
      return date.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    }
    function duration(result) {
      if(!known(result.actualDurationSeconds))return 'Duration not recorded';
      const seconds=result.actualDurationSeconds;
      return seconds < 60 ? Math.round(seconds)+' sec' : Number((seconds/60).toFixed(1))+' min';
    }
    function activityRow(result, parent) {
      const row=button(null,()=>openDetail(result.sessionResultId,parent,row));row.setAttribute('aria-label',label(result)+' · '+status(result)+' · '+dateText(result));
      const copy=node('span',undefined,'progress-row-copy');copy.append(node('strong',label(result)),node('span',(parent==='yourProgress'?dateText(result)+' · ':'')+duration(result)+(parent==='trainingHistory'?' · '+source(result):'')));
      row.append(copy,node('span',(result.finalStatus==='completed'?'':status(result)+' · ')+classification(result),'progress-row-kind'));return row;
    }
    function metrics(items, kicker, note) {
      const wrap=node('section',undefined,'progress-card');wrap.append(node('p',kicker,'progress-kicker'));
      const grid=node('div',undefined,'progress-metrics');items.forEach(([value,text])=>{const n=node('div');n.append(node('strong',String(value)),p(text));grid.append(n);});wrap.append(grid);if(note)wrap.append(p(note));return wrap;
    }
    async function open(from = 'more') {
      origin=from;filter='all';historyScroll=0;overviewScroll=0;programmeOpened=false;
      const request=++generation;
      show('yourProgress');el('yourProgressContent').innerHTML='';el('yourProgressContent').append(p('Loading recorded activity…'));
      try {
        const query=await store.listSessionResults({sources:['coach','generator','fixed','external']});
        const context=await getProgramme();if(request!==generation)return;
        results=query.results.slice().sort((a,b)=>(Date.parse(timestamp(b))||0)-(Date.parse(timestamp(a))||0)||b.sessionResultId.localeCompare(a.sessionResultId));
        errors=query.errors;history=root.GarageFitTrainingHistory.createHistory(results,catalogue);programme=context;
      } catch(error) {if(request!==generation)return;results=[];history=null;programme=null;errors=[error];}
      // Navigation away during an asynchronous read must not pull the user back.
      renderOverview();
    }
    function renderOverview() {
      const wrap=el('yourProgressContent');wrap.innerHTML='';warnings(wrap);
      const counts=summary(results,clock());
      wrap.append(metrics([[errors.length?'—':counts.week,'Sessions this week'],[errors.length?'—':counts.fourWeeks,'Last 4 weeks']],'Your training',errors.length?'Training totals unavailable until all records can be read.':'Recorded meaningful training only'));
      const recent=section('Recent activity');
      const recentHeading=node('div',undefined,'progress-section-heading');
      // Keep the title and single history action together when text wraps.
      recent.innerHTML='';recentHeading.append(node('h2','Recent activity'),button('View history',openHistory,'progress-link'));recent.append(recentHeading);
      if(results.length) {const list=node('div',undefined,'progress-list');results.slice(0,3).forEach(result=>list.append(activityRow(result,'yourProgress')));recent.append(list);}
      else recent.append(card(errors.length?'Saved activity unavailable':'Your history starts here',errors.length?'Saved activity is unavailable right now.':'Your recorded sessions will appear after you save your first activity.'));
      wrap.append(recent);
      const training=section('Training progress'), comparisons=history && !errors.length?insights(history):[];
      if(comparisons.length) comparisons.forEach(item=>{
        const name=catalogue[item.current.exerciseId]?.name || 'Recorded exercise';
        const side=['left','right'].includes(item.current.side)?' · '+item.current.side:'';
        const copy=item.change==='improved-load'?'More recorded load with at least the same work.':item.change==='improved-reps'?'More recorded reps at the same resistance.':'More recorded seconds at the same resistance.';
        training.append(card(name+side,copy+' Compared with '+new Date(item.previous.occurredAt).toLocaleDateString()+', under matching recorded conditions.'));
      });
      else training.append(card('Building your performance history',results.length?'Your recorded activity is available, but there isn’t enough comparable evidence to show an improvement trend yet.':'Performance insights appear when comparable performed work is recorded.'));
      wrap.append(training);
      if(programme?.state && programme.definition && programme.state.status!=='completed') {
        const coach=section('Coach programme'), row=button(null,()=>{overviewScroll=el('yourProgress').scrollTop||0;programmeOpened=true;openProgramme();});
        row.setAttribute('aria-label','View programme progress');
        const title=node('span',undefined,'progress-programme-title');
        const state=programme.state, mode=state.status==='paused'?'Paused':state.mode==='maintenance'?'Maintenance':programme.definition.openEnded?'Ongoing':state.currentTargets?.tennisDevelopment?.phase==='consolidation'?'Consolidation':'Development';
        title.append(node('strong',programme.definition.name),node('span',mode,'progress-status'));
        row.append(title,p(state.meaningfulSessionsCompleted+' programme sessions completed'),node('span','View programme progress','progress-link-label'));
        coach.append(row);wrap.append(coach);
      }
    }
    function openHistory() {overviewScroll=el('yourProgress').scrollTop||0;renderHistory();show('trainingHistory',historyScroll);}
    function renderHistory() {
      const wrap=el('trainingHistoryContent');wrap.innerHTML='';warnings(wrap);wrap.append(p('Your recorded training and supporting activities.'));
      const choices=node('div',undefined,'progress-filter');choices.setAttribute('role','group');choices.setAttribute('aria-label','Activity filter');
      ['all','training'].forEach(value=>{const b=button(value==='all'?'All activity':'Training only',()=>{filter=value;historyScroll=0;renderHistory();el('trainingHistory').scrollTop=0;el('trainingHistoryContent').querySelector?.('[aria-pressed="true"]')?.focus?.({preventScroll:true});},'progress-filter-button');b.setAttribute('aria-pressed',String(filter===value));choices.append(b);});wrap.append(choices);
      const visible=results.filter(result=>filter==='all'||isTraining(result));
      if(!visible.length)wrap.append(card(filter==='training'?'No recorded training yet':'Your history starts here',filter==='training'?'Supporting activities remain in All activity. Only recorded meaningful Main work counts as training.':'Your recorded sessions will appear here.'));
      let group=null,day=null;
      visible.forEach(result=>{const key=timestamp(result)?new Date(timestamp(result)).toDateString():'unknown';if(key!==day){const s=section(dateText(result));group=node('div',undefined,'progress-list');s.append(group);wrap.append(s);day=key;}group.append(activityRow(result,'trainingHistory'));});
    }
    function openDetail(id, parent = 'trainingHistory', focused = null) {
      selected=results.find(result=>result.sessionResultId===id);if(!selected)return;
      detailParent=parent;detailFocus=focused;
      if(parent==='trainingHistory')historyScroll=el(parent).scrollTop||0;else overviewScroll=el(parent).scrollTop||0;
      const result=selected,wrap=el('sessionDetailsContent');wrap.innerHTML='';
      const intro=node('div',undefined,'progress-detail-intro');intro.append(node('h2',label(result)),node('span',status(result),'progress-status'));wrap.append(intro,p(dateText(result,false)+' · '+source(result)));
      const work=history.sessionEvidence(id).performances.filter(item=>item.exposure.value>0||item.exposure.confidence==='unknown');
      const count=new Set(work.map(item=>item.exerciseId||item.occurrenceId)).size;
      wrap.append(metrics([[duration(result),'Recorded duration'],[count,'Exercises performed']],'Recorded performance',result.finalStatus==='partial'?'The workout ended before all planned exercises were completed.':null));
      const performed=section('Exercises performed'),list=node('div',undefined,'progress-list');
      work.forEach(item=>{
        const row=node('div',undefined,'progress-evidence');
        const side=['left','right'].includes(item.side)?' · '+item.side:item.side==='unknown'?' · side not recorded':'';
        row.append(node('strong',(catalogue[item.exerciseId]?.name||'Exercise not identified')+side),p(item.status==='partial'?'Partial':'Completed'));
        if(!item.sets.length)row.append(p('Amount not recorded. Completion does not establish reps or load.'));
        item.sets.forEach((set,i)=>{
          const measures=[];if(known(set.reps.value))measures.push(set.reps.value+' reps');if(known(set.seconds.value))measures.push(set.seconds.value+' sec');
          if(!measures.length)measures.push('amount not recorded');
          if(known(set.load.value))measures.push(set.load.value+' '+(set.loadUnit||'unit not recorded')+(set.loadInterpretation==='per-item'?' each':set.loadInterpretation==='total'?' total':' · load interpretation not recorded'));
          else measures.push(set.resistanceSetup?'resistance setup confirmed':'load not recorded');
          row.append(p('Set '+(i+1)+' · '+measures.join(' · ')));
        });list.append(row);
      });
      if(!work.length)list.append(card('No performed exercise evidence','No actual exercises or amounts were recorded.'));performed.append(list);wrap.append(performed);
      const unperformed=(result.plannedWork||[]).filter(plan=>!work.some(item=>item.occurrenceId===plan.occurrenceId));
      if(unperformed.length) {const remaining=section('Not completed');remaining.append(card('Remaining planned exercises',unperformed.length+' planned exercise entries have no performed evidence. These are not counted as performed training.'));wrap.append(remaining);}
      if(work.some(item=>item.status==='partial'))wrap.append(p('Partial exercises show only the work that was recorded; remaining prescribed work is not credited.'));
      wrap.append(p('History is local to this browser and device. This record is read-only.'));show('sessionDetails');
    }
    function backDetail() {show(detailParent,detailParent==='trainingHistory'?historyScroll:overviewScroll);detailFocus?.focus?.({preventScroll:true});}
    function backHistory() {show('yourProgress',overviewScroll);el('yourProgressContent').querySelector?.('.progress-link')?.focus?.({preventScroll:true});}
    function backOverview() {++generation;returnToOrigin(origin);}
    function backProgramme() {if(!programmeOpened)return false;programmeOpened=false;show('yourProgress',overviewScroll);return true;}
    return {open,openHistory,openDetail,backDetail,backHistory,backOverview,backProgramme,origin:()=>origin};
  }
  root.GarageFitProgressUI={mount,isTraining,classification,label,summary,insights};
})(typeof window !== 'undefined' ? window : globalThis);
