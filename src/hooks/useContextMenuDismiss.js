import { useEffect, useRef } from 'react';

// Closes an open right-click context menu when the user interacts outside
// it — including right-clicking a *different* element, which needs to
// close this menu and still let that element's own contextmenu handler
// open its own menu in the same gesture. The previous approach (a
// full-screen backdrop div that called stopPropagation() on contextmenu)
// ate that second click instead, so opening a menu while another was
// already open took two right-clicks — and the overlapping backdrops'
// z-index also caused a visible flicker between tiles.
export function useContextMenuDismiss(open, onDismiss) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onDismiss();
    }
    // Capture phase: runs before the newly-clicked element's own handlers,
    // so this menu is already gone by the time that element's contextmenu
    // handler opens its own.
    document.addEventListener('mousedown', handleOutside, true);
    document.addEventListener('contextmenu', handleOutside, true);
    document.addEventListener('scroll', onDismiss, true);
    window.addEventListener('blur', onDismiss);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
      document.removeEventListener('contextmenu', handleOutside, true);
      document.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('blur', onDismiss);
    };
  }, [open, onDismiss]);

  return ref;
}

// Keeps a fixed-position menu from rendering off the right/bottom edge of
// the window. Menu height varies with content, so it's an estimate rather
// than an exact post-render measurement — good enough to avoid the worst
// off-screen cases without an extra layout pass.
export function clampMenuPos(x, y, { width = 210, height = 260 } = {}) {
  const maxX = Math.max(8, window.innerWidth - width - 8);
  const maxY = Math.max(8, window.innerHeight - height - 8);
  return { x: Math.min(x, maxX), y: Math.min(y, maxY) };
}
