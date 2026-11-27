// Горизонт (игра на Rust) в системе должен выглядеть как «Minecraft Rust (H)» с иконкой лаунчера: в Диспетчере задач, на панели задач
// и в заголовке окна. Для этого рядом с horizon-client.exe лежит его копия «Minecraft Rust (H).exe» с подправленными ресурсами
// (иконка и описание) — оригинал не трогается. Если что-то не вышло, игра запускается как раньше, из оригинала.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

const BRAND = 'Minecraft Rust (H)';
const EXE_NAME = `${BRAND}.exe`;
const MARKER_VERSION = 2;

// rcedit и иконка лежат не в asar (exe оттуда не запустить): extraResources при сборке, build/tools — при запуске из исходников
function toolsDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(__dirname, '..', '..', 'build', 'tools');
}

function run(exe, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, out }); } };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish(-1); }, timeoutMs);
    child.stdout.on('data', (d) => { if (out.length < 65536) out += d; });
    child.stderr.on('data', (d) => { if (out.length < 65536) out += d; });
    child.on('error', () => finish(-1));
    child.on('exit', (code) => finish(code));
  });
}

// Путь к exe, которым надо запускать: брендированная копия или (при любой неудаче) исходный файл
async function ensureBrandedExe(clientExe, log = () => {}) {
  if (process.platform !== 'win32') return clientExe;
  try {
    const tools = toolsDir();
    const rcedit = path.join(tools, 'rcedit-x64.exe');
    const ico = path.join(tools, 'icon.ico');
    if (!fs.existsSync(rcedit) || !fs.existsSync(ico)) return clientExe;
    const dir = path.dirname(clientExe);
    const target = path.join(dir, EXE_NAME);
    const marker = path.join(dir, '.minecraft-rust-h.json');
    const st = await fsp.stat(clientExe);
    const want = { v: MARKER_VERSION, size: st.size, mtimeMs: Math.round(st.mtimeMs) };
    try {
      const have = JSON.parse(await fsp.readFile(marker, 'utf8'));
      if (have.v === want.v && have.size === want.size && have.mtimeMs === want.mtimeMs && fs.existsSync(target)) return target;
    } catch { /* копии ещё нет */ }

    const tmp = path.join(dir, `${BRAND}.tmp.exe`);
    await fsp.copyFile(clientExe, tmp);
    const edit = await run(rcedit, [
      tmp, '--set-icon', ico,
      '--set-version-string', 'FileDescription', BRAND,
      '--set-version-string', 'ProductName', BRAND,
      '--set-version-string', 'InternalName', BRAND,
      '--set-version-string', 'OriginalFilename', EXE_NAME,
      '--set-version-string', 'CompanyName', 'Zorya Launcher',
    ], 60000);
    if (edit.code !== 0) throw new Error(`rcedit: код ${edit.code} ${edit.out.slice(0, 200)}`);
    // Проверка, что правка не испортила файл: игра сама должна ответить на свой же запрос
    const check = await run(tmp, ['--launch-api'], 20000);
    if (check.code !== 0 || !check.out.trim().startsWith('{')) throw new Error(`копия не запускается (код ${check.code})`);
    await fsp.rm(target, { force: true });
    await fsp.rename(tmp, target);
    await fsp.writeFile(marker, JSON.stringify(want));
    return target;
  } catch (err) {
    log(`[Zorya Launcher] Значок и название Minecraft Rust (H) не применены: ${err.message}\n`);
    try { await fsp.rm(path.join(path.dirname(clientExe), `${BRAND}.tmp.exe`), { force: true }); } catch { /* ignore */ }
    return clientExe;
  }
}

// Окно игры сам создаёт Rust-клиент со своим названием: когда оно появится, заголовок меняется на «Minecraft Rust (H)»
// (несколько раз за первые seconds, если игра зададит своё). Скрипт короткий и сам завершается.
const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class ElWin { [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h, string t); }
"@
$id = [int]$env:EL_PID
$h = [IntPtr]::Zero
for ($i = 0; $i -lt 240; $i++) {
  $p = Get-Process -Id $id
  if (-not $p) { exit }
  $p.Refresh()
  if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $h = $p.MainWindowHandle; break }
  Start-Sleep -Milliseconds 500
}
if ($h -eq [IntPtr]::Zero) { exit }
for ($i = 0; $i -lt 15; $i++) { [void][ElWin]::SetWindowText($h, $env:EL_TITLE); Start-Sleep -Seconds 1 }
`;

function setWindowTitle(pid) {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return;
  try {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      windowsHide: true, stdio: 'ignore', env: { ...process.env, EL_PID: String(pid), EL_TITLE: BRAND },
    });
    child.on('error', () => {});
    child.unref();
  } catch { /* заголовок — украшение */ }
}

module.exports = { ensureBrandedExe, setWindowTitle, BRAND, EXE_NAME };
