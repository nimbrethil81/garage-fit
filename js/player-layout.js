/* Viewport and disclosure presentation only; playback and outcome recording stay
   in their existing owners. No dependencies, timers or workout state here. */
(function () {
  const app = document.getElementById('app');
  const players = [...document.querySelectorAll('#player,#workoutPlayer')];
  const viewport = window.visualViewport;
  function syncViewport() {
    app.style.setProperty('--player-viewport-height', (viewport ? viewport.height : window.innerHeight) + 'px');
    app.style.setProperty('--player-viewport-top', (viewport ? viewport.offsetTop : 0) + 'px');
  }
  syncViewport();
  window.addEventListener('resize', syncViewport);
  viewport?.addEventListener('resize', syncViewport);
  viewport?.addEventListener('scroll', syncViewport);

  players.forEach(player => {
    const stage = player.querySelector('.routine-stage,.workout-stage');
    const actions = player.querySelector('.controls,.workout-actions');
    const header = player.querySelector('.player-top,.workout-player-top');
    const disclosures = [...stage.querySelectorAll('details')];
    disclosures.forEach(details => {
      const summary = details.querySelector('summary');
      const surface = document.createElement('div');
      surface.className = 'player-detail-surface';
      surface.setAttribute('role', 'region');
      surface.setAttribute('aria-label', summary.textContent);
      const heading = document.createElement('div');
      heading.className = 'player-detail-heading';
      const title = document.createElement('span');
      title.textContent = summary.textContent;
      const close = document.createElement('button');
      close.type = 'button'; close.className = 'player-detail-close'; close.textContent = 'Close';
      const content = document.createElement('div');
      content.className = 'player-detail-content';
      [...details.children].filter(child => child !== summary).forEach(child => content.appendChild(child));
      heading.append(title, close); surface.append(heading, content); details.appendChild(surface);
      if (details.id === 'coachAnchorEdit') {
        // Retain the confirmation outside the editor and show its live text while
        // editing too. Keep the original live region as the sole announcer.
        const source = document.getElementById('coachActualSummary');
        const confirmation = document.createElement('p');
        confirmation.className = 'player-detail-confirmation';
        content.prepend(confirmation);
        const sync = () => { confirmation.textContent = source.textContent; };
        sync();
        new MutationObserver(sync).observe(source, {childList:true,subtree:true,characterData:true});
      }
      const dismiss = () => { details.open = false; summary.focus(); };
      close.addEventListener('click', dismiss);
      surface.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
      });
      details.addEventListener('toggle', () => {
        if (details.open) {
          disclosures.filter(other => other !== details).forEach(other => { other.open = false; });
          content.scrollTop = 0;
          close.focus({preventScroll:true});
        } else if (surface.contains(document.activeElement)) summary.focus({preventScroll:true});
      });
    });
    let frame;
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (player.classList.contains('hidden')) return;
        mutations.disconnect();
        player.style.setProperty('--player-actions-height', actions.getBoundingClientRect().height + 'px');
        player.style.setProperty('--player-detail-top', (header.getBoundingClientRect().bottom - player.getBoundingClientRect().top + 6) + 'px');
        // Re-evaluate from the regular layout after orientation/text-size changes.
        player.classList.remove('player-reflow');
        const ring = stage.querySelector('.ring-wrap');
        const ringSize = ring.getBoundingClientRect().width;
        if (stage.scrollHeight > stage.clientHeight + 1 || stage.scrollWidth > stage.clientWidth + 1 || ringSize > 0 && ringSize < 100) player.classList.add('player-reflow');
        // A phase change closes a hidden disclosure without retaining input focus.
        disclosures.forEach(details => {
          if (details.closest('.hidden') && details.open) details.open = false;
        });
        observeMutations();
      });
    }
    const sizes = new ResizeObserver(schedule);
    [player, header, actions, stage.querySelector('.exercise-name,.workout-exercise')].forEach(element => sizes.observe(element));
    const mutations = new MutationObserver(schedule);
    function observeMutations() {
      mutations.observe(player, {childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','open']});
    }
    observeMutations();
  });
})();
