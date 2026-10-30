(function(root){
  'use strict';
  const KEY='gf_first_use_v1';
  // Presentation only. Equipment and completion remain owned by their existing stores.
  function eligible(result){
    return !!result && ['generator','coach','fixed'].includes(result.source)
      && (result.source!=='fixed'||['deskBreak','postRunReset'].includes(result.workoutId))
      && result.finalStatus==='completed' && (result.performedWork||[]).some(work=>
        ['completed','partial'].includes(work.status) && (!(work.sets||[]).some(set=>set.reps!=null||set.seconds!=null)
          || work.sets.some(set=>set.reps>0||set.seconds>0)));
  }
  function create({storage,store,onChange=()=>{}}){
    let marker=null, completed=false, available=false;
    function persist(next){
      try{storage.setItem(KEY,JSON.stringify(next));marker=next;return true;}catch(_){return false;}
    }
    function snapshot(){return {isNew:available&&marker?.audience==='new',explored:!!marker?.explored,completed,modes:(marker?.modes||[]).slice()};}
    // Snapshot legacy evidence before any startup reconciliation or preference writes.
    const ready=(async()=>{
      try{
        const raw=storage.getItem(KEY);
        if(raw!==null){
          const value=JSON.parse(raw);
          if(!value||value.version!==1||!['new','existing'].includes(value.audience)||typeof value.explored!=='boolean'
            ||!Array.isArray(value.modes)||value.modes.some(id=>!['home','coach'].includes(id))
            ||(value.acknowledged!=null&&typeof value.acknowledged!=='string'))return;
          marker=value;
        }else{
          const preferenceKeys=['gf_equipment','gf_equipment_inventory','gf_equipment_configured',
            'gf_300_pb_seconds','gf_amrap_results','gf_generator_duration','gf_generator_focus',
            'gf_generator_difficulty','gf_generator_body_focus','gf_generator_history','gf_routine_variant',
            'gf_routine_recent_v1','gf_post_run_recent_v1','gf_desk_break_recent_v1',
            'gf_appearance_v1','gf_spoken_voice_v1','gf_workout_diagnostics_v1'];
          const legacy=preferenceKeys.some(key=>storage.getItem(key)!==null)||await store.hasInstallationEvidence();
          if(!persist({version:1,audience:legacy?'existing':'new',explored:false,modes:[],acknowledged:null}))return;
        }
        if(marker.audience==='new'){
          const query=await store.listSessionResults();
          if(query.errors.length||query.indexRecovered)return;
          completed=query.results.some(eligible);
        }
        available=true;
      }catch(_){/* Unknown installations never receive first-use UI. */}
      onChange(snapshot());
    })();
    return {ready,snapshot,
      explore(){if(snapshot().isNew&&!completed&&!marker.explored&&persist({...marker,explored:true}))onChange(snapshot());},
      dismissMode(id){if(snapshot().isNew&&['home','coach'].includes(id)&&!marker.modes.includes(id)&&persist({...marker,modes:[...marker.modes,id]}))onChange(snapshot());},
      async saved(result){
        await ready;
        if(!snapshot().isNew||completed||marker.acknowledged||!eligible(result))return false;
        // Callers invoke this only after their normal persistence transaction succeeds.
        try{const saved=await store.getSessionResult(result.sessionResultId);if(!eligible(saved))return false;}catch(_){return false;}
        if(completed||marker.acknowledged)return false;
        completed=true;
        const acknowledged=persist({...marker,acknowledged:result.sessionResultId});
        onChange(snapshot());
        return acknowledged;
      }
    };
  }
  root.GarageFitFirstUse={create,eligible};
})(typeof window!=='undefined'?window:globalThis);
