import { useCallback, useEffect, useMemo, useState } from 'react';

export const ORDER_RESET_EVENT = 'zorya:order-reset';

// Saved order first (ignoring ids that no longer exist), then any ids the
// saved list doesn't know yet — so new tabs always show up.
function mergeOrder(saved, ids) {
  const known = saved.filter((id, i) => ids.includes(id) && saved.indexOf(id) === i);
  return [...known, ...ids.filter((id) => !known.includes(id))];
}

// A user-arrangeable order of `ids`, kept in settings under `settingKey`, plus
// the drag & drop handlers to rearrange it:
//   const { order, itemProps } = useOrder('sidebarOrder', ['home', ...]);
//   order.map((id) => <button {...itemProps(id)} />)
export function useOrder(settingKey, ids) {
  const [saved, setSaved] = useState([]);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  useEffect(() => {
    let alive = true;
    window.api.settings.get().then((s) => {
      if (alive && Array.isArray(s?.[settingKey])) setSaved(s[settingKey]);
    });
    const reset = () => setSaved([]);
    window.addEventListener(ORDER_RESET_EVENT, reset);
    return () => { alive = false; window.removeEventListener(ORDER_RESET_EVENT, reset); };
  }, [settingKey]);

  const key = ids.join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const order = useMemo(() => mergeOrder(saved, ids), [saved, key]);

  const move = useCallback((from, to) => {
    if (from === to) return;
    const next = order.filter((id) => id !== from);
    next.splice(order.indexOf(to), 0, from); // the dragged item takes the target's slot
    setSaved(next);
    window.api.settings.set({ [settingKey]: next });
  }, [order, settingKey]);

  const itemProps = (id) => ({
    draggable: true,
    onDragStart: (e) => {
      setDragId(id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    },
    onDragOver: (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (overId !== id) setOverId(id);
    },
    onDragLeave: () => { if (overId === id) setOverId(null); },
    onDrop: (e) => {
      e.preventDefault();
      if (dragId) move(dragId, id);
      setDragId(null);
      setOverId(null);
    },
    onDragEnd: () => { setDragId(null); setOverId(null); },
    'data-reorder': dragId === id ? 'dragging' : (dragId && overId === id && dragId !== id ? 'over' : undefined),
  });

  return { order, itemProps };
}
