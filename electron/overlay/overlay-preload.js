// The overlay window can listen to the main process and tell it how big the panel is; nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onMetrics: (cb) => { ipcRenderer.on('overlay:metrics', (_e, m) => cb(m)); },
  onConfig: (cb) => { ipcRenderer.on('overlay:config', (_e, c) => cb(c)); },
  reportSize: (w, h) => { ipcRenderer.send('overlay:size', { w, h }); },
});