// Выбор сборщика мусора (GC) через JVM-аргументы. Лаунчер при запуске сам подчищает флаги под установленную Java
// (см. fixGcArgs в electron/mc/launch.js), так что выбор ZGC не может помешать запуску.
const COLLECTORS = ['-XX:+UseG1GC', '-XX:+UseZGC', '-XX:+UseParallelGC', '-XX:+UseSerialGC', '-XX:+UseShenandoahGC', '-XX:+UseConcMarkSweepGC'];
const G1_ONLY = /G1|MaxGCPauseMillis|InitiatingHeapOccupancyPercent|SurvivorRatio|MaxTenuringThreshold|UnlockExperimentalVMOptions/;
const Z_ONLY = /^-XX:[+-]?Z[A-Z]\w*(=.*)?$|^-XX:SoftMaxHeapSize/;

const split = (args) => String(args || '').split(/\s+/).filter(Boolean);

// 'g1' | 'zgc' | 'other' (другой сборщик) | 'default' (флагов нет — Java выберет сама, это G1)
export function detectGc(args) {
  const picked = [...split(args)].reverse().find((a) => COLLECTORS.includes(a));
  if (!picked) return 'default';
  if (picked === '-XX:+UseG1GC') return 'g1';
  if (picked === '-XX:+UseZGC') return 'zgc';
  return 'other';
}

// Ставит выбранный сборщик, остальные аргументы (память, -D… и т. п.) не трогает.
export function setGc(args, gc) {
  let list = split(args).filter((a) => !COLLECTORS.includes(a) && !/^-XX:[+-]ZGenerational$/.test(a));
  if (gc === 'zgc') {
    list = list.filter((a) => !G1_ONLY.test(a));
    list.unshift('-XX:+UseZGC', '-XX:+ZGenerational');
  } else if (gc === 'g1') {
    list = list.filter((a) => !Z_ONLY.test(a));
    list.unshift('-XX:+UseG1GC');
  } else {
    list = list.filter((a) => !Z_ONLY.test(a));
  }
  return list.join(' ');
}
