// React unmounts a closed modal/menu instantly, so it just vanishes. Instead
// of threading an "exiting" state through every component, watch for these
// overlays being removed and leave a non-interactive clone behind that plays
// the closing animation (see ".is-exiting" in index.css) and then deletes
// itself.
const EXIT_SELECTOR = [
  '.modal-overlay', '.shot-editor-overlay', '.lightbox-overlay', '.cmdk-overlay',
  '.library-selection-bar', '.tile-context-menu', '.library-move-menu', '.recent-play-menu', '.log-source-menu',
  '.running-popover', '.sel-pop',
].join(',');
const EXIT_MS = 170;

export function installExitAnimations() {
  if (typeof MutationObserver === 'undefined') return;
  const observer = new MutationObserver((mutations) => {
    if (document.documentElement.dataset.reduceMotion === 'true') return;
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (!(node instanceof HTMLElement) || !node.matches(EXIT_SELECTOR) || node.classList.contains('is-exiting')) continue;
        // Always on <body>, never inside a React-managed container.
        const parent = document.body;
        const ghost = node.cloneNode(true);
        ghost.classList.add('is-exiting');
        ghost.setAttribute('aria-hidden', 'true');
        // A ghost of an input/textarea would otherwise grab focus or typing.
        ghost.querySelectorAll('input,textarea,select,button').forEach((el) => { el.tabIndex = -1; el.disabled = true; });
        parent.appendChild(ghost);
        setTimeout(() => ghost.remove(), EXIT_MS + 30);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
