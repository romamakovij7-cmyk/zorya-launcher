import { useCallback, useEffect, useState } from 'react';
import Select from './Select.jsx';
import { GAME_LANGS } from '../utils/gameLangs.js';

// Settings -> «Game settings»: the "reference" of game settings that new builds get at their first launch (see electron/mc/masterOptions.js).
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
  const when = m.source?.at ? new Date(m.source.at).toLocaleDateString('ru-RU') : '';
  return (
    <>
      <h2 className="section-heading">Game settings</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Применять к новым сборкам</div>
          <div className="settings-row-desc">
            Новые сборки при первом запуске сами получат язык и ваши настройки игры (звук, дальность, клавиши, графику).
            Уже готовые сборки не меняются: чтобы применить эталон к такой сборке, запустите её один раз, выйдите из игры и нажмите «Apply эталон» в настройках сборки (шестерёнка).
          </div>
        </div>
        <input type="checkbox" className="switch" checked={m.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Language игры в новых сборках</div>
          <div className="settings-row-desc">Game по умолчанию запускается на английском. Выберите язык, и он сразу будет нужным.</div>
        </div>
        <div style={{ width: 260 }}>
          <Select value={m.lang || ''} onChange={(v) => patch({ lang: v })} options={GAME_LANGS} />
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Эталон настроек</div>
          <div className="settings-row-desc">
            {m.hasTemplate
              ? `Запомнено ${m.count} параметров из сборки «${m.source?.name || '?'}»${m.source?.mcVersion ? ` (${m.source.mcVersion})` : ''}${when ? `, ${when}` : ''}. Keybinds и поле зрения переносятся только между сборками одного поколения игры (до 1.13 и новее).`
              : 'Не задан. Как задать: 1) запустите любую свою сборку, настройте игру как вам нравится и выйдите из игры; 2) откройте настройки этой сборки (шестерёнка) и нажмите «Запомнить настройки игры».'}
          </div>
        </div>
        {m.hasTemplate && <button className="btn" onClick={forget}>Забыть эталон</button>}
      </div>
    </>
  );
}
