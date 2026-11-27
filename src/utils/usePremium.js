// Состояние Премиума (подписка на сайте): активна ли, до какого числа, палитра цветов ника и выбранный цвет.
// Одно общее на всё окно: кнопка Premium, окно «What the Premium gives», имя на главном экране и плащи читают его отсюда.
import { useEffect, useState } from 'react';

let state = {
  loaded: false, ok: false, signedIn: true, active: false, expiresAt: null, nickColor: null, nick: null, colors: [], error: null,
};
const subs = new Set();
let inflight = null;
const emit = () => subs.forEach((fn) => fn(state));
const set = (patch) => { state = { ...state, ...patch }; emit(); };

// Another site account signed in (or the first one): what was read for the previous one (nick, colour, subscription) must not stay.
export function resetPremium() {
  state = { ...state, loaded: false, ok: false, active: false, expiresAt: null, nickColor: null, nick: null, error: null };
  emit();
  return refreshPremium();
}

export function refreshPremium() {
  if (inflight) return inflight;
  inflight = window.api.premium.status().then((r) => {
    if (r?.ok) set({ loaded: true, ok: true, error: null, signedIn: r.signedIn !== false, active: r.active, expiresAt: r.expiresAt, nickColor: r.nickColor, nick: r.nick || null, colors: r.colors });
    else set({ loaded: true, ok: false, error: r?.error || 'Unable to obtain subscription status' });
  }).catch((e) => set({ loaded: true, ok: false, error: e.message }))
    .finally(() => { inflight = null; });
  return inflight;
}

// Человек активировал ключ на сайте и вернулся в лаунчер — подписка подхватывается сама (не чаще раза в 20 seconds).
let lastFocusRefresh = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (!state.loaded || Date.now() - lastFocusRefresh < 20000) return;
    lastFocusRefresh = Date.now();
    refreshPremium();
  });
}

// id палитры или null (убрать цвет)
export async function chooseNickColor(id) {
  const r = await window.api.premium.setNickColor(id);
  if (r?.ok) set({ nickColor: r.nickColor });
  return r;
}

export function usePremium() {
  const [snap, setSnap] = useState(state);
  useEffect(() => {
    subs.add(setSnap);
    setSnap(state);
    if (!state.loaded) refreshPremium();
    return () => { subs.delete(setSnap); };
  }, []);
  return snap;
}

// Окно «What the Premium gives» одно на всё приложение: любая кнопка просто просит его открыть.
let modalOpen = false;
const modalSubs = new Set();
export function openPremium() { modalOpen = true; modalSubs.forEach((fn) => fn(true)); refreshPremium(); }
export function closePremium() { modalOpen = false; modalSubs.forEach((fn) => fn(false)); }
export function usePremiumModal() {
  const [open, setOpen] = useState(modalOpen);
  useEffect(() => { modalSubs.add(setOpen); setOpen(modalOpen); return () => { modalSubs.delete(setOpen); }; }, []);
  return open;
}

// CSS для текста ником: градиент по буквам (или один цвет). Цвета приходят of лаунчера уже проверенными (#RRGGBB).
export function nickStyle(colors, id) {
  const c = colors.find((x) => x.id === id);
  if (!c) return undefined;
  const stops = c.stops.length === 1 ? [c.stops[0], c.stops[0]] : c.stops;
  return {
    backgroundImage: `linear-gradient(90deg, ${stops.join(', ')})`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent',
  };
}
