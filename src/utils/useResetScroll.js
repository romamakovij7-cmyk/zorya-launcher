import { useLayoutEffect } from 'react';

// Scrolls back to the top of the page (and of any side filter panel inside
// `ref`) whenever `deps` change — for result lists that swap their content
// (another platform, project type, page, search…), where the old scroll
// position means nothing for the new list.
export function useResetScroll(ref, deps) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const page = root.closest('.main-content');
    if (page) page.scrollTop = 0;
    root.querySelectorAll('.fp-sidebar').forEach((el) => { el.scrollTop = 0; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
