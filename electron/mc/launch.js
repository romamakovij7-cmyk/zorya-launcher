const fs = require('fs');
const path = require('path');
const gameProc = require('./gameProc');
const paths = require('./paths');
const versions = require('./versions');
const fabric = require('./fabric');
const forge = require('./forge');
const java = require('./java');
const { rulesAllow } = require('./rules');

function mergeLibraries(baseLibs, overrideLibs) {
  const keyOf = (l) => {
    // group:artifact[:classifier] — the classifier matters: Forge 1.21+ lists forge:…:universal AND forge:…:client (two different jars);
    // keyed without it the second replaced the first and the game died with "Failed to find system mod: forge".
    const parts = (l.name || l.path || '').split(':');
    if (parts.length < 2) return l.path;
    return parts.length >= 4 ? `${parts[0]}:${parts[1]}:${parts[3]}` : `${parts[0]}:${parts[1]}`;
  };
  const map = new Map();
  for (const l of baseLibs) map.set(keyOf(l), l);
  for (const l of overrideLibs) map.set(keyOf(l), l);
  return Array.from(map.values());
}

function substitute(str, repl) {
  if (typeof str !== 'string') return str;
  return str.replace(/\$\{([a-zA-Z_]+)\}/g, (m, key) => (key in repl ? repl[key] : m));
}

function processArgList(list, repl, features = {}) {
  const out = [];
  for (const item of list || []) {
    if (typeof item === 'string') {
      out.push(substitute(item, repl));
    } else if (item && typeof item === 'object') {
      if (!rulesAllow(item.rules, features)) continue;
      const vals = Array.isArray(item.value) ? item.value : [item.value];
      for (const v of vals) out.push(substitute(v, repl));
    }
  }
  return out;
}

async function prepareInstance(instance, onProgress, javaPath) {
  const report = (stage, extra) => onProgress && onProgress({ stage, ...extra });

  report('version-info');
  const vanillaJson = await versions.getVersionJson(instance.mcVersion);

  report('download-client', { total: 1 });
  const clientJarPath = await versions.downloadClient(vanillaJson, (p) => report('download-client', p));

  // Right Java for this Minecraft version (custom path from Settings wins).
  // Needed before the loader step, since the Forge/NeoForge installer runs on it.
  report('download-java');
  const javaExe = await java.resolveJava(vanillaJson, javaPath, (p) => report('download-java', p));

  let mainClass = vanillaJson.mainClass;
  let versionLabel = vanillaJson.id;
  let loaderLibraries = [];
  let loaderGameArgs = [];
  let loaderJvmArgs = [];

  if (instance.loader === 'fabric') {
    report('loader-profile');
    const profile = await fabric.getFabricProfile(instance.mcVersion, instance.loaderVersion);
    mainClass = profile.mainClass;
    versionLabel = profile.id;
    loaderLibraries = profile.libraries || [];
    loaderGameArgs = (profile.arguments && profile.arguments.game) || [];
  } else if (instance.loader === 'quilt') {
    report('loader-profile');
    const profile = await fabric.getQuiltProfile(instance.mcVersion, instance.loaderVersion);
    mainClass = profile.mainClass;
    versionLabel = profile.id;
    loaderLibraries = profile.libraries || [];
    loaderGameArgs = (profile.arguments && profile.arguments.game) || [];
  } else if (instance.loader === 'forge' || instance.loader === 'neoforge') {
    report('loader-profile');
    const profile = await forge.installLoaderProfile(
      instance.loader,
      instance.mcVersion,
      instance.loaderVersion,
      javaExe,
      (p) => report('loader-install', p)
    );
    mainClass = profile.mainClass;
    versionLabel = profile.id;
    loaderLibraries = profile.libraries || [];
    loaderGameArgs = (profile.arguments && profile.arguments.game) || [];
    loaderJvmArgs = (profile.arguments && profile.arguments.jvm) || [];
  }

  // Forge/NeoForge's BootstrapLauncher is told to ignore the game jar on the
  // classpath by *name* (-DignoreList=...,${version_name}.jar). The official
  // launcher therefore uses a copy of the vanilla jar named after the loader
  // profile (versions/<profile id>/<profile id>.jar). Left as "1.21.jar" the
  // jar is picked up as an automatic module and clashes with the patched
  // "minecraft" module: "Modules _1.__21 and minecraft export package ...".
  let gameJarPath = clientJarPath;
  if ((instance.loader === 'forge' || instance.loader === 'neoforge') && versionLabel !== vanillaJson.id) {
    const dest = path.join(paths.versionsDir(), versionLabel, `${versionLabel}.jar`);
    let upToDate = false;
    try {
      upToDate = fs.statSync(dest).size === fs.statSync(clientJarPath).size;
    } catch { /* not copied yet */ }
    if (!upToDate) {
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(clientJarPath, dest);
    }
    gameJarPath = dest;
  }

  report('resolve-libraries');
  const vanillaResolved = versions.resolveLibraries(vanillaJson.libraries);
  const loaderResolved = versions.resolveLibraries(loaderLibraries);
  const classpathLibs = mergeLibraries(vanillaResolved.classpathLibs, loaderResolved.classpathLibs);
  const nativeLibs = mergeLibraries(vanillaResolved.nativeLibs, loaderResolved.nativeLibs);
  // Modern (1.19+) LWJGL native jars belong on the classpath too, as in the
  // official launcher — LWJGL can then extract them itself if the flat copy
  // in java.library.path is somehow missed.
  const classpathNatives = nativeLibs.filter((l) => l.modern);

  report('download-libraries', { total: classpathLibs.length + nativeLibs.length });
  await versions.downloadLibraries(
    [...classpathLibs, ...nativeLibs],
    (p) => report('download-libraries', p)
  );

  report('extract-natives');
  const nativesTarget = paths.nativesDir(versionLabel);
  await versions.extractNatives(nativeLibs, nativesTarget);

  report('download-assets');
  const assetIndexId = await versions.downloadAssets(vanillaJson, (p) => report('download-assets', p));

  report('ready');

  return {
    vanillaJson,
    mainClass,
    versionLabel,
    javaExe,
    classpathLibs,
    classpathNatives,
    clientJarPath: gameJarPath,
    nativesTarget,
    assetIndexId,
    loaderGameArgs,
    loaderJvmArgs,
  };
}

function buildClasspath(prepared) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const libPaths = [...prepared.classpathLibs, ...(prepared.classpathNatives || [])]
    .map((l) => path.join(paths.librariesDir(), l.path));
  return [...libPaths, prepared.clientJarPath].join(sep);
}

// Makes the garbage-collector flags safe for the Java that will run the game, so a ZGC choice never prevents a start:
//  - two collectors at once ("Conflicting collector combinations") → the last one wins, the other's flags are dropped;
//  - ZGC needs Java 15+ (production-ready on Windows from 15); on older Java it is dropped and the JVM keeps its default;
//  - -XX:+ZGenerational exists only on Java 21–23 (24+ generational is the only mode and the flag is gone, <21 it is unknown
//    and the JVM refuses to start).
function fixGcArgs(args, javaMajor) {
  const COLLECTORS = ['-XX:+UseG1GC', '-XX:+UseZGC', '-XX:+UseParallelGC', '-XX:+UseSerialGC', '-XX:+UseShenandoahGC', '-XX:+UseConcMarkSweepGC'];
  const picked = [...args].reverse().find((a) => COLLECTORS.includes(a)) || null;
  const wantsZgc = picked === '-XX:+UseZGC';
  const isZFlag = (a) => /^-XX:[+-]?Z[A-Z]\w*(=.*)?$/.test(a) || a.startsWith('-XX:SoftMaxHeapSize'); // ZGC-only tuning flags
  let seen = false;
  let out = args.filter((a) => {
    if (!COLLECTORS.includes(a)) return true;
    if (a !== picked || seen) return false; // other collectors, and repeats of the chosen one
    seen = true;
    return true;
  });
  if (wantsZgc && javaMajor && javaMajor < 15) return out.filter((a) => a !== '-XX:+UseZGC' && !isZFlag(a)); // no ZGC here: JVM default stays
  if (!wantsZgc) out = out.filter((a) => !isZFlag(a)); // ZGC tuning without ZGC would be an error on some JVMs
  else if (javaMajor && (javaMajor < 21 || javaMajor >= 24)) out = out.filter((a) => !/^-XX:[+-]ZGenerational$/.test(a));
  return out;
}
function buildArgs(prepared, instance, account, settings, quickPlay = null) {
  const gameDir = paths.instanceGameDir(instance.id);
  const classpath = buildClasspath(prepared);
  const vanillaJson = prepared.vanillaJson;

  const repl = {
    auth_player_name: account.name,
    version_name: prepared.versionLabel,
    game_directory: gameDir,
    assets_root: paths.assetsDir(),
    assets_index_name: prepared.assetIndexId || vanillaJson.assets || 'legacy',
    auth_uuid: account.id,
    auth_access_token: account.minecraftAccessToken,
    auth_xuid: account.id,
    clientid: 'zorya-launcher',
    user_type: account.type === 'microsoft' ? 'msa' : 'legacy',
    version_type: vanillaJson.type || 'release',
    natives_directory: prepared.nativesTarget,
    launcher_name: 'zorya-launcher',
    launcher_version: '0.1.0',
    classpath,
    classpath_separator: process.platform === 'win32' ? ';' : ':',
    library_directory: paths.librariesDir(),
    // Pre-1.13 versions pass these as JSON blobs to Gson; an unsubstituted
    // "${user_properties}" is invalid JSON and crashes Main.main().
    user_properties: '{}',
    profile_properties: '{}',
    game_assets: paths.assetsDir(),
    resolution_width: '854',
    resolution_height: '480',
  };

  let jvmArgs;
  if (vanillaJson.arguments && vanillaJson.arguments.jvm) {
    jvmArgs = processArgList(vanillaJson.arguments.jvm, repl);
  } else {
    jvmArgs = [
      `-Djava.library.path=${prepared.nativesTarget}`,
      '-Dminecraft.launcher.brand=zorya-launcher',
      '-Dminecraft.launcher.version=0.1.0',
      '-cp',
      classpath,
    ];
  }
  // Modern Forge/NeoForge (1.17+) need extra module-path JVM flags from
  // their own profile that vanilla's arguments.jvm knows nothing about.
  jvmArgs = jvmArgs.concat(processArgList(prepared.loaderJvmArgs, repl));

  let gameArgs;
  if (vanillaJson.arguments && vanillaJson.arguments.game) {
    gameArgs = processArgList(vanillaJson.arguments.game, repl).concat(
      processArgList(prepared.loaderGameArgs, repl)
    );
  } else if (vanillaJson.minecraftArguments) {
    gameArgs = vanillaJson.minecraftArguments.split(' ').map((tok) => substitute(tok, repl))
      .concat(processArgList(prepared.loaderGameArgs, repl)); // e.g. Forge's --tweakClass
  } else {
    gameArgs = [];
  }

  // Quick Play (1.20+): jump straight into a specific world/server instead
  // of stopping at the title screen.
  if (quickPlay?.type === 'world') {
    gameArgs.push('--quickPlaySingleplayer', quickPlay.target);
  } else if (quickPlay?.type === 'server') {
    gameArgs.push('--quickPlayMultiplayer', quickPlay.target);
  }

  const maxMem = instance.maxMemoryMb || settings.maxMemoryMb;
  // Java refuses to start if the initial heap is bigger than the max (e.g. a
  // preset's min left over after the max was lowered, or a global min above
  // a per-build max), so never let -Xms exceed -Xmx.
  const minMem = Math.min(instance.minMemoryMb || settings.minMemoryMb, maxMem);
  const memArgs = [`-Xms${minMem}M`, `-Xmx${maxMem}M`];
  // Global extra args first, then this instance's own — adjusted to the Java that will really run (ZGC flags need care).
  const javaMajor = java.majorOf(java.checkJava(prepared.javaExe).version);
  const extraArgs = fixGcArgs(`${settings.javaArgs || ''} ${instance.javaArgs || ''}`.split(' ').filter(Boolean), javaMajor);

  return {
    fullArgs: [...memArgs, ...extraArgs, ...jvmArgs, prepared.mainClass, ...gameArgs],
    gameDir,
  };
}

// Game запускается отдельным процессом, не привязанным к лаунчеру (см. gameProc.js): закрыл лаунчер — игра продолжает идти.
function launchProcess(javaPath, args, gameDir, onLine, onExit, instanceId = 'game') {
  fs.mkdirSync(gameDir, { recursive: true });
  return gameProc.startDetached({
    exe: javaPath || 'java',
    args,
    cwd: gameDir,
    instanceId,
    onLine,
    onExit,
    onError: (err) => onLine && onLine(`[launcher] Failed to start Java: ${err.message}\n`),
  });
}
module.exports = { prepareInstance, buildArgs, launchProcess, buildClasspath, fixGcArgs };
