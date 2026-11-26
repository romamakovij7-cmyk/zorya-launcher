// Settings мода Female Gender для персонажа в лаунчере (чтобы на главном экране и в «Скинах» была видна грудь, как в игре).
// Берутся из той сборки с модом, в которую играли последней; без мода или без аккаунта — null (персонаж как обычно).
import { useCallback, useEffect, useState } from 'react';

export const GENDER_CHANGED = 'zorya:gender-changed';

export function useGenderLook(account) {
  const [look, setLook] = useState(null);
  const id = account?.id || null;

  const load = useCallback(() => {
    if (!id) { setLook(null); return Promise.resolve(); }
    return window.api.genderMod.look(id).then((r) => setLook(r?.ok && r.present ? { ...r.settings, uv: r.uv || undefined } : null)).catch(() => setLook(null));
  }, [id]);

  useEffect(() => {
    let alive = true;
    const run = () => { if (alive) load(); };
    run();
    window.addEventListener(GENDER_CHANGED, run);
    return () => { alive = false; window.removeEventListener(GENDER_CHANGED, run); };
  }, [load]);

  return look;
}
