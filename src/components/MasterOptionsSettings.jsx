import { useCallback, useEffect, useState } from 'react';
import Select from './Select.jsx';
import { GAME_LANGS } from '../utils/gameLangs.js';

// Settings -> «Game settings»: the "эталон" of game settings that new builds get at their first launch (see electron/mc/masterOptions.js).
export default function MasterOptionsSettings() {
  const [m, setM] = useState(null);
  const load = useCallback(() => {
    try { return window.api.masterOptions.get().then((r) => r?.ok && setM(r)).catch(() => {}); } catch { return Promise.resolve(); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function patch(p) {
    const r = await window.api.masterOptions.set(p);
    if (r?.ok) setM((prev) => ({ ...prev, ...r }));
  }
  async function forget() {
    const r = await window.api.masterOptions.clear();
    if (r?.ok) setM((prev) => ({ ...prev, ...r }));
  }

  if (!m) return null;
  const when = m.source?.at ? new Date(m.source.at).toLocaleDateString('en-US') : '';
  return (
    <>
      <h2 className="section-heading">Game settings</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Apply to new instances</div>
          <div className="settings-row-desc">
            New builds at the first start will receive the language and your game settings (sound, range, keys, graphics).
            Already ready-made builds do not change: to apply a benchmark to such an assembly, run it once, exit the game and press.«Apply the standard» in the settings of the assembly (cog).
          </div>
        </div>
        <input type="checkbox" className="switch" checked={m.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Language of the game in new instances</div>
          <div className="settings-row-desc">The game is launched by default in English. Choose a language and it will be needed immediately.</div>
        </div>
        <div style={{ width: 260 }}>
          <Select value={m.lang || ''} onChange={(v) => patch({ lang: v })} options={GAME_LANGS} />
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Standard settings</div>
          <div className="settings-row-desc">
            {m.hasTemplate
              ? `Saved ${m.count} instance parameters “$“{m.source?.name || '?'}»${m.source?.mcVersion ? ` (${m.source.mcVersion})` : ''}${when ? `, ${when}` : ''}. Keys and field of view are transferred only between builds of the same generation of the game (to 1.13 and later).`
              : 'Not given. How to ask: 1) launch any of your build, configure the game as you like and exit the game; 2) fromCover the settings of this assembly (cog) and press «Remember the game settings».'}
          </div>
        </div>
        {m.hasTemplate && <button className="btn" onClick={forget}>Forget the standard</button>}
      </div>
    </>
  );
}
