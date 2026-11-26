const { app, BrowserWindow } = require('electron');
const path = require('path');
const registerIpc = require('./electron/ipc');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  registerIpc(win);

  win.webContents.on('console-message', (e, level, message) => {
    console.log('[renderer]', message);
  });

  await win.loadURL(`data:text/html,<html><body>test</body></html>`);

  async function run(label, fn) {
    console.log(`\n=== ${label} ===`);
    try {
      const result = await win.webContents.executeJavaScript(fn);
      console.log('OK:', JSON.stringify(result));
      return result;
    } catch (err) {
      console.log('THROW:', err.message);
      return null;
    }
  }

  await run('offline login', `window.api.auth.loginOffline('TestPlayer')`);

  const created = await run('create instance', `window.api.instances.create({ name: 'E2E Test', mcVersion: '1.20.1', loader: 'vanilla', loaderVersion: null })`);
  const id = created?.id;
  console.log('instance id:', id);

  await run('list instances', `window.api.instances.list()`);

  await run('files.list root', `window.api.files.list(${JSON.stringify(id)}, '')`);

  await run('files.mkdir test', `window.api.files.mkdir(${JSON.stringify(id)}, '', 'testfolder')`);

  await run('files.list after mkdir', `window.api.files.list(${JSON.stringify(id)}, '')`);

  await run('openFolder', `window.api.instances.openFolder(${JSON.stringify(id)})`);

  console.log('\n=== launching (watch logs) ===');
  win.webContents.executeJavaScript(`
    window.api.instances.onProgress((p) => console.log('[progress]', JSON.stringify(p)));
    window.api.instances.onLog((p) => console.log('[GAME]', p.line));
    window.api.instances.onExit((p) => console.log('[exit]', JSON.stringify(p)));
    window.api.instances.launch(${JSON.stringify(id)}).then(r => console.log('[launch result]', JSON.stringify(r)));
  `);

  setTimeout(async () => {
    console.log('\n=== 40s elapsed, stopping ===');
    await win.webContents.executeJavaScript(`window.api.instances.stop(${JSON.stringify(id)})`);
    setTimeout(() => app.quit(), 2000);
  }, 40000);
});
