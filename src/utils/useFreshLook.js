import { useEffect, useState } from 'react';

// Как показывать глаза Fresh Moves на персонаже в самом лаунчере (главный экран, «Скины», окна). Хранится на этом компьютере;
// к самой игре отношения не имеет: что будет в игре, определяют пак и моды (см. FreshMovesModal).
export const FRESH_CHANGED = 'eternal:fresh-changed';
const KEY = 'eternal.freshEyes';
// Off until the player turns it on (the Fresh Moves window does that when Fresh Moves is installed there): a skin with stray pixels in the
// free corners must not get eyes drawn on its character by itself
const DEFAULT = { enabled: false, blink: true };

export function readFreshLook() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return { enabled: v?.enabled === true, blink: v?.blink !== false };
  } catch { return { ...DEFAULT }; }
}

export function saveFreshLook(patch) {
  const next = { ...readFreshLook(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* without saving the setting lives to restart */ }
  window.dispatchEvent(new Event(FRESH_CHANGED));
  return next;
}

export function useFreshLook() {
  const [look, setLook] = useState(readFreshLook);
  useEffect(() => {
    const run = () => setLook(readFreshLook());
    window.addEventListener(FRESH_CHANGED, run);
    window.addEventListener('storage', run);
    return () => { window.removeEventListener(FRESH_CHANGED, run); window.removeEventListener('storage', run); };
  }, []);
  return look;
}
