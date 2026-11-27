// Human-readable labels + progress for the launch pipeline (the objects the
// main process sends as 'launch:progress').
const STAGE_LABELS = {
  preparing: 'Preparing…',
  downloading: 'Downloading Horizon',
  extracting: 'Unpacking Horizon (first time takes a few minutes)…',
  'version-info': 'Getting version information…',
  'loader-profile': 'Getting loader profile…',
  'resolve-libraries': 'Resolving libraries…',
  'download-java': 'Downloading Java…',
  'download-client': 'Downloading the game client…',
  'download-libraries': 'Downloading libraries…',
  'extract-natives': 'Extracting native libraries…',
  'download-assets': 'Downloading assets…',
  'horizon-check': 'Checking the Horizon instance…',
  'horizon-build': 'Downloading Horizon…',
  'horizon-unpack': 'Unpacking Horizon…',
  'horizon-resources': 'Preparing Horizon resources…',
  'horizon-java': 'Downloading Java…',
  'horizon-minecraft': 'Downloading Minecraft files…',
  'horizon-prepare': 'Preparing Horizon resources (first time — a few minutes)…',
  ready: 'Ready',
  starting: 'Starting…',
  running: 'Running',
  error: 'Error',
};

export function stageLabel(progress, instance) {
  if (!progress?.stage) return 'Work...';
  if (progress.stage === 'loader-install') {
    const name = instance?.loader === 'neoforge' ? 'NeoForge' : 'Forge';
    if (progress.step === 'download-installer') return `Downloading of installer ${name}…`;
    if (progress.step === 'install-legacy') return `Installation ${name}…`;
    return `Installation ${name} The first launch may take a few minutes...`;
  }
  const base = STAGE_LABELS[progress.stage] || progress.stage;
  // One big file (the game's client): megabytes and speed, e.g. "Customer download ... 12.4 / 39.6 MB · 3.1 MB/s"
  if (progress.bytes && progress.total > 0) {
    const mb = (n) => (n / 1048576).toFixed(1);
    const speed = progress.speed > 0 ? ` · ${mb(progress.speed)} MB/s` : '';
    return `${base} ${mb(progress.completed || 0)} / ${mb(progress.total)} MB${speed}`;
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
