// Human-readable labels + progress for the launch pipeline (the objects the
// main process sends as 'launch:progress').
const STAGE_LABELS = {
  preparing: 'Preparation…',
  'version-info': 'Getting version information...',
  'loader-profile': 'Getting the bootloader profile...',
  'resolve-libraries': 'Analysis of libraries...',
  'download-java': 'Selection of Java for this version...',
  'download-client': 'Loading client...',
  'download-libraries': 'Loading libraries…',
  'extract-natives': 'Unpacking native libraries...',
  'download-assets': 'Loading resources…',
  'horizon-check': 'Checking out the new Horizon build...',
  'horizon-build': 'Loading Horizon, MB',
  'horizon-unpack': 'Unboxing Horizon...',
  'horizon-resources': 'Checking Horizon Resources...',
  'horizon-java': 'Loading Java…',
  'horizon-minecraft': 'Loading Minecraft files...',
  'horizon-prepare': 'Preparing Horizon resources (first time – a few minutes)…',
  ready: 'Done',
  starting: 'Launch Java…',
  running: 'Launched',
  error: 'Error',
};

export function stageLabel(progress, instance) {
  if (!progress?.stage) return 'Job…';
  if (progress.stage === 'loader-install') {
    const name = instance?.loader === 'neoforge' ? 'NeoForge' : 'Forge';
    if (progress.step === 'download-installer') return `Скачивание установщика ${name}…`;
    if (progress.step === 'install-legacy') return `Установка ${name}…`;
    return `Установка ${name} — первый запуск, это может занять несколько минут…`;
  }
  const base = STAGE_LABELS[progress.stage] || progress.stage;
  // One big file (the game's client): megabytes and speed, e.g. "Loading client... 12.4 / 39.6 MB · 3.1 MB/s"
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
