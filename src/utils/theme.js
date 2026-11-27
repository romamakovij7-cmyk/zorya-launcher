// Appearance: ready-made themes, a custom accent colour, glass transparency/blur, an own background picture and density.
// Everything ends up as CSS variables / data-* attributes on <html> (the stylesheets read them: see appearance.css).
import { ACCENT_PRESETS } from './accent.js';

export const THEMES = [
  {
    id: 'eternal', name: 'Eternal', desc: 'Earlier.', suggestAccent: 'rose', flat: false, preview: { bg: '#1A0D12', panel: '#2E141E', bar: '#6B3A47' },
  },
  {
    id: 'minimal', name: 'Minimalism', desc: 'Flat, no glass.', suggestAccent: 'rose', flat: true, preview: { bg: '#0E0E10', panel: '#1B1B1F', bar: '#34343B' },
  },
  {
    id: 'light', name: 'Bright', desc: 'Bright interface', suggestAccent: 'rose', flat: false, preview: { bg: '#F4EAEE', panel: '#FFFFFF', bar: '#D9C3CB' },
  },
  {
    id: 'amoled', name: 'AMOLED', desc: 'Clear black background', suggestAccent: 'rose', flat: false, preview: { bg: '#000000', panel: '#101012', bar: '#2A2A2E' },
  },
  {
    id: 'midnight', name: 'Dark blue.', desc: 'Night blue', suggestAccent: 'sky', flat: false, preview: { bg: '#060B18', panel: '#101A33', bar: '#2A4170' },
  },
];

export const DEFAULT_APPEARANCE = {
  theme: 'eternal', accentColor: 'rose', accentCustom: '#B85C72', glassOpacity: 50, glassBlur: 50, bgFile: null, bgDim: 50, bgBlur: 0, uiScale: 100, density: 'normal',
};

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (rgb) => `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const clamp = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback);

// The three tones the stylesheet is built on (see accent.js), or null for the stylesheet's own default.
export function accentTones(settings) {
  const id = settings?.accentColor || 'rose';
  if (id === 'custom') {
    const wine = hexToRgb(isHex(settings?.accentCustom) ? settings.accentCustom : '#B85C72');
    return { wine: rgbToHex(wine), rose: rgbToHex(mix(wine, [255, 255, 255], 0.45)), deep: rgbToHex(mix(wine, [0, 0, 0], 0.42)) };
  }
  const preset = ACCENT_PRESETS.find((p) => p.id === id);
  return !preset || preset.id === 'rose' ? null : { wine: preset.wine, rose: preset.rose, deep: preset.deep };
}

const MANAGED = [
  '--wine', '--rose', '--wine-deep', '--wine-rgb', '--rose-rgb', '--deep-rgb', '--dark-rgb', '--panel-rgb',
  '--text', '--text-dim', '--text-faint', '--ink-rgb', '--shade-rgb', '--glass-border', '--glass-shadow', '--select-panel',
  '--glass-bg', '--glass-bg-strong', '--glass-bg-soft', '--glass-k', '--blur-k',
  '--radius-lg', '--radius-md', '--radius-sm', '--radius-btn',
  '--bg-photo-url', '--bg-dim', '--bg-blur', '--bg-tint-rgb',
];

// Surfaces of each theme; `wine` is the accent as [r,g,b]. Returns CSS variables.
function paletteVars(themeId, wine, hasAccent) {
  const scale = (rgb, k, add = 0) => rgb.map((c) => Math.round(c * k + add)).join(', ');
  switch (themeId) {
    case 'amoled':
      return {
        '--dark-rgb': '0, 0, 0', '--panel-rgb': '16, 16, 18', '--select-panel': '#0A0A0B', '--glass-border': 'color-mix(in srgb, var(--wine) 28%, #000)',
      };
    case 'midnight':
      return {
        '--dark-rgb': '8, 14, 28', '--panel-rgb': '16, 26, 50', '--text': '#E8EEFA', '--text-dim': '#9FB0D0', '--text-faint': '#6C7FA3',
        '--select-panel': '#0C1426', '--glass-border': 'color-mix(in srgb, var(--wine) 34%, #070C18)',
      };
    case 'light':
      return {
        '--ink-rgb': '40, 22, 30', '--shade-rgb': '255, 255, 255', '--dark-rgb': '255, 252, 253', '--panel-rgb': '246, 236, 240',
        '--text': '#2B1920', '--text-dim': '#6B5059', '--text-faint': '#9A8289', '--select-panel': '#FFFFFF',
        '--glass-border': 'color-mix(in srgb, var(--wine) 30%, #FFFFFF)', '--glass-shadow': 'inset 0 1px 0 rgba(255,255,255,0.9), 0 12px 32px rgba(70,25,40,0.14)',
        '--bg-tint-rgb': '255, 255, 255',
      };
    case 'minimal':
      return {
        '--dark-rgb': '18, 18, 20', '--panel-rgb': '30, 30, 34', '--glass-bg': 'rgb(24, 24, 27)', '--glass-bg-strong': 'rgb(30, 30, 34)', '--glass-bg-soft': 'rgb(20, 20, 23)',
        '--glass-border': '#2D2D33', '--select-panel': '#18181B', '--radius-lg': '14px', '--radius-md': '11px', '--radius-sm': '8px', '--radius-btn': '8px',
      };
    default: // eternal: the surfaces are the accent at ~10% strength (as accent.js does)
      return hasAccent ? { '--dark-rgb': scale(wine, 0.1, 1), '--panel-rgb': scale(wine, 0.2, 1) } : {};
  }
}

// bgUrl: an object URL of the chosen picture (or null).
export function applyAppearance(settings, bgUrl) {
  const root = document.documentElement;
  for (const v of MANAGED) root.style.removeProperty(v);

  const theme = THEMES.find((t) => t.id === settings?.theme) || THEMES[0];
  const tones = accentTones(settings);
  const vars = {};
  let wine = [184, 92, 114];
  if (tones) {
    wine = hexToRgb(tones.wine);
    Object.assign(vars, {
      '--wine': tones.wine, '--rose': tones.rose, '--wine-deep': tones.deep,
      '--wine-rgb': wine.join(', '), '--rose-rgb': hexToRgb(tones.rose).join(', '), '--deep-rgb': hexToRgb(tones.deep).join(', '),
    });
  }
  Object.assign(vars, paletteVars(theme.id, wine, !!tones));

  // Glass: 50 = as designed; 0 = clear, 100 = twice as dense / blurred (flat themes have neither).
  const opacity = clamp(settings?.glassOpacity, 0, 100, 50);
  const blur = clamp(settings?.glassBlur, 0, 100, 50);
  if (!theme.flat) {
    vars['--glass-k'] = String(Math.max(0.12, opacity / 50));
    vars['--blur-k'] = String(blur / 50);
  }

  if (bgUrl) {
    vars['--bg-photo-url'] = `url("${bgUrl}")`;
    vars['--bg-dim'] = String(clamp(settings?.bgDim, 0, 100, 50) / 100);
    vars['--bg-blur'] = `${clamp(settings?.bgBlur, 0, 30, 0)}px`;
  }

  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = theme.id === 'light' ? 'light' : 'dark';
  root.dataset.theme = theme.id;
  root.dataset.flat = theme.flat ? 'true' : 'false';
  root.dataset.bg = bgUrl ? 'image' : 'none';
  root.dataset.density = ['compact', 'roomy'].includes(settings?.density) ? settings.density : 'normal';
}

export const uiZoomFactor = (settings) => clamp(settings?.uiScale, 80, 130, 100) / 100;
