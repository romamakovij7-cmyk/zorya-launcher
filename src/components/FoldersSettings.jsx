import { useCallback, useEffect, useState } from 'react';

// Settings -> «Folders»: the builds and the game files can live on another drive. The launcher moves nothing by itself: the person copies
// the old files by hand, and the line under the path says how much of the old library the chosen folder already holds.

function formatBytes(n) {
  if (n == null) return null;
  const gb = n / 1024 ** 3;
  return gb >= 100 ? `${Math.round(gb)} ГБ` : `${gb.toFixed(1)} ГБ`;
}

const SECTIONS = [
  {
    kind: 'instances',
    title: 'Folder сборок',
    desc: 'Здесь лежат сами сборки: моды, миры, настройки. Обычно это самая тяжёлая часть.',
    status: (i) => (i.total ? `В этой папке найдено сборок: ${i.found} из ${i.total}.` : 'Сборок пока нет.'),
    // a good state: nothing to copy, or everything is already there
    ok: (i) => !i.total || i.found === i.total,
  },
  {
    kind: 'game',
    title: 'Folder файлов игры',
    desc: 'Версии Minecraft, библиотеки, ассеты, автоскачанная Java и файлы Rust-сборок (Horizon). Тяжёлая, но докачиваемая часть.',
    status: (i) => (i.found ? 'В этой папке уже есть файлы игры.' : 'Folder пустая: нужные файлы скачаются при первом запуске.'),
    ok: () => true,
  },
];

export default function FoldersSettings() {
  const [data, setData] = useState(null);
  const [busyKind, setBusyKind] = useState(null);
  const [message, setMessage] = useState(null); // { kind, tone: 'error' | 'warn' | 'ok', text }

  // Never let a failure here take the whole Settings page down: the section just stays hidden.
  const load = useCallback(() => {
    try { return window.api.dataFolders.info().then((r) => r?.ok && setData(r)).catch(() => {}); } catch { return Promise.resolve(); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function choose(kind) {
    setBusyKind(kind);
    setMessage(null);
    try {
      const res = await window.api.dataFolders.choose(kind);
      if (res?.canceled) return;
      if (!res?.ok) setMessage({ kind, tone: 'error', text: res?.error || 'Failed сменить папку.' });
      else setMessage({ kind, tone: res.warning ? 'warn' : 'ok', text: res.warning || 'Folder изменена. Если там ещё нет ваших файлов, скопируйте их вручную из старой папки (лаунчер лучше закрыть на время копирования).' });
    } finally {
      setBusyKind(null);
      load();
    }
  }

  async function reset(kind) {
    setBusyKind(kind);
    setMessage(null);
    try {
      const res = await window.api.dataFolders.reset(kind);
      if (!res?.ok) setMessage({ kind, tone: 'error', text: res?.error || 'Failed сбросить папку.' });
    } finally {
      setBusyKind(null);
      load();
    }
  }

  if (!data) return null;
  return (
    <>
      <h2 className="section-heading">Folders</h2>
      {SECTIONS.map((s) => {
        const info = data[s.kind];
        if (!info) return null;
        const free = formatBytes(info.free);
        const msg = message && message.kind === s.kind ? message : null;
        return (
          <div className="settings-row folder-row" key={s.kind}>
            <div className="folder-row-info">
              <div className="settings-row-label">{s.title}</div>
              <div className="settings-row-desc">{s.desc}</div>
              <div className="folder-path" title={info.dir}>{info.dir}</div>
              <div className={`folder-note${!info.available ? ' bad' : (s.ok(info) ? '' : ' warn')}`}>
                {!info.available ? 'Folder недоступна (отключён диск?). Подключите его или выберите другую папку.' : s.status(info)}
                {free && info.available ? ` Свободно на диске: ${free}.` : ''}
              </div>
              {info.custom && info.available && !s.ok(info) && (
                <div className="folder-note warn">Скопируйте содержимое старой папки сюда вручную, иначе сборки в списке будут пустыми. Старая папка: {info.defaultDir}</div>
              )}
              {msg && <div className={`folder-note ${msg.tone === 'error' ? 'bad' : (msg.tone === 'warn' ? 'warn' : 'good')}`}>{msg.text}</div>}
            </div>
            <div className="folder-actions">
              <button className="btn" disabled={busyKind === s.kind || data.busy} onClick={() => choose(s.kind)} title={data.busy ? 'Сначала закройте запущенную игру' : undefined}>Выбрать…</button>
              <button className="btn" onClick={() => window.api.dataFolders.open(s.kind)}>Open</button>
              {info.custom && <button className="btn" disabled={busyKind === s.kind || data.busy} onClick={() => reset(s.kind)}>Reset</button>}
            </div>
          </div>
        );
      })}
      <div className="settings-row-desc" style={{ margin: '-4px 4px 4px' }}>
        Лаунчер сам ничего не переносит: сначала закройте его и копируйте файлы вручную в новую папку, потом выберите её здесь. Папку не стоит выбирать внутри OneDrive и на сетевом диске.
      </div>
    </>
  );
}
