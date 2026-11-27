const fs = require('fs');
const path = require('path');

// Turns a crashed game's console output + crash report into a short list of
// plain-language findings, each optionally paired with a one-click fix
// (action ids are handled by the renderer: resetJava, repair, moreMemory,
// lessMemory, findMods, updateLoader, clearJvmArgs).
//
// A finding may also carry `mods`: the mods it names, so the panel can show them with buttons
//   { kind: 'install' | 'update' | 'suspect', modId, name, range, requestedBy, filename }
//   install — the mod is missing; update — an installed mod is too old/new; suspect — probably guilty (disable / update).
// See modfix.js for how those are matched with installed files and with Modrinth.

const MAX_REPORT_BYTES = 200 * 1024;

function newestFile(dir, filter, notBefore) {
  let best = null;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!filter(name)) continue;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.mtimeMs < notBefore) continue;
    if (!best || stat.mtimeMs > best.mtimeMs) best = { full, mtimeMs: stat.mtimeMs };
  }
  return best?.full || null;
}

function readCapped(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const size = Math.min(fs.fstatSync(fd).size, MAX_REPORT_BYTES);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

function uniq(list) {
  return [...new Set(list)];
}

// Not mods from a catalog: the game's own environment
const ENV_IDS = new Set(['java', 'minecraft', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt-loader', 'forge', 'neoforge', 'fml', 'javafml', 'lowcodefml', 'mixin']);
// Jar names that belong to the loader/game, never "a suspect mod"
const SYSTEM_JAR = /^(minecraft|client|server|forge|neoforge|fmlcore|fmlloader|javafmllanguage|lowcodelanguage|mclanguage|fabric-loader|quilt-loader|sponge-mixin|intermediary|libraries|bootstraplauncher|securejarhandler|modlauncher|eventbus)/i;

const rangeRu = (r) => {
  const t = String(r || '').trim();
  if (!t || /^any/i.test(t)) return 'любая версия';
  const between = /between\s+(\d[\d.]*)-?\s*(?:\((?:in|ex)clusive\))?\s+and\s+(\d[\d.]*)/i.exec(t);
  if (between) return between[1] === between[2] ? `ровно ${between[1]}` : `от ${between[1]} до ${between[2]}`;
  return t.replace(/\bor later\b/gi, 'или новее').replace(/\bor earlier\b/gi, 'или старее').replace(/\bor above\b/gi, 'или новее').replace(/^version /i, '');
};

// ---- requirements: who needs which mod, and is it missing or the wrong version ----
// Fabric/Quilt: "Mod 'Iris' (iris) 1.7 requires version 0.5.8 or later of mod 'Sodium' (sodium), which is missing!"
//               "... requires any version of fabric-api, but only the wrong version is present: 0.90!"
// Forge: "Mod ID: 'jei', Requested by: 'foo', Expected range: '[15.0,)', Actual version: '[MISSING]'"
// NeoForge: "Mod X requires jei 15.0 or above" + "Currently, jei is not installed" / "is version 14.0"
function parseRequirements(text) {
  const reqs = [];

  for (const m of text.matchAll(/Mod '([^']+)' \(([^)]+)\)[^\n]*?\brequires\b ([^\n]*)/gi)) {
    const requester = { name: m[1], id: m[2] };
    const tail = m[3];
    const t = /^(any version|version (.+?)) of (?:mod )?(?:'([^']+)' \(([^)]+)\)|([^\s,]+))\s*,?\s*(which is missing|but only the wrong version is present: ([^!\n]+)|which is (?:currently )?disabled)?/i.exec(tail);
    if (!t) continue;
    const depId = t[4] || t[5];
    const depName = t[3] || depId;
    const status = !t[6] ? null : /missing/i.test(t[6]) ? 'missing' : /disabled/i.test(t[6]) ? 'disabled' : 'wrong';
    if (!status) continue;
    reqs.push({ requester, dep: { id: depId, name: depName }, range: t[2] || 'any', status, present: t[7] ? t[7].trim() : null });
  }

  for (const m of text.matchAll(/Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']+)', Actual version: '([^']+)'/g)) {
    const missing = /MISSING/i.test(m[4]);
    reqs.push({ requester: { name: m[2], id: m[2] }, dep: { id: m[1], name: m[1] }, range: m[3], status: missing ? 'missing' : 'wrong', present: missing ? null : m[4] });
  }

  for (const m of text.matchAll(/Mod (?:ID )?'?([^'\n]+?)'? requires ([\w.-]+) ([^\s\n]+)(?: or (?:above|later))?[^\n]*\n[^\n]{0,80}?Currently, ([\w.-]+) is (not installed|disabled|version ([^\n]+))/gi)) {
    reqs.push({
      requester: { name: m[1].trim(), id: m[1].trim() }, dep: { id: m[2], name: m[2] }, range: `${m[3]} или новее`,
      status: /not installed/i.test(m[5]) ? 'missing' : /disabled/i.test(m[5]) ? 'disabled' : 'wrong', present: m[6] ? m[6].trim() : null,
    });
  }
  return reqs;
}

// Jars whose code is in the stack trace: "~[sodium-fabric-0.5.8.jar:?]" or "[sodium.jar%23123!/:?]" — most frequent first
function jarsFromTrace(text) {
  const count = new Map();
  for (const m of text.matchAll(/[~\[]\[?([\w.+()\-]+?\.jar)(?:%23\d+)?[!:\]\s]/g)) {
    const jar = m[1];
    if (SYSTEM_JAR.test(jar)) continue;
    count.set(jar, (count.get(jar) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([j]) => j);
}

function listModFiles(gameDir) {
  try { return fs.readdirSync(path.join(gameDir, 'mods')).filter((n) => /\.jar(\.disabled)?$/i.test(n)); } catch { return []; }
}

// The text under analysis comes from the game (any mod or server can print anything) — the patterns below must never be
// fed megabytes of one line or a million blank lines: several of them are slow on such input (the time grows with the
// square of the line length). So before analysis: lines are cut, blank runs collapsed, and only the head and the tail kept.
const MAX_LINE = 400;
const KEEP_HEAD_LINES = 300;
const KEEP_TAIL_LINES = 6000;
function prepareText(raw) {
  const all = String(raw).split('\n');
  const kept = all.length > KEEP_HEAD_LINES + KEEP_TAIL_LINES
    ? [...all.slice(0, KEEP_HEAD_LINES), '...', ...all.slice(-KEEP_TAIL_LINES)]
    : all;
  const out = [];
  let blank = false;
  for (let line of kept) {
    if (line.length > MAX_LINE) line = line.slice(0, MAX_LINE);
    if (!line.trim()) {
      if (blank) continue;
      blank = true;
      out.push('');
    } else {
      blank = false;
      out.push(line);
    }
  }
  return out.join('\n');
}

function analyzeCrash({ gameDir, lines, startedAt, exitCode }) {
  const notBefore = (startedAt || 0) - 5000;
  const reportPath = newestFile(path.join(gameDir, 'crash-reports'), (n) => n.endsWith('.txt'), notBefore);
  const hsErrPath = newestFile(gameDir, (n) => /^hs_err_pid\d+\.log$/.test(n), notBefore);
  const reportText = reportPath ? readCapped(reportPath) : '';
  const text = prepareText(`${(lines || []).join('')}\n${reportText}`);
  const modFiles = listModFiles(gameDir);
  const hasModFile = (name) => modFiles.find((f) => f.replace(/\.disabled$/, '').toLowerCase() === String(name).toLowerCase());

  const findings = [];
  const add = (f) => { if (!findings.some((x) => x.id === f.id)) findings.push(f); };

  // 0. The game never started: Java itself could not be launched
  if (/\[launcher\] Failed to start Java: ([^\n]+)/i.test(text)) {
    add({
      id: 'java-missing',
      title: 'Failed запустить Java',
      detail: `${/\[launcher\] Failed to start Java: ([^\n]+)/i.exec(text)[1]}\nСкорее всего, указан неверный путь к Java. Сбросьте его — лаунчер подберёт нужную сам.`,
      action: 'resetJava',
    });
  }

  // 1. Bad JVM arguments: an option this Java doesn't know, or two collectors at once
  const badOpt = /Unrecognized (?:VM )?option '?([^'\s\n]+)'?/i.exec(text)?.[1];
  const badCollector = /Conflicting collector combinations in option list/i.test(text);
  if (badOpt || badCollector) {
    add({
      id: 'bad-jvm-args',
      title: 'Java не приняла один из аргументов запуска',
      detail: badOpt
        ? `Аргумент «${badOpt}» не поддерживается этой версией Java (например, флаг ZGC, который есть не во всех версиях). Уберите его из доп. аргументов JVM.`
        : 'В аргументах включено сразу два сборщика мусора (например, G1 и ZGC). Оставьте один.',
      action: 'clearJvmArgs',
      option: badOpt ? badOpt.replace(/^-XX:[+-]?/, '').replace(/[=].*$/, '') : null,
    });
  }

  // 2. Loader (Fabric/Quilt) whose bundled ASM is too old to read this game's class files
  const asmTooOld = /Unsupported class file major version (\d+)/.exec(text);
  if (asmTooOld && /org\.objectweb\.asm\.ClassReader/.test(text)) {
    add({
      id: 'loader-too-old',
      title: 'Version загрузчика слишком старая для этой игры',
      detail: `Loader не умеет читать files игры (формат классов ${asmTooOld[1]}). Нужна более новая loader version (Fabric/Quilt) — смените её в настройках сборки.`,
      action: 'updateLoader',
    });
  }

  // 3. Wrong Java
  const javaReq = /requires version (\d+)[^\n]*?\(java\)[^\n]*?wrong version is present: (\d+)/i.exec(text);
  if (javaReq) {
    add({
      id: 'java-version',
      title: 'Неподходящая версия Java',
      detail: `Моду нужна Java ${javaReq[1]}, а запущена Java ${javaReq[2]}. Сбросьте свой путь к Java в настройках — лаунчер сам подберёт нужную.`,
      action: 'resetJava',
    });
  } else if (/UnsupportedClassVersionError[^\n]*?(?:class file version|compiled by a more recent version)[^\n]*/i.test(text)) {
    add({
      id: 'java-version',
      title: 'Неподходящая версия Java',
      detail: 'Game или мод собраны под более новую Java, чем запущена. Сбросьте свой путь к Java в настройках — лаунчер подберёт нужную.',
      action: 'resetJava',
    });
  }

  // 4. Native libraries (LWJGL) missing
  const nativeName = /Failed to locate library: (\S+)/i.exec(text)?.[1];
  if (nativeName || /UnsatisfiedLinkError/i.test(text)) {
    add({
      id: 'natives',
      title: 'Не загрузились системные библиотеки игры',
      detail: `Не найдена библиотека${nativeName ? ` ${nativeName}` : ''}. Обычно помогает восстановление файлов сборки.`,
      action: 'repair',
    });
  }
  if (/Could not find or load main class|ClassNotFoundException: net\.minecraft\.client\.main\.Main|Error: Unable to access jarfile/i.test(text)) {
    add({
      id: 'main-class',
      title: 'Game files повреждены или не докачались',
      detail: 'Java не нашла главный класс игры. Восстановление файлов сборки скачает недостающее заново.',
      action: 'repair',
    });
  }

  // 5. Memory — the kind of OutOfMemoryError decides what helps
  if (/unable to create (?:new )?native thread/i.test(text)) {
    add({
      id: 'native-thread',
      title: 'Системе не хватило памяти на потоки',
      detail: 'Java не смогла создать новый поток: оперативная память занята. Как ни странно, помогает выделить игре меньше памяти (или закрыть другие программы).',
      action: 'lessMemory',
    });
  } else if (/Could not reserve enough space|Invalid maximum heap size|Could not create the Java Virtual Machine/i.test(text) && !badOpt && !badCollector) {
    add({
      id: 'memory-too-big',
      title: 'Java не смогла выделить столько памяти',
      detail: 'Выделено больше оперативной памяти, чем доступно системе. Уменьшите объём для этой сборки.',
      action: 'lessMemory',
    });
  } else if (/OutOfMemoryError: Metaspace/i.test(text)) {
    add({
      id: 'metaspace',
      title: 'Закончилась память под классы мод(ов)',
      detail: 'Слишком много или слишком тяжёлые mods для памяти классов (Metaspace). Добавьте аргумент -XX:MaxMetaspaceSize=1G в аргументы JVM или уберите часть модов.',
    });
  } else if (/OutOfMemoryError: Direct buffer memory/i.test(text)) {
    add({
      id: 'direct-memory',
      title: 'Закончилась память для графики и звука',
      detail: 'Не хватило «прямой» памяти. Чаще всего виноваты шейдеры или огромные ресурс-паки: уберите их или добавьте -XX:MaxDirectMemorySize=2G в аргументы JVM.',
    });
  } else if (/java\.lang\.OutOfMemoryError|Java heap space|GC overhead limit/i.test(text)) {
    add({
      id: 'memory',
      title: 'Не хватило памяти',
      detail: 'Game упёрлась в лимит оперативной памяти. Можно выделить сборке больше.',
      action: 'moreMemory',
    });
  }
  if (/No space left on device|Недостаточно места на диске|There is not enough space on the disk/i.test(text)) {
    add({ id: 'disk-full', title: 'На диске закончилось место', detail: 'Game не смогла записать files. Освободите место на диске, где лежит сборка.' });
  }

  // 6. Mods: dependencies (missing / wrong version), the game version they were built for
  const reqs = parseRequirements(text).filter((r) => !ENV_IDS.has(String(r.dep.id).toLowerCase()) || String(r.dep.id).toLowerCase() === 'minecraft');
  const mcMismatch = reqs.filter((r) => String(r.dep.id).toLowerCase() === 'minecraft');
  const depReqs = reqs.filter((r) => String(r.dep.id).toLowerCase() !== 'minecraft');

  const needsById = new Map(); // dep id → row
  const upsert = (kind, id, name, range, by, extra = {}) => {
    const key = `${kind}:${String(id).toLowerCase()}`;
    const row = needsById.get(key) || { kind, modId: id, name, range, requestedBy: [], ...extra };
    if (by && !row.requestedBy.includes(by)) row.requestedBy.push(by);
    needsById.set(key, row);
  };
  const lines2 = [];
  for (const r of depReqs) {
    const kind = r.status === 'wrong' ? 'update' : 'install';
    upsert(kind, r.dep.id, r.dep.name, r.range, r.requester.name, r.present ? { present: r.present } : {});
    const who = `«${r.requester.name}» требует ${r.dep.name} (${rangeRu(r.range)})`;
    lines2.push(`${who} — ${r.status === 'missing' ? 'мод не установлен' : r.status === 'disabled' ? 'мод выключен' : `стоит ${r.present || 'другая версия'}`}`);
  }
  // Fabric spells out its own plan: "Install X", "Replace mod 'Y' (y) ..."
  for (const m of text.matchAll(/^[ \t]*-[ \t]*Install (?:(?:any version|version [^\n]*?) of )?(?:mod )?(?:'([^']+)' \(([^)]+)\)|([\w.-]+?))(?:,|\.|\s|$)/gim)) {
    const id = m[2] || m[3];
    if (!id || ENV_IDS.has(id.toLowerCase()) || /^(version|any)$/i.test(id)) continue;
    upsert('install', id, m[1] || id, '', null);
  }
  for (const m of text.matchAll(/^[ \t]*-[ \t]*(?:Replace|Update) mod '([^']+)' \(([^)]+)\)/gim)) {
    if (!ENV_IDS.has(m[2].toLowerCase())) upsert('update', m[2], m[1], '', null);
  }
  const installRows = [...needsById.values()].filter((r) => r.kind === 'install');
  const gameModIds = new Set(mcMismatch.map((r) => String(r.requester.id).toLowerCase()));
  const updateRows = [...needsById.values()].filter((r) => r.kind === 'update' && !installRows.some((i) => i.modId.toLowerCase() === r.modId.toLowerCase()) && !gameModIds.has(String(r.modId).toLowerCase()));
  const niceNames = (rows) => uniq(rows.map((r) => r.name)).slice(0, 4).join(', ');
  if (installRows.length) {
    add({
      id: 'missing-deps',
      title: installRows.length === 1 ? `Не хватает мода: ${niceNames(installRows)}` : `Не хватает модов: ${niceNames(installRows)}${installRows.length > 4 ? '…' : ''}`,
      detail: lines2.filter((l) => /не установлен|выключен/.test(l)).slice(0, 8).join('\n') || 'Для работы установленных модов нужны другие mods.',
      action: 'findMods',
      mods: installRows,
    });
  }
  if (updateRows.length) {
    add({
      id: 'outdated-mods',
      title: updateRows.length === 1 ? `Нужно обновить мод: ${niceNames(updateRows)}` : `Нужно обновить mods: ${niceNames(updateRows)}`,
      detail: lines2.filter((l) => /стоит/.test(l)).slice(0, 8).join('\n') || 'Версии установленных модов не подходят друг другу.',
      action: 'findMods',
      mods: updateRows,
    });
  }
  if (mcMismatch.length) {
    const rows = [];
    for (const r of mcMismatch) {
      if (!rows.some((x) => x.modId.toLowerCase() === String(r.requester.id).toLowerCase())) rows.push({ kind: 'update', modId: r.requester.id, name: r.requester.name, range: '', why: 'game', gameNeeds: r.range, gamePresent: r.present || '', requestedBy: [] });
    }
    add({
      id: 'mc-version-mod',
      title: rows.length === 1 ? `Mod «${rows[0].name}» сделан для другой версии игры` : 'Некоторые mods сделаны для другой версии игры',
      detail: `${uniq(mcMismatch.map((r) => `«${r.requester.name}» нужна игра ${rangeRu(r.range)}${r.present ? `, а стоит ${r.present}` : ''}`)).slice(0, 6).join('\n')}\nОбновите эти mods до версии под вашу игру или уберите их.`,
      action: 'findMods',
      mods: rows,
    });
  }

  // Forge/NeoForge: the section header with no parsable lines still tells what happened
  if (!installRows.length && !updateRows.length && !mcMismatch.length) {
    const forgeMissing = /Missing or unsupported mandatory dependencies:([\s\S]{0,700})/i.exec(text);
    if (forgeMissing) {
      add({
        id: 'missing-deps-forge',
        title: 'Не хватает обязательных модов',
        detail: forgeMissing[1].split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 8).join('\n'),
        action: 'findMods',
      });
    }
    // Other Fabric "Mod X requires ..." lines
    const otherReq = uniq(
      (text.match(/Mod '[^']+' \([^)]+\)[^\n]*?requires[^\n]*/gi) || [])
        .filter((l) => !/\(java\)|OpenJDK|which is missing/i.test(l))
        .map((l) => l.trim()),
    ).slice(0, 6);
    if (otherReq.length) {
      add({
        id: 'incompatible-mods',
        title: 'Несовместимые версии модов',
        detail: `${otherReq.join('\n')}\nОбновите указанные mods или подберите версии, подходящие друг другу и версии игры.`,
        action: 'findMods',
      });
    }
  }

  // 7. Mod files that are not valid for this loader / are corrupted
  const brokenLine = /(?:ZipException|zip END header not found|error in opening zip file|Invalid or corrupt jarfile|zip file is empty|Not a valid zip)[^\n]*/i.exec(text);
  if (brokenLine) {
    const jars = uniq((text.match(/[\w.+()\-]+\.jar/g) || []).filter((j) => hasModFile(j))).slice(0, 4);
    add({
      id: 'corrupted-jar',
      title: jars.length ? `Повреждён файл мода: ${jars[0]}` : 'Один из файлов повреждён',
      detail: `${brokenLine[0].trim().slice(0, 200)}\nFile скачался не до конца. Обновите мод (скачается заново) или отключите его.`,
      mods: jars.map((j) => ({ kind: 'suspect', modId: '', name: j, filename: hasModFile(j) })),
    });
  }
  const notForLoader = /(?:Mod file|File) ([^\n]*?\.jar) (?:is missing mods\.toml|is not a valid mod|does not contain a valid mod)/i.exec(text)
    || /Found [^\n]*?mod ([\w.+()\-]+\.jar)[^\n]*?(?:for|made for) (?:Fabric|Forge|NeoForge|Quilt)/i.exec(text);
  if (notForLoader) {
    const jar = path.basename(notForLoader[1].replace(/\\/g, '/'));
    add({
      id: 'wrong-loader-mod',
      title: `«${jar}» — не мод для этого загрузчика`,
      detail: 'File сделан для другого загрузчика (например, Fabric-мод в сборке на Forge). Отключите его и найдите версию для вашего загрузчика.',
      mods: hasModFile(jar) ? [{ kind: 'suspect', modId: '', name: jar, filename: hasModFile(jar) }] : [],
    });
  }

  // 8. Duplicate mods
  const dup = uniq((text.match(/[^\n]*[Dd]uplicate mod[^\n]*/g) || []).map((l) => l.trim())).slice(0, 5);
  if (dup.length) {
    add({
      id: 'duplicate-mods',
      title: 'Один и тот же мод установлен дважды',
      detail: `${dup.join('\n')}\nУдалите лишний файл на вкладке «Содержимое».`,
    });
  }

  // 9. A specific mod crashed on startup (Fabric entrypoint) / failed to apply its mixins
  const entry = /Could not execute entrypoint stage '(\w+)' due to errors, provided by '([^']+)'/i.exec(text);
  if (entry && !findings.some((f) => ['java-version', 'natives'].includes(f.id))) {
    add({
      id: 'mod-entrypoint',
      title: `Mod «${entry[2]}» упал при запуске`,
      detail: 'Попробуйте обновить этот мод, отключить его или проверить, подходит ли он к версии игры.',
      mods: [{ kind: 'suspect', modId: entry[2], name: entry[2] }],
    });
  }
  const mixin = /Mixin apply for mod ([\w.-]+) failed|Mixin transformation of ([\w./$-]+) failed|([\w.-]+)\.mixins\.json[^\n]*(?:failed|InvalidMixinException)/i.exec(text);
  if (mixin) {
    const who = mixin[1] || mixin[3] || mixin[2];
    add({
      id: 'mixin',
      title: `Конфликт при внедрении мода «${who}»`,
      detail: 'Mod не смог встроиться в игру — обычно из-за несовместимой версии или конфликта с другим модом. Обновите или отключите его.',
      mods: mixin[2] ? [] : [{ kind: 'suspect', modId: who, name: who }],
    });
  }
  const dist = /Attempted to load class ([\w/.$]+) for invalid dist (CLIENT|DEDICATED_SERVER)/i.exec(text);
  if (dist) {
    const onlyServer = /CLIENT/i.test(dist[2]);
    add({
      id: 'wrong-side',
      title: onlyServer ? 'В сборке есть мод только для сервера' : 'В сборке есть мод только для клиента',
      detail: `${dist[1]}\nЭтот мод предназначен для другой стороны (${onlyServer ? 'сервера' : 'клиента'}) и не должен стоять в игре. Найдите его в списке и отключите.`,
      mods: jarsFromTrace(text).filter((j) => hasModFile(j)).slice(0, 3).map((j) => ({ kind: 'suspect', modId: '', name: j, filename: hasModFile(j) })),
    });
  }

  // 10. Graphics / drivers
  if (/GLFW error 65542|WGL: The driver does not appear to support OpenGL|Pixel format not accelerated|failed to create the window|GLFW error 65543|Failed to create window/i.test(text)) {
    add({
      id: 'opengl',
      title: 'Видеокарта или драйвер не подошли для игры',
      detail: 'Игре failed создать окно с OpenGL. Обновите драйвер видеокарты; на ноутбуке выберите дискретную видеокарту для Java (Параметры Windows → Графика); отключите оверлеи (Discord, Steam, MSI Afterburner).',
    });
  }
  if (hsErrPath || /EXCEPTION_ACCESS_VIOLATION|SIGSEGV|A fatal error has been detected by the Java Runtime/i.test(text)) {
    add({
      id: 'jvm-crash',
      title: 'Аварийное завершение Java',
      detail: 'Похоже на сбой на уровне драйвера видеокарты или нативной библиотеки. Обновите драйвер видеокарты, отключите оверлеи (Discord, Steam, программы записи), попробуйте убрать шейдеры и mods, меняющие графику.',
    });
  } else if (!findings.length && [-1073740791, -1073741819, -1073740940, -1073741571].includes(exitCode)) {
    add({
      id: 'native-exit',
      title: 'Game упала на системном уровне',
      detail: `Код выхода ${exitCode} — сбой в драйвере или нативной библиотеке, а не в самой игре. Обновите драйвер видеокарты, отключите оверлеи (Discord, Steam, MSI Afterburner), проверьте, не блокирует ли игру антивирус.`,
    });
  }

  // 11. Still nothing specific: name the mods the stack trace points at (Forge also writes "Suspected Mods")
  const description = /^Description: (.+)$/m.exec(reportText)?.[1] || null;
  const causedBy = (text.match(/^Caused by: .+$/gm) || []).pop() || null;
  const strong = findings.length;
  if (!strong || findings.every((f) => ['mod-entrypoint', 'mixin'].includes(f.id))) {
    const suspectedBlock = /Suspected Mods?:\s*\n((?:\t[^\n]*\n?)+)/i.exec(text)?.[1] || '';
    const named = [...suspectedBlock.matchAll(/^\t([^\t\n]+?) \(([^)]+)\)/gm)].map((m) => ({ name: m[1], id: m[2] })).filter((x) => !ENV_IDS.has(x.id.toLowerCase()));
    const jars = jarsFromTrace(text).filter((j) => hasModFile(j)).slice(0, 3);
    const rows = [
      ...named.slice(0, 3).map((x) => ({ kind: 'suspect', modId: x.id, name: x.name })),
      ...jars.map((j) => ({ kind: 'suspect', modId: '', name: j, filename: hasModFile(j) })),
    ];
    if (rows.length && !findings.length) {
      add({
        id: 'suspect-mods',
        title: rows.length === 1 ? 'Скорее всего, виноват один мод' : 'Подозрительные mods',
        detail: `${[description, causedBy].filter(Boolean)[0] || 'В списке вызовов, приведших к падению, замечены эти mods.'}\nПопробуйте обновить их или отключить по одному и запустить игру снова.`,
        mods: rows,
      });
    }
  }

  if (findings.length === 0) {
    const firstError = /^.*(?:Exception|Error)[^\n]*$/m.exec(text)?.[0]?.trim();
    add({
      id: 'unknown',
      title: 'Причина не определена автоматически',
      detail: [description, causedBy, firstError].filter(Boolean)[0]
        || 'В логе нет явной ошибки. Посмотрите вкладку «Консоль» или краш-репорт.',
      action: 'openLog',
    });
  }

  return {
    time: Date.now(),
    exitCode,
    findings,
    description,
    causedBy,
    reportPath: reportPath || hsErrPath || null,
  };
}

module.exports = { analyzeCrash, parseRequirements, jarsFromTrace };
