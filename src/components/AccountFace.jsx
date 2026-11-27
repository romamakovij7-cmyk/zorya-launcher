// Голова аккаунта (с вторым слоем): у Microsoft — скин аккаунта, у оффлайн-аккаунта — скин of библиотеки, который он носит в игре.
// Если своего скина нет — голова одного of стандартных персонажей Minecraft (тот же, что стоит на сцене, см. utils/defaultSkin.js).
import { useEffect, useState } from 'react';
import SkinFace from './SkinFace.jsx';
import { UserIcon } from './Icons.jsx';
import { defaultSkinFor } from '../utils/defaultSkin.js';

const cache = new Map(); // id skin → dataUrl (The contents of the skin on id do not change)
let lastList = [];

async function loadList() {
  const list = await window.api.skins.list();
  lastList = list || [];
  for (const s of lastList) cache.set(s.id, s.dataUrl);
  return lastList;
}

async function wornSkinUrl(id) {
  if (cache.has(id)) return cache.get(id);
  await loadList();
  return cache.get(id) || null;
}

export function useAccountSkinUrl(account) {
  // На неосновном оффлайн-аккаунте скины Eternal не работают, выбранный когда-то скин не показываем
  const wornId = account?.type === 'offline' ? account.offlineSkinId || null : null;
  const [worn, setWorn] = useState(() => (wornId ? cache.get(wornId) || null : null));
  const own = wornId ? worn : (account?.skinUrl || null);
  const needFallback = !!account && !own && !wornId; // while a chosen skin is still being read, no stand-in flashes up
  const [fallback, setFallback] = useState(() => (needFallback ? defaultSkinFor(account, lastList)?.dataUrl || null : null));

  useEffect(() => {
    let alive = true;
    if (!wornId) { setWorn(null); return undefined; }
    wornSkinUrl(wornId).then((u) => { if (alive) setWorn(u); }).catch(() => { if (alive) setWorn(null); });
    return () => { alive = false; };
  }, [wornId]);

  useEffect(() => {
    let alive = true;
    if (!needFallback) { setFallback(null); return undefined; }
    (lastList.length ? Promise.resolve(lastList) : loadList())
      .then((list) => { if (alive) setFallback(defaultSkinFor(account, list)?.dataUrl || null); })
      .catch(() => { if (alive) setFallback(null); });
    return () => { alive = false; };
  }, [needFallback, account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return own || fallback;
}

export default function AccountFace({ account, size, iconSize = 20 }) {
  const url = useAccountSkinUrl(account);
  return url ? <SkinFace src={url} size={size} /> : <UserIcon width={iconSize} height={iconSize} />;
}
