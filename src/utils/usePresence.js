import { useEffect, useState } from 'react';

const AFK_MS = 3 * 60 * 1000;

// True while the launcher is in the background (window unfocused/minimised) or
// nobody has touched it for a few minutes — what Discord calls "бездельничает".
function useAway() {
  const [away, setAway] = useState(() => !document.hasFocus());
  useEffect(() => {
    let last = Date.now();
    const compute = () => setAway(!document.hasFocus() || document.hidden || Date.now() - last > AFK_MS);
    const touch = () => { last = Date.now(); compute(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'focus'];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    window.addEventListener('blur', compute);
    document.addEventListener('visibilitychange', compute);
    const timer = setInterval(compute, 15000);
    compute();
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.removeEventListener('blur', compute);
      document.removeEventListener('visibilitychange', compute);
      clearInterval(timer);
    };
  }, []);
  return away;
}

// Reports what the user is doing to the main process, which turns it into the
// Discord status (a running game always takes priority over this there):
//   'browsing'  library / home / an instance page
//   'searching' looking for mods & modpacks (search page, project card, in-instance finder)
//   'idle'      anything else, or the launcher is in the background / AFK
export function usePresence({ page, projectOpen, finderOpen }) {
  const away = useAway();
  let kind = 'idle';
  if (page === 'search' || projectOpen || finderOpen) kind = 'searching';
  else if (page === 'home' || page === 'library' || page === 'instance') kind = 'browsing';
  if (away) kind = 'idle';

  useEffect(() => {
    window.api.presence?.set(kind);
  }, [kind]);
}
