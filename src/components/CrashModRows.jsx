// Mods, названные разбором падения: чего не хватает, что надо обновить, кто виноват. У каждого — своя кнопка действия
// (установить / обновить / отключить), а если их несколько — ещё «Сделать всё». Search и скачивание идут через Modrinth (electron/mc/modfix.js).
import { useEffect, useMemo, useState } from 'react';
import { BoxIcon } from './Icons.jsx';

const rangeRu = (r) => {
  const t = String(r || '');
  const b = /between\s+(\d[\d.]*)-?\s*(?:\((?:in|ex)clusive\))?\s+and\s+(\d[\d.]*)/i.exec(t);
  if (b) return b[1] === b[2] ? `ровно ${b[1]}` : `от ${b[1]} до ${b[2]}`;
  return t.replace(/\bor later\b/gi, 'or newer').replace(/\bor earlier\b/gi, 'or older').replace(/\bor above\b/gi, 'or newer');
};
const clean = (e) => String(e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export default function CrashModRows({ instance, mods, onFindMods, onModsChanged }) {
  const [rows, setRows] = useState(null); // null = ищем; [] = нечего показывать
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // индекс строки → true
  const [done, setDone] = useState({}); // индекс → текст результата
  const [bulk, setBulk] = useState(false);

  const key = useMemo(() => JSON.stringify(mods), [mods]);
  useEffect(() => {
    let alive = true;
    setRows(null); setError(null); setDone({}); setBusy({});
    window.api.instances.resolveCrashMods(instance.id, mods).then((r) => {
      if (!alive) return;
      if (r?.ok) setRows(r.rows); else { setError(clean(r?.error) || 'Failed check mods'); setRows([]); }
    }).catch((e) => { if (alive) { setError(clean(e.message)); setRows([]); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id, key]);

  const mark = (i, text) => setDone((p) => ({ ...p, [i]: text }));

  async function act(i, what) {
    const row = rows[i];
    setBusy((p) => ({ ...p, [i]: true }));
    try {
      if (what === 'disable' || what === 'enable') {
        const filename = row.installed?.filename;
        const r = await window.api.content.toggle(instance.id, filename, 'mod');
        if (!r?.ok) throw new Error(r?.error || 'It didn\'t work out');
        // имя файла меняется (.disabled), запоминаем новое, чтобы можно было вернуть
        setRows((p) => p.map((x, k) => (k === i ? { ...x, installed: { ...x.installed, filename: r.filename, enabled: what === 'enable' } } : x)));
        mark(i, what === 'disable' ? 'Disabled' : 'Enabled');
      } else {
        const r = await window.api.instances.applyModFix(instance.id, {
          action: what, versionId: row.candidate.versionId, filename: row.installed?.filename,
        });
        if (!r?.ok) throw new Error(r?.error || 'It didn\'t work out');
        const extra = r.deps?.installed?.length ? ` · вместе с ним: ${r.deps.installed.map((d) => d.title).join(', ')}` : '';
        mark(i, `${what === 'install' ? 'Installed' : 'Updated'}: ${r.filename}${extra}`);
      }
      onModsChanged?.();
    } catch (e) {
      mark(i, `Не получилось: ${clean(e.message)}`);
    } finally {
      setBusy((p) => ({ ...p, [i]: false }));
    }
  }

  const actionable = (rows || []).map((r, i) => ({ r, i })).filter(({ r, i }) => !done[i] && r.state === 'ready' && r.candidate && (r.need.kind === 'install' || r.need.kind === 'update'));

  async function doAll() {
    setBulk(true);
    for (const { r, i } of actionable) {
      // eslint-disable-next-line no-await-in-loop
      await act(i, r.need.kind === 'install' ? 'install' : 'update');
    }
    setBulk(false);
  }

  if (rows === null) return <div className="crash-mods-wait">Ищу эти моды на Modrinth…</div>;
  if (!rows.length) return error ? <div className="crash-mods-wait">{error}</div> : null;

  return (
    <div className="crash-mods">
      {rows.map((r, i) => {
        const c = r.candidate;
        const name = c?.title || r.need.name || r.need.modId || r.need.filename;
        const inst = r.installed;
        let sub;
        let buttons = null;
        if (r.need.kind === 'install') {
          if (r.state === 'ready') sub = <>Не установлен{r.need.requestedBy.length ? ` · нужен для: ${r.need.requestedBy.slice(0, 3).join(', ')}` : ''}<b> · будет {c.versionNumber}</b></>;
          else if (r.state === 'disabled') sub = 'Installed but disabled';
          else if (r.state === 'present') sub = 'Already installed';
          else sub = 'Not found on Modrinth for this game version and loader';
        } else if (r.need.kind === 'update') {
          const stands = inst?.versionNumber || r.need.present || 'unknown version';
          const wants = r.need.range ? rangeRu(r.need.range) : '';
          const by = r.need.requestedBy.length ? r.need.requestedBy.slice(0, 2).join(', ') : '';
          if (r.need.why === 'game') {
            const base = `Автор ограничил мод игрой ${rangeRu(r.need.gameNeeds)}, а у вас ${r.need.gamePresent || 'another version'}.`;
            sub = r.state === 'ready' ? <>{base}<b> · есть версия под вашу игру: {c.versionNumber}</b></> : `${base} Версии под вашу игру нет — лучше отключить мод.`;
          } else if (r.state === 'ready') {
            sub = r.downgrade
              ? <>Стоит {stands} — {by ? `${by} с ней не работает` : 'doesn\'t fit'} (нужна {wants || 'other'}).<b> Подойдёт {c.versionNumber}: нужно поставить более старую.</b></>
              : <>Стоит {stands}<b> · доступна {c.versionNumber}</b>{wants ? ` · нужна: ${wants}` : ''}</>;
          } else if (r.state === 'no-match') {
            sub = `${by ? `${by} требует` : 'Required'} версию ${wants || 'another'}, а на Modrinth для вашей игры такой нет${r.latest ? ` (самая свежая: ${r.latest})` : ''}. Обновите тот мод, которому она нужна, или отключите его.`;
          } else if (r.state === 'same') sub = `Это самая новая версия (${c.versionNumber}) для вашей игры, обновлять нечего. Проблема в связке с другим модом${by ? `: ${by}` : ''}${wants ? `, ему нужна ${wants}` : ''}.`;
          else if (!inst) sub = 'This mod was not found among installed files';
          else sub = 'No newer version of the game was found on Modrinth';
        } else if (!inst) {
          sub = 'Failed match to a file in the mods folder';
        } else {
          sub = <>{inst.filename}{inst.versionNumber ? ` · ${inst.versionNumber}` : ''}{r.state === 'ready'? <b> · there is an update {c.versionNumber}</b> :''}</>;
        }

        if (!done[i]) {
          const b = [];
          if (r.state === 'ready' && c && r.need.kind === 'install') b.push(<button key="i" className="btn btn-primary" disabled={busy[i] || bulk} onClick={() => act(i, 'install')}>Установить</button>);
          if (r.state === 'ready' && c && r.need.kind !== 'install' && inst) b.push(<button key="u" className="btn btn-primary" disabled={busy[i] || bulk} onClick={() => act(i, 'update')}>{r.downgrade ? 'Put' + c.versionNumber : 'Refresh'}</button>);
          if (r.state === 'disabled' && inst) b.push(<button key="e" className="btn btn-primary" disabled={busy[i]} onClick={() => act(i, 'enable')}>Enable</button>);
          if (r.need.kind === 'suspect' && inst && inst.enabled) b.push(<button key="d" className="btn" disabled={busy[i] || bulk} onClick={() => act(i, 'disable')}>Отключить</button>);
          if (r.need.kind === 'update' && inst && inst.enabled && r.state !== 'ready') b.push(<button key="d2" className="btn" disabled={busy[i]} onClick={() => act(i, 'disable')}>Отключить</button>);
          if (r.state === 'notfound' || r.state === 'error') b.push(<button key="f" className="btn" onClick={() => onFindMods?.(name)}>Искать вручную</button>);
          buttons = b;
        }

        return (
          <div className="crash-mod-row" key={`${r.need.kind}:${r.need.modId}:${r.need.filename}:${i}`}>
            <span className="crash-mod-icon">{c?.icon ? <img src={c.icon} alt="" /> : <BoxIcon width={20} height={20} />}</span>
            <span className="crash-mod-body">
              <span className="crash-mod-name">{name}</span>
              <span className="crash-mod-sub">{done[i] ? done[i] : sub}</span>
            </span>
            <span className="crash-mod-actions">{buttons}</span>
          </div>
        );
      })}
      {actionable.length > 1 && (
        <button className="btn btn-primary crash-mods-all" disabled={bulk} onClick={doAll}>
          {bulk ? 'Working…' : `Сделать всё (${actionable.length})`}
        </button>
      )}
      {Object.keys(done).length > 0 && <div className="crash-mods-hint">Done. Запустите сборку снова — если error осталась, она покажется здесь заново.</div>}
    </div>
  );
}
