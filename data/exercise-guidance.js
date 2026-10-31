(function (root) {
  // Display-only, editorially reviewed additions. Never copied into workout/session records.
  const fields=Object.freeze(['setup','movement','technique','beforeYouTry']);
  function buildExerciseGuidance(entries) {
    if (!entries || typeof entries!=='object' || Array.isArray(entries)) throw new Error('Invalid exercise guidance');
    const result=Object.create(null), catalogue=root.GarageFitData.exercises;
    for (const [id,sections] of Object.entries(entries)) {
      if (!Object.prototype.hasOwnProperty.call(catalogue,id)) throw new Error('Unknown guidance exercise: '+id);
      if (!sections || typeof sections!=='object' || Array.isArray(sections) || !Object.keys(sections).length) throw new Error('Invalid guidance sections: '+id);
      const copy={};
      for (const [key,value] of Object.entries(sections)) {
        if (!fields.includes(key) || typeof value!=='string' || !value.trim()) throw new Error('Invalid guidance section: '+key);
        copy[key]=value.trim();
      }
      result[id]=Object.freeze(copy);
    }
    return Object.freeze(result);
  }
  // Intentionally empty: revised teaching drafts have NOT received editorial approval.
  const reviewed=buildExerciseGuidance({});
  root.GarageFitData.buildExerciseGuidance=buildExerciseGuidance;
  root.GarageFitData.exerciseGuidance=id=>typeof id==='string'&&Object.prototype.hasOwnProperty.call(reviewed,id)?reviewed[id]:null;
})(typeof window==='undefined' ? globalThis : window);
