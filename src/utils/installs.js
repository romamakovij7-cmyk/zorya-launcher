// Helpers for background modpack installs and imports (see App.jsx:
// startModpackInstall, startPackFileImport, startLauncherImport).
// An install is { id, key, title, icon, stage, completed, total,
//   status: 'running' | 'paused' | 'cancelling' | 'error', error }.
//
// Stages, in the order a run goes through them:
//   queued          waiting for an earlier import to finish
//   download-pack   fetching the .mrpack / .zip           (completed/total = bytes)
//   extract-overrides  unpacking the pack's own files     (completed/total = files)
//   download-files  fetching the mods the pack lists       (completed/total = files)
//   scan, copy-files  importing from another launcher     (scan = files found; copy = bytes)

import { formatBytes } from './formatBytes.js';

// Still occupying a slot (running, paused or being cancelled).
export const isActiveInstall = (i) => i.status !== 'error';

const frac = (i) => (i.total ? Math.min(1, (i.completed || 0) / i.total) : 0);

// 0-100, or null while the size isn't known yet. Each stage owns a slice of
// the bar so it only ever moves forward.
export function installPercent(i) {
  if (i.stage === 'download-pack') return i.total ? Math.min(5, Math.round(5 * frac(i))) : null;
  if (i.stage === 'extract-overrides') return i.total ? Math.round(5 + 15 * frac(i)) : 5;
  if (i.stage === 'download-files') return i.total ? Math.min(99, Math.round(20 + 79 * frac(i))) : null;
  if (i.stage === 'copy-files') return i.total ? Math.min(99, Math.round(4 + 95 * frac(i))) : 4;
  return null; // queued, scan and anything unknown: show the moving "working" bar
}

export function installLabel(i) {
  if (i.status === 'error') return 'Failed скачать';
  if (i.status === 'cancelling') return 'Cancel…';
  let base;
  switch (i.stage) {
    case 'queued': base = 'В очереди…'; break;
    case 'download-pack': base = 'Скачиваем сборку…'; break;
    case 'extract-overrides': base = i.total ? `Распаковываем ${i.completed || 0}/${i.total}` : 'Распаковываем…'; break;
    case 'download-files': base = i.total ? `Скачиваем файлы ${i.completed || 0}/${i.total}` : 'Скачиваем файлы…'; break;
    case 'scan': base = i.completed ? `Считаем файлы… ${i.completed}` : 'Считаем файлы…'; break;
    case 'copy-files': base = i.total ? `Копируем ${formatBytes(i.completed || 0)} из ${formatBytes(i.total)}` : 'Копируем файлы…'; break;
    default: base = 'Подготовка…';
  }
  return i.status === 'paused' ? `Пауза · ${base.replace('…', '')}` : base;
}
