// Accent colour presets. Each gives the three tones the stylesheet is built
// on: `wine` (main accent), `rose` (its light partner in gradients/text) and
// `deep` (a dark shade). The default preset sets nothing, so the stylesheet's
// own colours — which differ slightly between the classic and glass styles —
// stay untouched.
export const ACCENT_PRESETS = [
  { id: 'rose', name: 'Роза', wine: '#B85C72', rose: '#E39AA9', deep: '#7A3C4C' },
  { id: 'sky', name: 'Небо', wine: '#3F7FD9', rose: '#8DBDFF', deep: '#274F8F' },
  { id: 'mint', name: 'Мята', wine: '#3E9B78', rose: '#8FE0BC', deep: '#22624B' },
  { id: 'lilac', name: 'Сирень', wine: '#8B63C9', rose: '#C7A8F5', deep: '#5A3C8C' },
  { id: 'peach', name: 'Персик', wine: '#D1704A', rose: '#F6B08A', deep: '#8F4529' },
  { id: 'aqua', name: 'Бирюза', wine: '#2E9AA8', rose: '#7FD8E4', deep: '#1B6470' },
];

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const VARS = ['--wine', '--rose', '--wine-deep', '--wine-rgb', '--rose-rgb', '--deep-rgb', '--dark-rgb', '--panel-rgb'];

export function applyAccent(id) {
  const root = document.documentElement;
  const preset = ACCENT_PRESETS.find((p) => p.id === id);
  if (!preset || preset.id === 'rose') {
    for (const v of VARS) root.style.removeProperty(v);
    return;
  }
  const wine = hexToRgb(preset.wine);
  const rose = hexToRgb(preset.rose);
  const deep = hexToRgb(preset.deep);
  // Dark surfaces are the accent at ~10% strength, which is how the original
  // burgundy darks relate to the burgundy accent.
  const scale = (rgb, k, add = 0) => rgb.map((c) => Math.round(c * k + add)).join(', ');
  root.style.setProperty('--wine', preset.wine);
  root.style.setProperty('--rose', preset.rose);
  root.style.setProperty('--wine-deep', preset.deep);
  root.style.setProperty('--wine-rgb', wine.join(', '));
  root.style.setProperty('--rose-rgb', rose.join(', '));
  root.style.setProperty('--deep-rgb', deep.join(', '));
  root.style.setProperty('--dark-rgb', scale(wine, 0.1, 1));
  root.style.setProperty('--panel-rgb', scale(wine, 0.2, 1));
}
