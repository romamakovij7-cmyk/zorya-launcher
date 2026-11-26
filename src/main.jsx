import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/700.css';
import '@fontsource/unbounded/800.css';
import './index.css';
import './liquid-glass.css';
import './appearance.css';
import './zorya-theme.css';
import { installExitAnimations } from './utils/exitAnimations.js';

installExitAnimations();

// Apply the worm-instead-of-progress-bars choice before the first paint, so the
// loading screen already shows the right one (the real setting arrives later).
try { document.documentElement.dataset.worm = localStorage.getItem('zorya.worm') === '1' ? 'true' : 'false'; } catch { /* default look */ }

// Known Electron quirk on Windows: after a native alert()/confirm() closes,
// the window keeps looking focused but text inputs stop accepting typing
// until the window loses and regains focus. Nudge the window's focus right
// after every native dialog so inputs (e.g. the new-instance name field)
// keep working.
for (const name of ['alert', 'confirm', 'prompt']) {
  const original = window[name].bind(window);
  window[name] = (...args) => {
    const result = original(...args);
    window.api?.window?.refocus?.();
    return result;
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
