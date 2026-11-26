// Hearts Chubrik в игре рисует агент Zorya Cosmetics (см. zorya-agent/): картинки зашиты внутрь агента и отдаются игре из памяти,
// на диск ничего не пишется. Этот модуль только убирает то, что оставили прошлые версии лаунчера: файл ресурспака ZoryaLauncher-hearts.zip
// в папке resourcepacks сборки и его запись в options.txt.
const fs = require('fs');
const path = require('path');
const offlineSkin = require('./offlineSkin');

const PACK_FILE = 'ZoryaLauncher-hearts.zip';

// Агент находит игрока там, где у игры при запуске «настоящие» (не обфусцированные) имена: Minecraft 26.1+ и NeoForge 1.20.5+.
function supported(instance) {
  const v = String(instance?.mcVersion || '');
  if (/^\d{2}\./.test(v)) return true; // 26.1 и новее
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(v);
  if (!m || String(instance?.loader || '').toLowerCase() !== 'neoforge') return false;
  const minor = Number(m[1]);
  return minor > 20 || (minor === 20 && Number(m[2] || 0) >= 5);
}

function removeFile(gameDir) {
  try { fs.rmSync(path.join(gameDir, 'resourcepacks', PACK_FILE), { force: true }); } catch { /* занят: игра ещё запущена */ }
}

// File и запись в options.txt от прошлых версий
function removeLegacy(gameDir, mcVersion) {
  removeFile(gameDir);
  try { offlineSkin.setPackEnabled(gameDir, mcVersion, false, PACK_FILE); } catch { /* options.txt нечитаем */ }
}

module.exports = { supported, removeFile, removeLegacy, PACK_FILE };