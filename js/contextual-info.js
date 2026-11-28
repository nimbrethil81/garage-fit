(function (root) {
  let active, nextId = 0;
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5m0-8h.01"/></svg>';
  const equipmentCopy = 'Saved across PickSetGo for future workouts. Already prepared workouts and workouts in progress keep their original equipment and exercises.';

  function dismiss(restoreFocus = false) {
    if (!active) return;
    const {trigger, panel, slot, observer} = active;
    active = null;
    observer.disconnect();
    trigger.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    slot.append(panel);
    if (restoreFocus && trigger.getClientRects().length) trigger.focus({preventScroll:true});
  }

  function place(trigger, panel, screen) {
    const anchor = trigger.getBoundingClientRect(), bounds = screen.getBoundingClientRect();
    const viewport = root.visualViewport;
    const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? root.innerWidth, height = viewport?.height ?? root.innerHeight;
    const style = root.getComputedStyle(panel);
    const inset = edge => parseFloat(style.getPropertyValue('--info-safe-'+edge)) || 0;
    const left = Math.max(bounds.left, x + inset('left')) + 8;
    const right = Math.min(bounds.right, x + width - inset('right')) - 8;
    const top = Math.max(bounds.top, y + inset('top')) + 8;
    const bottom = Math.min(bounds.bottom, y + height - inset('bottom')) - 8;
    const below = bottom - anchor.bottom - 4, above = anchor.top - top - 4;
    if (right <= left || Math.max(below, above) < 44) return false;

    panel.style.width = Math.min(320, right - left)+'px';
    panel.style.maxHeight = '';
    const naturalHeight = panel.offsetHeight;
    const useBelow = naturalHeight <= below || below >= above;
    panel.style.maxHeight = (useBelow ? below : above)+'px';
    panel.style.left = Math.max(left, Math.min(right, anchor.right) - panel.offsetWidth)+'px';
    panel.style.top = (useBelow ? anchor.bottom + 4 : anchor.top - 4 - panel.offsetHeight)+'px';
    return true;
  }

  function create(label, copy) {
    const slot = document.createElement('div'), trigger = document.createElement('button');
    const panel = document.createElement('section'), header = document.createElement('div');
    const title = document.createElement('strong'), close = document.createElement('button'), body = document.createElement('p');
    const id = 'contextual-info-'+(++nextId);
    slot.className = 'contextual-info';
    trigger.type = close.type = 'button';
    trigger.className = 'contextual-info-trigger';
    trigger.setAttribute('aria-label', label);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', id);
    trigger.innerHTML = icon;
    panel.className = 'contextual-info-panel';
    panel.id = id;
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', id+'-title');
    header.className = 'contextual-info-header';
    title.id = id+'-title';
    title.textContent = label;
    close.className = 'contextual-info-close';
    close.setAttribute('aria-label', 'Close '+label);
    close.textContent = '×';
    body.textContent = copy;
    header.append(title, close);
    panel.append(header, body);
    slot.append(trigger, panel);

    trigger.onclick = () => {
      const wasOpen = active?.trigger === trigger;
      dismiss();
      if (wasOpen) { trigger.focus({preventScroll:true}); return; }

      const screen = trigger.closest('.screen');
      document.body.append(panel);
      panel.hidden = false;
      const observer = new MutationObserver(() => {
        if (!trigger.getClientRects().length || !panel.isConnected) dismiss();
      });
      active = {trigger, panel, slot, observer};
      if (!place(trigger, panel, screen)) { dismiss(); return; }
      observer.observe(screen, {subtree:true, childList:true, attributes:true, attributeFilter:['class','hidden','open']});
      trigger.setAttribute('aria-expanded', 'true');
      close.focus({preventScroll:true});
    };
    close.onclick = () => dismiss(true);
    return slot;
  }

  function row(heading, label, copy) {
    const wrap = document.createElement('div');
    wrap.className = 'contextual-info-row';
    wrap.append(heading, create(label, copy));
    return wrap;
  }

  function dismissOutside(event) {
    if (active && !active.trigger.contains(event.target) && !active.panel.contains(event.target)) dismiss();
  }
  document.addEventListener('pointerdown', dismissOutside, true);
  document.addEventListener('focusin', dismissOutside);
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss(true);
    } else if (event.key === 'Tab' && active.panel.contains(event.target)) {
      // Resume sequential navigation at the trigger's position in the screen.
      if (event.shiftKey) event.preventDefault();
      dismiss(true);
    }
  }, true);
  root.addEventListener('scroll', event => {
    if (active && event.target !== active.panel) dismiss();
  }, true);
  root.addEventListener('resize', () => dismiss());
  root.visualViewport?.addEventListener('resize', () => dismiss());
  root.visualViewport?.addEventListener('scroll', () => dismiss());

  root.GarageFitContextualInfo = {create, row, dismiss, equipmentCopy};
})(typeof window === 'object' ? window : globalThis);
