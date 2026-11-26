export const MEM_STEP = 256;
export const MEM_FLOOR = 512;

// Same 75% ceiling the presets and the crash panel's "add memory" already
// use — giving Java the whole machine's RAM leaves Windows nothing to work
// with and the game gets swapped out or killed instead of running faster.
export function memoryCap(totalMb) {
  return Math.max(4096, Math.floor((totalMb * 0.75) / MEM_STEP) * MEM_STEP);
}

export function formatMb(mb) {
  if (!mb) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} ГБ` : `${mb} МБ`;
}
