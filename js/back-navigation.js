// One shared back action for nested GarageFit views, used identically by the top-left back
// control, the left-edge swipe and browser/Android back. It owns no screen state: the app
// supplies the current view and an explicit view -> back-action map that reuses existing
// callbacks (so screen-specific cleanup is never bypassed). Views without a route
// (player, workoutPlayer, done, coachResult, landings) are not eligible, ever.
(function (root) {
  const EDGE_PX = 24, MIN_DX = 72, MAX_SLOPE = 0.6, SLOP_PX = 10, MAX_MS = 900;

  function create({getView, routes, history, win}) {
    const hist = history || (win && win.history), target = win;
    let sentinel = false, ignorePops = 0, going = false;
    const eligible = view => !!view && Object.prototype.hasOwnProperty.call(routes, view);
    const current = () => getView();
    function canGoBack() { return eligible(current()); }
    // Exactly one transition: re-entrant calls (e.g. a swipe plus a tap) are dropped.
    function back() {
      if (going) return false;
      const view = current();
      if (!eligible(view)) return false;
      going = true;
      try { routes[view](); } finally { going = false; }
      sync();
      return true;
    }
    // Keep a single bounded history sentinel while an eligible view is showing, so browser/Android
    // back runs the same action instead of leaving the app. Leaving eligible views removes it.
    function sync() {
      if (!hist || typeof hist.pushState !== 'function') return;
      const should = canGoBack();
      if (should && !sentinel) { hist.pushState({gfBack: 1}, ''); sentinel = true; }
      else if (!should && sentinel) { sentinel = false; ignorePops++; hist.back(); }
    }
    function onPop() {
      if (ignorePops > 0) { ignorePops--; return; }
      if (!sentinel) return;            // not ours: let the browser leave normally
      sentinel = false;                  // the browser already consumed our entry
      if (canGoBack()) back();           // back() re-syncs, pushing a fresh sentinel if still nested
    }
    if (target && typeof target.addEventListener === 'function') target.addEventListener('popstate', onPop);
    return {back, canGoBack, sync, eligible, onPop, state: () => ({sentinel, ignorePops})};
  }

  // Rightward swipe that starts at the left edge. Fires onBack once, on release, only when
  // the gesture is predominantly horizontal and long enough; cancelled/vertical/multi-touch
  // gestures and gestures starting on form fields do nothing.
  function createSwipe({canStart, onBack, edge = EDGE_PX, minDx = MIN_DX, now = () => Date.now()}) {
    let g = null;
    const blocked = el => !!(el && typeof el.closest === 'function' && el.closest('input,select,textarea,[contenteditable="true"],[data-no-swipe-back]'));
    const point = event => (event.changedTouches || event.touches || [])[0];
    function start(event) {
      g = null;
      if (event.touches && event.touches.length > 1) return;
      const t = point(event);
      if (!t || t.clientX > edge || blocked(event.target) || !canStart()) return;
      g = {x: t.clientX, y: t.clientY, at: now(), dead: false};
    }
    function move(event) {
      if (!g || g.dead) return;
      if (event.touches && event.touches.length > 1) { g.dead = true; return; }
      const t = point(event); if (!t) return;
      const dx = t.clientX - g.x, dy = Math.abs(t.clientY - g.y);
      if (dx < -SLOP_PX || (dy > SLOP_PX && dy > dx * MAX_SLOPE)) g.dead = true;
    }
    function end(event) {
      const gesture = g; g = null;
      if (!gesture || gesture.dead) return false;
      const t = point(event); if (!t) return false;
      const dx = t.clientX - gesture.x, dy = Math.abs(t.clientY - gesture.y);
      if (dx < minDx || dy > dx * MAX_SLOPE || now() - gesture.at > MAX_MS || !canStart()) return false;
      onBack();
      return true;
    }
    const cancel = () => { g = null; };
    function attach(node) {
      node.addEventListener('touchstart', start, {passive: true});
      node.addEventListener('touchmove', move, {passive: true});
      node.addEventListener('touchend', end, {passive: true});
      node.addEventListener('touchcancel', cancel, {passive: true});
    }
    return {start, move, end, cancel, attach};
  }

  root.GarageFitBackNav = {create, createSwipe, EDGE_PX, MIN_DX};
})(typeof window !== 'undefined' ? window : globalThis);
