// Human-readable labels + progress for the launch pipeline (the objects the
// main process sends as 'launch:progress').
const STAGE_LABELS = {
  preparing: 'Подготовка…',
  'version-info': 'Получение информации о версии…',
  'loader-profile': 'Получение профиля загрузчика…',
  'resolve-libraries': 'Разбор библиотек…',
  'download-java': 'Подбор Java для этой версии…',
  'download-client': 'Loading клиента…',
  'download-libraries': 'Loading библиотек…',
  'extract-natives': 'Распаковка нативных библиотек…',
  'download-assets': 'Loading ресурсов…',
  'horizon-check': 'Проверка новой сборки Horizon…',
  'horizon-build': 'Loading Horizon, МБ',
  'horizon-unpack': 'Распаковка Horizon…',
  'horizon-resources': 'Проверка ресурсов Horizon…',
  'horizon-java': 'Loading Java…',
  'horizon-minecraft': 'Loading файлов Minecraft…',
  'horizon-prepare': 'Подготовка ресурсов Horizon (первый раз — несколько минут)…',
  ready: 'Done',
  starting: 'Launch Java…',
  running: 'Запущено',
  error: 'Error',
};

export function stageLabel(progress, instance) {
  if (!progress?.stage) return 'Работа…';
  if (progress.stage === 'loader-install') {
    const name = instance?.loader === 'neoforge' ? 'NeoForge' : 'Forge';
    if (progress.step === 'download-installer') return `Скачивание установщика ${name}…`;
    if (progress.step === 'install-legacy') return `Установка ${name}…`;
    return `Установка ${name} — первый запуск, это может занять несколько минут…`;
  }
  const base = STAGE_LABELS[progress.stage] || progress.stage;
  // One big file (the game's client): megabytes and speed, e.g. "Loading клиента… 12,4 / 39,6 МБ · 3,1 МБ/с"
  if (progress.bytes && progress.total > 0) {
    const mb = (n) => (n / 1048576).toFixed(1).replace('.', ',');
    const speed = progress.speed > 0 ? ` · ${mb(progress.speed)} МБ/с` : '';
    return `${base} ${mb(progress.completed || 0)} / ${mb(progress.total)} МБ${speed}`;
  }
  if (progress.total > 1 && progress.completed != null) return `${base} ${progress.completed} / ${progress.total}`;
  return base;
}

// 0..100 when the current step reports real numbers, otherwise null (the UI
// then shows an animated "working…" bar instead).
export function stagePercent(progress) {
  if (progress?.total > 0 && progress.completed != null) {
    return Math.min(100, (progress.completed / progress.total) * 100);
  }
  return null;
}
