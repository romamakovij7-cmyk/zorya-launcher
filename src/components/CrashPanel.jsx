import { useState } from 'react';
import { AlertIcon, CloseIcon, CopyIcon } from './Icons.jsx';
import CrashModRows from './CrashModRows.jsx';

const ACTION_LABELS = {
  resetJava: 'Reset путь к Java',
  repair: 'Repair файлы сборки',
  moreMemory: 'Add 2 ГБ памяти',
  lessMemory: 'Уменьшить память на 2 ГБ',
  findMods: 'Найти моды',
  updateLoader: 'Refresh загрузчик',
  clearJvmArgs: 'Убрать этот аргумент',
  openLog: 'Open консоль',
};

// Shown on the instance page after the game exits with an error: what
// probably went wrong, in plain language, with a one-click fix where one
// exists.
export default function CrashPanel({
  instance, crash, onDismiss, onInstanceChanged, onFindMods, onModsChanged, onOpenLog,
}) {
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(null);
  const [copied, setCopied] = useState(false);

  function setResult(id, text) {
    setResults((prev) => ({ ...prev, [id]: text }));
  }

  async function runAction(finding) {
    const { id, action } = finding;
    if (action === 'findMods') { onFindMods?.(); return; }
    if (action === 'openLog') { onOpenLog?.(); return; }
    setBusy(id);
    try {
      if (action === 'resetJava') {
        await window.api.settings.set({ javaPath: '' });
        setResult(id, 'Done — при следующем запуске лаунчер подберёт Java сам.');
      } else if (action === 'repair') {
        const res = await window.api.instances.repair(instance.id);
        setResult(id, res.ok ? 'Files восстановлены — попробуйте запустить снова.' : `Не получилось: ${res.error}`);
      } else if (action === 'updateLoader') {
        const list = instance.loader === 'quilt'
          ? await window.api.mc.quiltLoaders(instance.mcVersion)
          : await window.api.mc.fabricLoaders(instance.mcVersion);
        // Lists come newest-first; prefer the newest stable build.
        const best = (list || []).find((l) => l.stable) || (list || [])[0];
        if (!best) {
          setResult(id, 'Failed получить список версий загрузчика.');
        } else if (best.loaderVersion === instance.loaderVersion) {
          setResult(id, `Уже стоит самая новая стабильная версия (${best.loaderVersion}). Возможно, для этой игры она пока не поддерживается.`);
        } else {
          const res = await window.api.instances.updateInstall(instance.id, {
            mcVersion: instance.mcVersion, loader: instance.loader, loaderVersion: best.loaderVersion,
          });
          if (res.ok) {
            onInstanceChanged?.(res.instance);
            setResult(id, `Done — загрузчик обновлён до ${best.loaderVersion}. Запустите сборку снова.`);
          } else {
            setResult(id, `Не получилось: ${res.error}`);
          }
        }
      } else if (action === 'clearJvmArgs') {
        // убираем только виновный аргумент (или все сборщики мусора, если их включено два) — и у сборки, и в общих настройках
        const opt = finding.option ? finding.option.toLowerCase() : null;
        const strip = (s) => String(s || '').split(/\s+/).filter(Boolean).filter((tok) => (opt ? !tok.toLowerCase().includes(opt) : !/^-XX:\+Use\w*GC$/.test(tok))).join(' ');
        const settings = await window.api.settings.get();
        const instNext = strip(instance.javaArgs);
        const globalNext = strip(settings.javaArgs);
        const res = await window.api.instances.updateJava(instance.id, { javaPath: instance.javaPath || '', javaArgs: instNext });
        if (settings.javaArgs !== globalNext) await window.api.settings.set({ javaArgs: globalNext });
        if (res.ok) onInstanceChanged?.(res.instance);
        setResult(id, 'Done — аргумент убран. Запустите сборку снова.');
      } else if (action === 'moreMemory' || action === 'lessMemory') {
        const settings = await window.api.settings.get();
        const totalMb = await window.api.system.totalMemoryMb();
        const current = instance.maxMemoryMb || settings.maxMemoryMb || 4096;
        const next = action === 'moreMemory'
          ? Math.min(current + 2048, Math.floor((totalMb * 0.75) / 512) * 512)
          : Math.max(current - 2048, 1024);
        if (next === current) {
          setResult(id, action === 'moreMemory' ? 'Больше выделить нельзя — не хватит памяти системе.' : 'Уже минимум.');
        } else {
          const res = await window.api.instances.updateMemory(instance.id, {
            minMemoryMb: instance.minMemoryMb || null,
            maxMemoryMb: next,
          });
          if (res.ok) {
            onInstanceChanged?.(res.instance);
            setResult(id, `Done — теперь ${(next / 1024).toFixed(next % 1024 ? 1 : 0)} ГБ.`);
          } else {
            setResult(id, `Не получилось: ${res.error}`);
          }
        }
      }
    } catch (err) {
      setResult(id, `Не получилось: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function copyText() {
    const text = [
      `Instance: ${instance.name} (${instance.loader} ${instance.mcVersion}), код выхода ${crash.exitCode}`,
      ...crash.findings.map((f) => `• ${f.title}\n${f.detail}`),
    ].join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="crash-panel">
      <div className="crash-panel-head">
        <AlertIcon width={20} height={20} />
        <strong>Game закрылась с ошибкой</strong>
        <span className="crash-panel-code">код {crash.exitCode}</span>
        <div className="crash-panel-head-actions">
          <button className="btn-text" onClick={copyText}>
            <CopyIcon width={14} height={14} /> {copied ? 'Скопировано' : 'Copy'}
          </button>
          {crash.reportPath && (
            <button className="btn-text" onClick={() => window.api.instances.openCrashReport(instance.id)}>
              Краш-репорт
            </button>
          )}
          <button className="icon-btn" title="Close" onClick={onDismiss}><CloseIcon /></button>
        </div>
      </div>

      {crash.findings.map((f) => (
        <div className="crash-finding" key={f.id}>
          <div className="crash-finding-title">{f.title}</div>
          <div className="crash-finding-detail">{f.detail}</div>
          {f.mods?.length > 0 && (
            <CrashModRows instance={instance} mods={f.mods} onFindMods={() => onFindMods?.()} onModsChanged={onModsChanged} />
          )}
          {f.action && !(f.mods?.length > 0 && f.action === 'findMods') && (
            <div className="crash-finding-actions">
              <button className="btn btn-primary" disabled={busy === f.id} onClick={() => runAction(f)}>
                {busy === f.id ? 'Подождите…' : ACTION_LABELS[f.action]}
              </button>
              {results[f.id] && <span className="crash-finding-result">{results[f.id]}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
