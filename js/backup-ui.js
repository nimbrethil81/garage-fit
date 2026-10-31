(function (root) {
  'use strict';
  // One Settings detail screen; all writes and file verification stay in the
  // backup coordinator. The OS save action is deliberately a separate click
  // after file preparation so iPhone share sheets retain user activation.
  function mount({document = root.document, backup, showScreen, saveFile, readFile,
    onRestored = () => root.location.reload(), isBlocked = () => false,
    returnToActivity = () => showScreen('coach'), retryRecovery = () => root.location.reload(), onStateChange = () => {}}) {
    const screen = document.getElementById('backupRestore');
    const content = document.getElementById('backupRestoreContent');
    const title = document.getElementById('backupRestoreTitle');
    let view = 'home', busy = false, prepared = null, selected = null, destination = null;
    let preservation = false, verified = false, reportedSaved = false, restoring = false, error = null, errorReturn = 'home';
    let request = 0;
    const node = (tag, text, className) => {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
    const paragraph = (text, muted = false) => node('p',text,muted?'backup-note':'backup-copy');
    function button(text, action, style = 'primary') {
      const n = node('button',text,'backup-button backup-'+style); n.type='button';
      n.onclick=() => {if (!busy) return action();}; return n;
    }
    function card(heading, copy, warning = false) {
      const n=node('section',undefined,'backup-card'+(warning?' backup-warning':''));
      n.append(node('h2',heading)); if(copy)n.append(paragraph(copy,true)); return n;
    }
    function row(label, value) {
      const n=node('div',undefined,'backup-card backup-summary-row');n.append(node('strong',label),node('span',String(value)));return n;
    }
    function notifyState() {
      const allowed=canLeave(), back=screen.querySelector?.('.back-btn');
      if(back)back.disabled=!allowed;
      onStateChange({canLeave:allowed,busy,view});
    }
    function focusHeading() {title.setAttribute('tabindex','-1');title.focus?.({preventScroll:true});}
    function transition(next, {focus = true} = {}) {view=next;render();screen.scrollTop=0;if(focus)focusHeading();}
    function operation(label, action) {
      if (busy) return Promise.resolve();
      busy=true; const generation=++request;content.setAttribute('aria-busy','true');notifyState();
      content.innerHTML='';const status=paragraph(label);status.setAttribute('role','status');status.setAttribute('tabindex','-1');content.append(status);status.focus?.();
      return Promise.resolve().then(action).catch(cause=>{
        if(generation===request)showError(cause);
      }).finally(()=>{
        if(generation===request){busy=false;content.removeAttribute('aria-busy');render();focusHeading();}
      });
    }
    function showError(cause) {
      error=cause;errorReturn=['error','active','recovery'].includes(view)?(preservation?'preservation':selected?'preview':'home'):view;
      if(cause?.code==='recovery-required')view='recovery';
      else if(cause?.code==='active-session')view='active';
      else view='error';
    }
    function cancel() {
      if(busy)return;
      selected=null;destination=null;preservation=false;verified=false;restoring=false;error=null;
      transition('home');
    }
    function fileChooser(purpose) {
      if(busy)return;
      const input=node('input');input.type='file';input.accept='.json,application/json';
      input.className='backup-file-input';input.setAttribute('aria-label',purpose==='restore'?'Choose GarageFit backup file':'Reselect saved backup file');
      input.onchange=()=>{
        const file=input.files?.[0];
        if(file)return selectFile(file,purpose);
        // Cancelling a picker is not a validation failure and never changes data.
      };
      input.oncancel=()=>{input.remove?.();};content.append(input);input.click();
    }
    function selectFile(file, purpose = 'restore') {
      if(!file)return Promise.resolve();
      if(purpose==='restore'){restoring=true;selected=null;destination=null;}
      return operation(purpose==='restore'?'Checking backup file…':'Verifying saved file…',async()=>{
        if(purpose==='restore') {
          if(isBlocked())throw Object.assign(new Error('Finish or save the current activity before restoring a backup.'),{code:'active-session'});
          const text=await readFile(file), result=await backup.validate(text);
          selected={...result,text,name:file.name||'Selected backup'};preservation=false;verified=false;
          view='preview';
        } else {
          const text=await readFile(file);
          await backup.verify(text,{preserve:purpose==='preserve'});
          verified=true;view='verified';
        }
      });
    }
    function prepare(preserve = false) {
      preservation=preserve;verified=false;reportedSaved=false;
      return operation(preserve?'Preparing preservation backup…':'Preparing backup…',async()=>{
        prepared=await backup.prepare({preserve});view='ready';
      });
    }
    function save() {
      if(!prepared||busy)return;
      // Invoke the native/browser file API synchronously in this click handler.
      // Do not await hashing or start a generic async operation first.
      let result;
      try { result=saveFile(prepared); }
      catch(cause) {showError(cause);render();focusHeading();return;}
      busy=true;content.setAttribute('aria-busy','true');notifyState();
      for(const control of content.querySelectorAll?.('button')||[])control.disabled=true;
      return Promise.resolve(result).then(outcome=>{
        if(outcome?.status==='cancelled')view='ready';
        else if(outcome?.status==='offered')view='offered';
        else throw new Error('This browser could not offer the backup file. Try another browser or saving method.');
      }).catch(cause=>{
        if(cause?.name==='AbortError')view='ready';else showError(cause);
      }).finally(()=>{busy=false;content.removeAttribute('aria-busy');render();focusHeading();});
    }
    function continueRestore() {
      return operation('Checking current device…',async()=>{
        if(isBlocked())throw Object.assign(new Error('Finish or save your current activity first.'),{code:'active-session'});
        destination=backup.inspectDestination();preservation=destination.meaningful;
        view=destination.meaningful&&!destination.preservationVerified?'preservation':'confirm';
      });
    }
    function confirm() {
      return operation('Replacing GarageFit data safely…',async()=>{
        await backup.restore(selected.text,{confirmed:true});view='complete';
      });
    }
    function date(value) {const d=new Date(value);return Number.isFinite(+d)?d.toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'}):'Export date unavailable';}
    function equipment() {
      const entries=new Map(selected.archive.sections.preferences.entries);
      if(entries.has('gf_equipment_inventory')) {
        const ids=JSON.parse(entries.get('gf_equipment_inventory'));
        return ids.length?ids.length+' items':entries.get('gf_equipment_configured')==='true'?'Bodyweight only':'Not configured';
      }
      if(entries.has('gf_equipment'))return entries.get('gf_equipment')==='true'?'Legacy equipment selection':'Bodyweight only';
      return 'Not recorded';
    }
    function selectedCard() {content.append(card('Selected backup',selected.name+' · '+date(selected.archive.createdAt)));}
    function summary() {
      const s=selected.summary;content.append(node('h2','Backup contents','backup-kicker'));
      content.append(row('Recorded sessions',s.sessions),row('Completed / partial',s.completed+' / '+s.partial),
        row('Coach programmes',s.programmes),row('Equipment',equipment()),row('Preferences & history',s.preferences?'Included':'None recorded'));
      if(s.sessions!==s.completed+s.partial)content.append(paragraph('Recorded sessions also include other saved activity statuses. Completed and partial counts are shown separately.',true));
    }
    function render() {
      notifyState();
      if(busy)return;
      content.innerHTML='';title.textContent=(restoring&&view==='error')||['preview','preservation','confirm','complete','recovery','active'].includes(view)?'Restore backup':'Backup & Restore';
      content.setAttribute('data-backup-view',view);
      if(view==='home') {
        content.append(paragraph('Keep a copy of your GarageFit data or move it to another device.'),
          card('Your data','Stored on this device. Backups are manual; devices do not sync.'),
          node('h2','Create a backup','backup-kicker'),paragraph('Save training history, Coach programmes, equipment and preferences.'),
          button('Create backup',()=>prepare()),paragraph(verified?'A prepared backup file was independently verified. It is a snapshot, not a live backup.':reportedSaved?'You reported saving a file. It has not been independently verified.':'No saved backup confirmed.',true),
          node('h2','Restore a backup','backup-kicker'),paragraph('Choose a file to review before replacing data.'),
          button('Choose backup file',()=>fileChooser('restore'),'secondary'),
          button('Moving to another device',()=>transition('help'),'link'));
      } else if(view==='ready') {
        content.append(card(preservation?'Preservation file ready':'Backup file ready',prepared.filename),
          paragraph('Choose where to save this file. On iPhone use Save to Files.'),
          button(preservation?'Save preservation file':'Save backup file',save),
          paragraph('Preparing a file does not mean it has been saved.',true),button('Cancel',()=>transition(preservation?'preservation':'home'),'secondary'));
      } else if(view==='offered') {
        content.append(card('Check your saved file','GarageFit offered the file to your device. Saving has not been verified.'),
          paragraph('Open Files or your chosen location and check that the file is there.'),
          button('Verify saved file',()=>fileChooser(preservation?'preserve':'verify')),
          button('Save again',save,'secondary'));
        if(!preservation)content.append(button('I saved it — skip verification',()=>{reportedSaved=true;verified=false;transition('home');},'link'));
        else content.append(paragraph('Replacement stays locked until you reselect and verify the saved preservation file.',true));
        content.append(paragraph('Your last prepared backup is not automatically up to date.',true),button(preservation?'Cancel restore':'Back to Backup & Restore',cancel,'secondary'));
      } else if(view==='verified') {
        content.append(card(preservation?'Preservation backup verified':'Backup file verified','The reselected file matches the prepared backup and passed integrity and content checks.'),
          paragraph('Verification confirms this selected file. Keep it somewhere you can access again.',true));
        if(preservation)content.append(button('Continue to confirmation',()=>{
          try {destination=backup.inspectDestination();if(!destination.preservationVerified)throw Object.assign(new Error('Your data changed. Create and verify a new preservation backup.'),{code:'preservation-required'});transition('confirm');}
          catch(cause){showError(cause);render();}
        }));
        else content.append(button('Done',()=>transition('home')));
      } else if(view==='preview') {
        content.append(card('Backup is compatible'));selectedCard();summary();
        content.append(card('This will replace your current data. Nothing is merged.',null,true),
          button('Continue to protect data',continueRestore),button('Choose another file',()=>fileChooser('restore'),'secondary'));
      } else if(view==='preservation') {
        content.append(card('Save your current data first. Restoring replaces it.',null,true),
          paragraph('A separately saved, verified preservation backup is mandatory before continuing.'),node('h2','Current device','backup-kicker'));
        if(destination?.summary)content.append(row('Recorded sessions',destination.summary.sessions),row('Coach programmes',destination.summary.programmes));
        else content.append(card('Existing GarageFit records','Your history, programme, equipment and preference records will be preserved.'));
        content.append(button('Create preservation backup',()=>prepare(true)),paragraph('Replacement remains locked until the saved copy is verified.',true),button('Cancel restore',cancel,'secondary'));
      } else if(view==='confirm') {
        content.append(card(preservation?'Preservation backup verified':'This device has no saved GarageFit data'));selectedCard();
        if(destination?.summary)content.append(row('Current sessions',destination.summary.sessions));
        content.append(row('Backup sessions',selected.summary.sessions),card('Existing records will be replaced, not combined.',null,true));
        const label=node('label',undefined,'backup-confirm-label'),check=node('input');check.type='checkbox';check.id='backupReplacementConsent';
        const text=node('span','I understand that my data will be replaced.');label.append(check,text);content.append(label);
        const replace=button('Replace data and restore',confirm,'danger');replace.disabled=true;
        check.onchange=()=>{replace.disabled=!check.checked;};content.append(replace,button('Cancel',cancel,'secondary'));
      } else if(view==='complete') {
        content.append(card('Restore complete'),paragraph('Your GarageFit backup has been restored on this device.'),
          card('Training records restored','Continue to reload GarageFit and make these records available.'),
          paragraph('Devices do not sync automatically. Active workouts are not restored.',true),button('Continue to GarageFit',onRestored));
      } else if(view==='recovery') {
        content.append(card('Data recovery needed',null,true),paragraph(error?.message||'GarageFit cannot safely confirm which data is available.'),
          card('Training is temporarily unavailable to protect your records.',null,true),button('Retry recovery',retryRecovery),
          button('Recovery guidance',()=>transition('recoveryHelp'),'secondary'),paragraph('Never continue into mixed or partially restored data.',true));
      } else if(view==='recoveryHelp') {
        content.append(card('Protect your records','Keep the original browser data and your saved backup files.'),
          paragraph('Close other GarageFit tabs, free browser storage without clearing GarageFit data, and retry recovery. Do not clear website data or uninstall the app while recovery is unresolved.'),button('Retry recovery',retryRecovery));
      } else if(view==='active') {
        content.append(card('Finish or end your workout first',null,true),paragraph('Backup & Restore is unavailable while an activity is active or its records are still being saved.'),
          card('Keep performed evidence','Return to the workout and use the existing completion or exit process.'),button('Return to workout',returnToActivity),button('Cancel restore',cancel,'secondary'));
      } else if(view==='help') {
        content.append(node('h2','On your old device','backup-kicker'),paragraph('Create a backup, save it using Files or another provider, and verify the saved copy.'),
          node('h2','On your new device','backup-kicker'),paragraph('Transfer the file to the new device. Open GarageFit, choose the backup, review its contents and follow the restore safeguards.'),
          card('Manual transfer','Devices do not sync. A backup is a snapshot, not a live connection.'),paragraph('Active workouts never transfer.',true));
      } else if(view==='error') {
        const unchanged=error?.code!=='restore-rolled-back';
        const heading=error?.code==='restore-rolled-back'?'Original data recovered':selected?'Cannot continue restore':'Cannot use this backup';
        const alert=card(heading,error?.message||'The file is invalid, incompatible or cannot be verified.',true);alert.setAttribute('role','alert');content.append(alert);
        content.append(card(unchanged?'Your data is unchanged':'Your original data is available',unchanged?'No replacement has completed.':'The replacement was rolled back safely.'));
        if(['preservation-required','preservation-mismatch','concurrent-change'].includes(error?.code))content.append(button('Create new preservation backup',()=>{preservation=true;transition('preservation');}));
        else if(selected)content.append(button('Try again',()=>error?.code==='another-tab'?continueRestore():transition(errorReturn)));
        content.append(button('Choose another file',()=>fileChooser('restore'),selected?'secondary':'primary'),button('Cancel restore',cancel,'secondary'));
      }
    }
    function open() {
      if(!canLeave())return;
      error=null;selected=null;destination=null;preservation=false;restoring=false;
      view=isBlocked()?'active':'home';showScreen('backupRestore');render();screen.scrollTop=0;focusHeading();
    }
    function back() {
      if(!canLeave())return false;
      if(view==='home'){showScreen('settings');document.getElementById('backupRestoreEntry')?.focus?.();}
      else if(view==='help')transition('home');
      else if(view==='ready')transition(preservation?'preservation':'home');
      else cancel();
      return true;
    }
    function canLeave(){return !busy&&!['recovery','recoveryHelp','complete'].includes(view);}
    function showRecovery(cause) {error=cause;busy=false;showScreen('backupRestore');transition('recovery');}
    function showComplete() {busy=false;showScreen('backupRestore');transition('complete');}
    return {open,back,canLeave,showRecovery,showComplete,selectFile};
  }
  root.GarageFitBackupUI={mount};
})(typeof window!=='undefined'?window:globalThis);
