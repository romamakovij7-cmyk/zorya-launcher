// Zorya Cosmetics: Java-агент, который показывает плащи Zorya на аккаунтах Microsoft (лицензия). Он не трогает авторизацию —
// только добавляет картинку плаща к тому, что authlib сам разобрал для игрока (см. zorya-agent/). Лаунчер лишь подключает его к игре:
//   -javaagent:<zorya-agent.jar>=zorya-core.jar|<адрес API скин-сервера>
// Files агента лежат в resources\agent (при сборке из исходников — build\agent). Опции агента не переносят нелатинские буквы
// (кириллица в имени пользователя Windows превращается в «?»), поэтому при нелатинском пути files копируются в C:\ProgramData\ZoryaLauncher\agent.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const license = require('./license');

const FILES = ['zorya-agent.jar', 'zorya-core.jar'];
const isAscii = (s) => /^[\x20-\x7e]*$/.test(String(s));

function sourceDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'agent') : path.join(__dirname, '..', '..', 'build', 'agent');
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Каталог с латинским путём, где лежат точные копии файлов агента (проверяются по хешу при каждом запуске)
function runDir(src) {
  if (isAscii(src)) return src;
  const base = process.env.ProgramData;
  if (!base || !isAscii(base)) throw new Error('нет каталога с латинским путём для агента');
  const dir = path.join(base, 'ZoryaLauncher', 'agent');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of FILES) {
    const from = path.join(src, name);
    const to = path.join(dir, name);
    if (!fs.existsSync(to) || sha256(to) !== sha256(from)) fs.copyFileSync(from, to);
  }
  return dir;
}

// Версии, где агент показывает скины сам (проверено: authlib 6+ — Minecraft 1.21 и новее, включая 26.x): там офлайн-аккаунтам
// не нужен authlib-injector. На более старых версиях скины офлайн-аккаунтов по-прежнему даёт он.
function skinsViaAgent(instance) {
  const v = String(instance?.mcVersion || '');
  if (/^\d{2}\./.test(v)) return true; // 26.1 и новее
  const m = /^1\.(\d+)/.exec(v);
  return !!m && Number(m[1]) >= 21;
}

// Аргументы JVM для запуска или пустой список (агент недоступен — игра просто идёт без него).
// offline: аккаунт без сессии Mojang — агент пропускает «join» к серверу сессий (иначе в LAN-мир лицензионного игрока не зайти).
// The key that shows or hides the overlay and how it is written on the panel. code: GLFW key code (Minecraft up to 26.1); sdl: SDL scancode
// (Minecraft 26.3 and newer read the keyboard through SDL, which numbers keys differently); vk: Windows virtual-key code (games without an agent)
const OVERLAY_KEYS = {
  right_alt: { code: 346, sdl: 230, vk: 0xA5, label: 'Right Alt' },
  right_ctrl: { code: 345, sdl: 228, vk: 0xA3, label: 'Right Ctrl' },
  right_shift: { code: 344, sdl: 229, vk: 0xA1, label: 'Right Shift' },
  insert: { code: 260, sdl: 73, vk: 0x2D, label: 'Insert' },
  home: { code: 268, sdl: 74, vk: 0x24, label: 'Home' },
  end: { code: 269, sdl: 77, vk: 0x23, label: 'End' },
  f8: { code: 297, sdl: 65, vk: 0x77, label: 'F8' },
  f9: { code: 298, sdl: 66, vk: 0x78, label: 'F9' },
};
const overlayKey = (id) => OVERLAY_KEYS[id] || OVERLAY_KEYS.f9;

// Licensed account: the skin it has at Mojang, for the UUID its nick gets on offline-mode servers (those servers never send a skin, the
// game would show Steve/Alex). Returns the -Dzorya.selfskin value for the agent or null. Only the skin picture's address is given
// (textures.minecraft.net), nothing about the account's tokens.
function selfSkinArg(account) {
  try {
    if (!account || account.type !== 'microsoft' || !account.name || !account.skinUrl) return null;
    const u = new URL(account.skinUrl);
    if (u.protocol !== 'https:' || u.hostname !== 'textures.minecraft.net') return null;
    const id = require('./auth').makeOfflineAccount(account.name).id.replace(/-/g, '');
    return `${id}|${account.skinVariant === 'slim' ? 1 : 0}|${u.toString()}`;
  } catch { return null; }
}

function jvmArgs({ offline = false, metricsPort = null, overlayKeyId = null, account = null } = {}) {
  const src = sourceDir();
  for (const name of FILES) if (!fs.existsSync(path.join(src, name))) return [];
  const dir = runDir(src);
  const options = ['zorya-core.jar', `${license.siteUrl().origin}/api/skins`];
  // Отладка (для разработчика): ETERNAL_COSMETICS_DEBUG=<файл с латинским путём> — агент пишет туда, что он делает
  if (process.env.ETERNAL_COSMETICS_DEBUG && isAscii(process.env.ETERNAL_COSMETICS_DEBUG)) options.push(process.env.ETERNAL_COSMETICS_DEBUG);
  const args = [`-javaagent:${path.join(dir, 'zorya-agent.jar')}=${options.join('|')}`];
  if (offline) args.push('-Dzorya.offline=1');
  const self = selfSkinArg(account);
  if (self) args.push(`-Dzorya.selfskin=${self}`);
  // Overlay (Right Ctrl): where the agent sends the game's performance numbers: this computer only, a port the launcher listens on
  if (Number.isInteger(metricsPort) && metricsPort >= 1024 && metricsPort <= 65535) { args.push(`-Dzorya.metrics=127.0.0.1:${metricsPort}`); args.push(`-Dzorya.metrics.key=${overlayKey(overlayKeyId).code}`, `-Dzorya.metrics.sdl=${overlayKey(overlayKeyId).sdl}`); }
  return args;
}

module.exports = { jvmArgs, selfSkinArg, skinsViaAgent, isAscii, overlayKey, OVERLAY_KEYS };
