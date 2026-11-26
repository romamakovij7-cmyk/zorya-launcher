// Rebindable keyboard shortcuts (Settings → Горячие клавиши). A binding is
// { ctrl, shift, alt, meta, code } — `code` is a KeyboardEvent.code (e.g.
// "KeyF"), which (unlike `.key`) doesn't change with the keyboard layout, so
// a binding recorded on a Cyrillic layout still matches on any other one.
export const DEFAULT_KEYBINDINGS = {
  commandPalette: {
    ctrl: true, shift: false, alt: false, meta: false, code: 'KeyF',
  },
};

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

export function matchesBinding(e, binding) {
  if (!binding || !binding.code) return false;
  return e.code === binding.code
    && e.ctrlKey === !!binding.ctrl
    && e.shiftKey === !!binding.shift
    && e.altKey === !!binding.alt
    && e.metaKey === !!binding.meta;
}

// A keydown event -> a binding, or null if it's just a modifier by itself
// (record() keeps listening until a real key comes with it).
export function captureBinding(e) {
  if (MODIFIER_CODES.has(e.code)) return null;
  return {
    ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, code: e.code,
  };
}

const CODE_LABELS = {
  Space: 'Пробел', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', Backslash: '\\',
};

function codeLabel(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F[0-9]{1,2}$/.test(code)) return code;
  return CODE_LABELS[code] || code;
}

export function formatBinding(b) {
  if (!b || !b.code) return '—';
  const parts = [];
  if (b.ctrl) parts.push('Ctrl');
  if (b.shift) parts.push('Shift');
  if (b.alt) parts.push('Alt');
  if (b.meta) parts.push(navigator.platform?.startsWith('Mac') ? 'Cmd' : 'Win');
  parts.push(codeLabel(b.code));
  return parts.join('+');
}
