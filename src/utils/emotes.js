// Проигрыватель эмоций в формате Emotecraft (.json) для 3D-персонажа (skinview3d).
// File эмоции — ключевые кадры по тикам (20 тиков = 1 секунда) для частей тела: head, torso, rightArm, leftArm, rightLeg, leftLeg.
// У каждой части: pitch / yaw / roll (повороты, радианы при "degrees": false), x / y / z (положение, как в модели Minecraft), bend.
// Положение и повороты записаны в системе координат модели Minecraft; у skinview3d ось Y направлена вверх, а лицом персонаж
// смотрит в +Z, поэтому знаки у Y и Z меняются (см. toSkin ниже). Сгиба локтя (bend у рук) у нашей модели нет — он не проигрывается,
// поэтому берутся эмоции без него (src/assets/emotes).

const EASE_FAMILY = {
  SINE: { in: (t) => 1 - Math.cos((t * Math.PI) / 2), out: (t) => Math.sin((t * Math.PI) / 2) },
  QUAD: { in: (t) => t * t, out: (t) => 1 - (1 - t) * (1 - t) },
  CUBIC: { in: (t) => t ** 3, out: (t) => 1 - (1 - t) ** 3 },
  QUART: { in: (t) => t ** 4, out: (t) => 1 - (1 - t) ** 4 },
  QUINT: { in: (t) => t ** 5, out: (t) => 1 - (1 - t) ** 5 },
  EXPO: { in: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)), out: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)) },
  CIRC: { in: (t) => 1 - Math.sqrt(1 - t * t), out: (t) => Math.sqrt(1 - (t - 1) ** 2) },
};

// "EASEINOUTQUAD" -> function(t in 0..1). Unknown names are linear; CONSTANT holds the previous value until the next key.
export function easeFn(name) {
  const n = String(name || 'LINEAR').toUpperCase();
  if (n === 'CONSTANT') return () => 0;
  const m = /^EASE(INOUT|IN|OUT)(SINE|QUAD|CUBIC|QUART|QUINT|EXPO|CIRC)$/.exec(n);
  if (!m) return (t) => t;
  const f = EASE_FAMILY[m[2]];
  if (m[1] === 'IN') return f.in;
  if (m[1] === 'OUT') return f.out;
  return (t) => (t < 0.5 ? f.in(t * 2) / 2 : 1 - f.in((1 - t) * 2) / 2); // symmetric in-out
}

const PARTS = ['head', 'torso', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
const PROPS = ['pitch', 'yaw', 'roll', 'x', 'y', 'z', 'bend'];

// Raw file -> { name, author, begin, end, ret, loop, tracks: { "head.pitch": [{ tick, v, ease }] }, seconds }
export function parseEmote(raw) {
  const e = raw && raw.emote;
  if (!e || !Array.isArray(e.moves)) throw new Error('This is not an emotion file');
  if (e.degrees === true || e.degrees === 'true') throw new Error('Emotions in degrees are not supported');
  const tracks = {};
  for (const m of e.moves) {
    const tick = Number(m.tick);
    if (!Number.isFinite(tick)) continue;
    for (const part of PARTS) {
      const block = m[part];
      if (!block || typeof block !== 'object') continue;
      for (const prop of PROPS) {
        const v = Number(block[prop]);
        if (block[prop] === undefined || !Number.isFinite(v)) continue;
        const key = `${part}.${prop}`;
        (tracks[key] = tracks[key] || []).push({ tick, v, ease: easeFn(m.easing) });
      }
    }
  }
  for (const list of Object.values(tracks)) list.sort((a, b) => a.tick - b.tick);
  const begin = Number(e.beginTick) || 0;
  const end = Number(e.endTick) || Math.max(0, ...Object.values(tracks).map((t) => t[t.length - 1].tick));
  return {
    name: raw.name || '', author: raw.author || '', begin, end, ret: Number(e.returnTick) || 0, loop: e.isLoop === true || e.isLoop === 'true', tracks, seconds: (end - begin) / 20,
  };
}

// Value of one track at `tick`. Before the first key the value eases in from `base` (the pose the part had when the emote started).
function sampleTrack(list, tick, begin, base) {
  const first = list[0];
  if (tick <= first.tick) {
    if (first.tick <= begin) return first.v;
    const k = Math.max(0, (tick - begin) / (first.tick - begin));
    return base + (first.v - base) * first.ease(k);
  }
  const last = list[list.length - 1];
  if (tick >= last.tick) return last.v;
  let i = 0;
  while (i < list.length - 2 && list[i + 1].tick <= tick) i += 1;
  const a = list[i];
  const b = list[i + 1];
  const k = (tick - a.tick) / (b.tick - a.tick);
  return a.v + (b.v - a.v) * b.ease(k);
}

// Pose of the model in the Minecraft frame -> skinview3d: Y and Z of positions flip; rotation about Y and Z flips, about X stays.
const toSkin = {
  pitch: (v) => v, yaw: (v) => -v, roll: (v) => -v, x: (v) => v, y: (v) => -v, z: (v) => -v,
};
const BODY_NODE = { head: 'head', torso: 'body', rightArm: 'rightArm', leftArm: 'leftArm', rightLeg: 'rightLeg', leftLeg: 'leftLeg' };

// What the model looked like before the emote: positions and rotations of the six parts (restored when it ends).
export function snapshotRest(player) {
  const rest = {};
  for (const [part, node] of Object.entries(BODY_NODE)) {
    const n = player.skin[node];
    rest[part] = { pos: n.position.clone(), rot: [n.rotation.x, n.rotation.y, n.rotation.z], order: n.rotation.order };
  }
  return rest;
}

export function restoreRest(player, rest) {
  for (const [part, node] of Object.entries(BODY_NODE)) {
    const n = player.skin[node];
    const r = rest[part];
    n.position.copy(r.pos);
    n.rotation.order = r.order;
    n.rotation.set(r.rot[0], r.rot[1], r.rot[2]);
  }
}

// Puts the model into the pose of `tick` (weight 0..1 blends from what it was doing before: idle breathing, etc.).
export function applyEmote(player, emote, tick, weight, rest) {
  const w = Math.min(1, Math.max(0, weight));
  for (const [part, node] of Object.entries(BODY_NODE)) {
    const n = player.skin[node];
    const base = rest[part];
    const hasAny = PROPS.some((p) => emote.tracks[`${part}.${p}`]);
    if (!hasAny) continue;
    n.rotation.order = 'ZYX'; // Minecraft applies Z, then Y, then X
    // the blend starts from the pose the part had when the emote began (not from last frame's value, which would smear the blend over frames)
    for (const [prop, axis, i] of [['pitch', 'x', 0], ['yaw', 'y', 1], ['roll', 'z', 2]]) {
      const list = emote.tracks[`${part}.${prop}`];
      if (!list) continue;
      const from = base.rot[i];
      const target = toSkin[prop](sampleTrack(list, tick, emote.begin, 0));
      n.rotation[axis] = from + (target - from) * w;
    }
    // positions are absolute in the model frame (the shoulder of the right arm is at x = -5, y = 2): turned into skinview3d's frame
    for (const [prop, axis] of [['x', 'x'], ['y', 'y'], ['z', 'z']]) {
      const list = emote.tracks[`${part}.${prop}`];
      if (!list) continue;
      const baseMc = axis === 'x' ? base.pos.x : axis === 'y' ? -base.pos.y : -base.pos.z; // the part's resting position in the Minecraft frame
      const target = toSkin[prop](sampleTrack(list, tick, emote.begin, baseMc));
      n.position[axis] = base.pos[axis] + (target - base.pos[axis]) * w;
    }
  }
}

// An animation function for skinview3d's `animation.addAnimation((player, progress) => ...)`: plays the emote `loops` times (a looping emote
// repeats its body from returnTick) and eases back to rest. onDone() is called once when it has finished.
export function makeEmoteAnimation(emote, { loops = 1, fadeIn = 0.25, fadeOut = 0.6, onDone } = {}) {
  let rest = null;
  let finished = false;
  const bodyTicks = Math.max(1, emote.end - emote.ret);
  const totalTicks = (emote.end - emote.begin) + (emote.loop ? (loops - 1) * bodyTicks : 0);
  const seconds = totalTicks / 20;
  const total = seconds + fadeOut;
  const fn = (player, progress) => {
    if (finished) return;
    if (!rest) rest = snapshotRest(player);
    if (progress >= total) {
      finished = true;
      restoreRest(player, rest);
      if (onDone) onDone();
      return;
    }
    let tick = emote.begin + progress * 20;
    if (emote.loop && tick > emote.end) tick = emote.ret + ((tick - emote.ret) % bodyTicks);
    if (!emote.loop) tick = Math.min(tick, emote.end);
    const wIn = fadeIn > 0 ? Math.min(1, progress / fadeIn) : 1;
    const wOut = progress > seconds ? 1 - (progress - seconds) / fadeOut : 1;
    const weight = Math.min(wIn, Math.max(0, wOut));
    // eased, so the pose slides in and out instead of moving at a constant speed
    applyEmote(player, emote, tick, -(Math.cos(Math.PI * weight) - 1) / 2, rest);
  };
  fn.total = total;
  fn.isFinished = () => finished;
  fn.cancel = (player) => { if (rest && !finished) { finished = true; restoreRest(player, rest); } };
  return fn;
}
