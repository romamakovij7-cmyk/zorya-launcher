// Глаза, брови и ресницы пака Fresh Moves на 3D-персонаже (skinview3d), так же, как их рисует игра с модами Entity Model Features и
// Entity Texture Features: пак (assets/minecraft/optifine/cem/player.jem) добавляет к голове маленькие плоские коробки, а их текстура
// берётся прямо из скина — из свободных углов раскладки (0..8 × 0..8, 24..40 × 0..8, 56..64 × 0..8), которые обычный скин не использует.
// Если в этих углах у скина есть непрозрачные пиксели, глаза у него «проработаны»; если нет — коробки прозрачны и ничего не видно.
//   • геометрия — из src/assets/freshmoves/eyes.json (его строит scripts/gen-fresh-eyes.js по player.jem; сам пак в лаунчер не входит);
//   • рисуются только те стороны, под которыми в скине есть пиксели (24 варианта глаз, брови, ресницы лежат в разных местах скина);
//   • глаза в покое: зрачок по центру, веко-«моргание» — глаза сплющиваются сверху вниз раз в несколько seconds (в игре веко рисуется
//     цветом кожи; здесь без этого). Движение зрачков за взглядом и бровей не воспроизводится.
//   const ctrl = attachFreshEyes(viewer, { onInfo });  ctrl.update({ enabled, blink });  ctrl.dispose();
// onInfo({ present, eyes, brows, extras, variants }) вызывается при каждой смене скина.
import {
  BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial,
} from 'three';
import data from '../assets/freshmoves/eyes.json';

// Углы стороны в порядке (u1,v1) (u2,v1) (u1,v2) (u2,v2) прямоугольника текстуры [u1,v1,u2,v2]; система skinview3d (перед +z, x вправо на экране).
// Названия сторон — как в player.jem (модель смотрит в −z, поэтому north = лицо = +z у нас, east = −x, west = +x); раскладка калибрована по
// самой голове (uvNorth 8,8..16,16; uvUp 16,8..8,0; uvDown 24,0..16,8 дают те же места текстуры, что и в skinview3d).
const FACE = {
  north: { n: [0, 0, 1], c: (a, b) => [[a[0], b[1], b[2]], [b[0], b[1], b[2]], [a[0], a[1], b[2]], [b[0], a[1], b[2]]] },
  south: { n: [0, 0, -1], c: (a, b) => [[b[0], b[1], a[2]], [a[0], b[1], a[2]], [b[0], a[1], a[2]], [a[0], a[1], a[2]]] },
  east: { n: [-1, 0, 0], c: (a, b) => [[a[0], b[1], a[2]], [a[0], b[1], b[2]], [a[0], a[1], a[2]], [a[0], a[1], b[2]]] },
  west: { n: [1, 0, 0], c: (a, b) => [[b[0], b[1], b[2]], [b[0], b[1], a[2]], [b[0], a[1], b[2]], [b[0], a[1], a[2]]] },
  up: { n: [0, 1, 0], c: (a, b) => [[b[0], b[1], b[2]], [a[0], b[1], b[2]], [b[0], b[1], a[2]], [a[0], b[1], a[2]]] },
  down: { n: [0, -1, 0], c: (a, b) => [[b[0], a[1], a[2]], [a[0], a[1], a[2]], [b[0], a[1], b[2]], [a[0], a[1], b[2]]] },
};

const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];

// Прямоугольник стороны после зеркала части (mirrorTexture u / v меняет местами края)
function faceRect(part, rect) {
  let [u1, v1, u2, v2] = rect;
  const m = part.mirror || '';
  if (m.includes('u')) [u1, u2] = [u2, u1];
  if (m.includes('v')) [v1, v2] = [v2, v1];
  return [u1, v1, u2, v2];
}

// Есть ли в прямоугольнике (в единицах 64×64) хоть один непрозрачный пиксель; img — ImageData всего скина
function hasPixels(img, rect) {
  const s = img.width / 64;
  const x1 = Math.floor(Math.min(rect[0], rect[2]) * s); const x2 = Math.ceil(Math.max(rect[0], rect[2]) * s);
  const y1 = Math.floor(Math.min(rect[1], rect[3]) * s); const y2 = Math.ceil(Math.max(rect[1], rect[3]) * s);
  for (let y = Math.max(0, y1); y < Math.min(img.height, y2); y += 1) {
    for (let x = Math.max(0, x1); x < Math.min(img.width, x2); x += 1) if (img.data[(y * img.width + x) * 4 + 3] > 8) return true;
  }
  return false;
}

// Одна геометрия из набора коробок: faces — [{ part, side, rect }]
function buildGeometry(items) {
  const pos = []; const uv = []; const nor = []; const idx = [];
  for (const { part, side, rect } of items) {
    const f = FACE[side];
    const a = [part.origin[0] + part.min[0], part.origin[1] + part.min[1], part.origin[2] + part.min[2]];
    const b = [part.origin[0] + part.max[0], part.origin[1] + part.max[1], part.origin[2] + part.max[2]];
    const q = f.c(a, b);
    const tex = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[0], rect[3]], [rect[2], rect[3]]];
    const base = pos.length / 3;
    for (let k = 0; k < 4; k += 1) { pos.push(...q[k]); uv.push(tex[k][0] / 64, 1 - tex[k][1] / 64); nor.push(...f.n); }
    const n = cross(sub(q[1], q[0]), sub(q[2], q[0]));
    if (n[0] * f.n[0] + n[1] * f.n[1] + n[2] * f.n[2] >= 0) idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    else idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}

const EMPTY = { present: false, eyes: false, brows: false, extras: false, variants: [] };

export function attachFreshEyes(viewer, { onInfo } = {}) {
  const skin = viewer.playerObject.skin;
  const holder = new Group(); // в системе головы: начало — шея
  holder.name = 'zorya-fresh-eyes';
  skin.head.add(holder);
  // Свой материал, а не layer2Material скина: у него общий с «шапкой» порог прозрачности (1e-5) пропускает почти невидимые пиксели шапки
  // перед лицом, и они закрывают глаза по глубине; у игры порог 0.1 (cutout)
  const material = new MeshStandardMaterial({ side: DoubleSide, transparent: true, alphaTest: 0.1 });
  let opts = { enabled: true, blink: true };
  let info = EMPTY;
  let seen = null; // текстура скина, по которой построены коробки
  let eyeGroup = null; let eyeMesh = null; let staticMesh = null; let pivotY = 0;
  let anim = null;
  let nextBlink = performance.now() + 1500; let blinkStart = -1;

  function clear() {
    for (const m of [eyeMesh, staticMesh]) if (m) m.geometry.dispose();
    holder.clear();
    eyeGroup = null; eyeMesh = null; staticMesh = null;
  }

  function rebuild() {
    clear();
    const canvas = viewer.skinCanvas;
    if (!canvas || !canvas.width) { info = EMPTY; return; }
    let img;
    try { img = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height); } catch { info = EMPTY; return; }
    const eyeItems = []; const staticItems = []; const found = new Map(); const groups = new Set();
    for (const part of data.parts) {
      if (part.blink) continue; // веко: см. моргание ниже
      for (const [side, rect0] of Object.entries(part.uv)) {
        if (!FACE[side]) continue;
        const rect = faceRect(part, rect0);
        if (!hasPixels(img, rect)) continue;
        (part.group === 'eye' ? eyeItems : staticItems).push({ part, side, rect });
        if (part.group === 'eye') {
          const key = `${part.variant}${part.side}`;
          const kinds = found.get(key) || new Set();
          kinds.add(/white/.test(part.id) ? 'white' : /pupil/.test(part.id) ? 'pupil' : 'base');
          found.set(key, kinds);
        } else groups.add(part.group);
      }
    }
    // Глаз «проработан», если у него есть и белок, и зрачок: так не принимаются за глаза случайные пиксели в углах скина (палитры, подписи)
    const complete = new Set([...found].filter(([, k]) => k.has('white') && k.has('pupil')).map(([key]) => key));
    const ok = (part) => complete.has(`${part.variant}${part.side}`);
    for (let i = eyeItems.length - 1; i >= 0; i -= 1) if (!ok(eyeItems[i].part)) eyeItems.splice(i, 1);
    if (!complete.size) { staticItems.length = 0; groups.clear(); } // брови и ресницы без глаз не показываются
    const variants = new Set(eyeItems.map((i) => i.part.variant));
    info = { present: complete.size > 0, eyes: complete.size > 0, brows: groups.has('brow'), extras: groups.has('extra'), variants: [...variants].sort((x, y) => x - y) };
    if (eyeItems.length) {
      // моргание — сплющивание глаз вокруг их верхнего края
      pivotY = Math.max(...eyeItems.map((i) => i.part.origin[1] + i.part.max[1]));
      eyeGroup = new Group();
      eyeGroup.position.y = pivotY;
      eyeMesh = new Mesh(buildGeometry(eyeItems), material);
      eyeMesh.position.y = -pivotY;
      eyeMesh.renderOrder = 2;
      eyeGroup.add(eyeMesh);
      holder.add(eyeGroup);
    }
    if (staticItems.length) {
      staticMesh = new Mesh(buildGeometry(staticItems), material);
      staticMesh.renderOrder = 2;
      holder.add(staticMesh);
    }
    holder.visible = opts.enabled;
  }

  function tick() {
    const tex = viewer.skinTexture;
    if (tex !== seen) {
      seen = tex;
      material.map = tex; material.needsUpdate = true;
      if (tex) { rebuild(); if (onInfo) onInfo(info); }
    }
    if (!eyeGroup || !opts.enabled) return;
    const now = performance.now();
    let k = 1;
    if (opts.blink) {
      if (blinkStart < 0 && now >= nextBlink) blinkStart = now;
      if (blinkStart >= 0) {
        const t = (now - blinkStart) / 160; // одно моргание 160 мс: быстро закрылись и открылись
        if (t >= 1) { blinkStart = -1; nextBlink = now + 2200 + Math.random() * 3800; } else k = Math.max(0.12, Math.abs(1 - 2 * t));
      }
    }
    eyeGroup.scale.y = k;
  }

  function start() {
    if (anim || !viewer.animation) return;
    anim = { target: viewer.animation, id: viewer.animation.addAnimation(tick) };
  }
  start();

  return {
    update(next) {
      opts = { ...opts, ...(next || {}) };
      holder.visible = opts.enabled !== false;
      if (eyeGroup && (!opts.blink || !opts.enabled)) eyeGroup.scale.y = 1;
      start(); // страница ставит анимацию сразу после создания просмотра; на первом update она уже есть
    },
    info: () => info,
    dispose() {
      try { if (anim) anim.target.removeAnimation(anim.id); } catch { /* анимация исчезла вместе с просмотром */ }
      anim = null;
      clear();
      material.dispose();
      skin.head.remove(holder);
    },
  };
}
