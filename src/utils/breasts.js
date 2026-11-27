// Грудь на 3D-персонаже (skinview3d) так же, как её рисует Wildfire's Female Gender Mod (GenderLayer.java, WildfireModelRenderer.java,
// BreastPhysics.java; репозиторий FemaleGenderMod/FemaleGenderMod, лицензия LGPL-3.0: здесь повторена геометрия и формулы, code мода не копировался):
//   • две коробки 4×5×3 пикселя (левая x −4..0, правая x 0..4; y внof, перед — в −z), повешенные за верхний край на груди;
//   • размер: bSize = bust_size, size = min(bSize·1.5, 0.7) (для bSize > 0.7 — bSize), затем size += |bSize − 0.7|; наклон коробки
//     вокруг X на −35° · min(size − фofика/12, size + 0.2, 1), разрез — поворот вокруг Y на min(round(cleavage·100), 10)°;
//   • смещения: x ±round(xOffset, 1), y 0.9 − round(yOffset, 1), z (1 − bSize) − 2 − round(zOffset, 1)·0.68 (в пикселях скина);
//   • текстуры коробок вырезаны of самого скина по раскладкам мода (of файла игрока), второй слой («куртка») — на 5 % крупнее и на 0.24 px
//     вперёд; сторона south не рисуется; квадраты с нулевой раскладкой пропускаются;
//   • фofика (если включена): пружинная модель BreastPhysics — вертикаль, горofонталь и поворот, 20 тиков в секунду, свои для каждой
//     груди (при «единой груди» одна на обе), с теми же коэффициентами; вход — движение тела по вертикали (в игре это шаги, прыжки,
//     повороты и взмахи руки; здесь только прыжок, см. jump()) и дыхание: лёгкое покачивание на 0..0.9°.
//   const ctrl = attachBreasts(viewer, { onHeight });  ctrl.update(settings | null);  ctrl.jump();  ...  ctrl.dispose();
// settings — как отдаёт electron/mc/genderMod.js (+ uv: раскладки of файла игрока, если есть); null или gender === 'male' — груди нет.
// onHeight(блоки) вызывается каждый кадр, пока идёт прыжок (высота над землёй в блоках, 1 блок = 16 px), и 0 в конце.
import {
  BufferAttribute, BufferGeometry, Group, Mesh, Quaternion, Vector3,
} from 'three';

const r = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
// Раскладки мода по умолчанию (как в файле, который мод пишет сам)
const DEFAULT_UV = {
  leftBreastUVLayout: { east: r(24, 21, 27, 26), west: r(16, 21, 20, 26), down: r(20, 17, 24, 21), up: r(20, 25, 24, 27), north: r(20, 21, 24, 26) },
  rightBreastUVLayout: { east: r(28, 21, 32, 26), west: r(21, 21, 24, 26), down: r(24, 17, 28, 21), up: r(24, 25, 28, 27), north: r(24, 21, 28, 26) },
  leftBreastOverlayUVLayout: { east: r(0, 0, 0, 0), west: r(17, 37, 20, 42), down: r(20, 34, 24, 37), up: r(20, 42, 24, 45), north: r(20, 37, 24, 42) },
  rightBreastOverlayUVLayout: { east: r(28, 37, 31, 42), west: r(0, 0, 0, 0), down: r(24, 34, 28, 37), up: r(24, 42, 28, 45), north: r(24, 37, 28, 42) },
};

// Стороны коробки в порядке мода и их вершины (индексы в списке of 8 углов, см. ModelBox.initQuads), внешняя нормаль в системе мода
const FACES = [
  ['east', [4, 0, 1, 5], [1, 0, 0]],
  ['west', [7, 3, 6, 2], [-1, 0, 0]],
  ['down', [4, 3, 7, 0], [0, -1, 0]],
  ['up', [1, 2, 6, 5], [0, 1, 0]],
  ['north', [0, 7, 2, 1], [0, 0, -1]],
];

const faceValid = (f) => f && [f.x1, f.y1, f.x2, f.y2].every((v) => Number.isFinite(v)) && !(f.x1 === 0 && f.y1 === 0 && f.x2 === 0 && f.y2 === 0);

// Коробка (x1,y1,z1)+(dx,dy,dz) в системе мода; текстурные координаты как в TexturedQuad: вершины 0..3 → (u2,v1) (u1,v1) (u1,v2) (u2,v2).
function boxGeometry(x1, y1, z1, dx, dy, dz, layout) {
  const x2 = x1 + dx; const y2 = y1 + dy; const z2 = z1 + dz;
  const c = [[x2, y1, z1], [x2, y2, z1], [x1, y2, z1], [x1, y1, z2], [x2, y1, z2], [x2, y2, z2], [x1, y2, z2], [x1, y1, z1]];
  const pos = []; const uv = []; const nor = []; const idx = [];
  for (const [side, vi, out] of FACES) {
    const f = layout && layout[side];
    if (!faceValid(f)) continue;
    const q = vi.map((i) => c[i]);
    const base = pos.length / 3;
    const tex = [[f.x2, f.y1], [f.x1, f.y1], [f.x1, f.y2], [f.x2, f.y2]];
    for (let k = 0; k < 4; k += 1) {
      pos.push(...q[k]);
      uv.push(tex[k][0] / 64, 1 - tex[k][1] / 64);
      nor.push(...out);
    }
    // the winding that makes the face look outwards (three culls the other side)
    const p0 = new Vector3(...q[0]); const p1 = new Vector3(...q[1]); const p2 = new Vector3(...q[2]);
    const n = p1.sub(p0).cross(p2.sub(p0));
    if (n.x * out[0] + n.y * out[1] + n.z * out[2] >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;
const Y_AXIS = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);

// BreastPhysics.java: the spring model of one breast; tick() is one game tick (1/20 s)
class Physics {
  constructor(size) {
    this.breastSize = size; this.preBreastSize = size;
    this.bounceVelX = 0; this.targetBounceX = 0; this.velocityX = 0; this.positionX = 0; this.prePositionX = 0;
    this.bounceVel = 0; this.targetBounceY = 0; this.velocity = 0; this.positionY = 0; this.prePositionY = 0;
    this.bounceRotVel = 0; this.targetRotVel = 0; this.rotVelocity = 0; this.bounceRotation = 0; this.preBounceRotation = 0;
    this.randomB = 1; this.lastV = 0;
  }

  // c: { bust, bounce, floppy, uniboob }; motionY — how far the body moved up this tick (blocks), vy — its vertical speed (blocks/tick)
  tick(c, motionY, vy) {
    this.prePositionY = this.positionY; this.prePositionX = this.positionX; this.preBounceRotation = this.bounceRotation; this.preBreastSize = this.breastSize;
    const target = c.bust;
    const weight = target * 1.25;
    this.breastSize += this.breastSize < target ? Math.abs(this.breastSize - target) / 2 : -Math.abs(this.breastSize - target) / 2;
    let intensity = target * 3 * (Math.round(c.bounce * 3 * 100) / 100);
    if (!c.uniboob) intensity *= 0.5 + Math.random() * 2; // Mth.randomBetween(random, 0.5F, 2.5F)

    // tickMovement: which side the breast leans to when the player jumps, then the targets of the three springs
    if ((this.lastV <= 0 && vy > 0) || (this.lastV < 0 && vy === 0)) this.randomB = Math.random() < 0.5 ? -1 : 1;
    this.lastV = vy;
    this.targetBounceY = motionY * intensity + weight;
    this.targetRotVel = motionY * intensity * this.randomB; // (no turning of the body here)
    this.targetBounceX = 0;

    // finishTick
    const percent = c.floppy;
    const bounceAmount = clamp(0.45 * (1 - percent) + 0.15, 0.15, 0.6);
    const delta = 2.25 - bounceAmount;
    const distanceFromMin = Math.abs(this.bounceVel + 1.5) * 0.5;
    const distanceFromMax = Math.abs(this.bounceVel - 2.65) * 0.5;
    if (this.bounceVel < -0.5) this.targetBounceY += distanceFromMin;
    if (this.bounceVel > 2.5) this.targetBounceY -= distanceFromMax;
    this.targetBounceY = clamp(this.targetBounceY, -1.5, 2.5);
    this.targetRotVel = clamp(this.targetRotVel, -25, 25);
    this.velocity = lerp(this.velocity, (this.targetBounceY - this.bounceVel) * delta, bounceAmount);
    this.bounceVel += this.velocity * percent * 1.1625;
    this.velocityX = lerp(this.velocityX, (this.targetBounceX - this.bounceVelX) * delta, bounceAmount);
    this.bounceVelX += this.velocityX * percent;
    this.rotVelocity = lerp(this.rotVelocity, (this.targetRotVel - this.bounceRotVel) * delta, bounceAmount);
    this.bounceRotVel += this.rotVelocity * percent;
    this.bounceRotation = this.bounceRotVel;
    this.positionX = this.bounceVelX;
    this.positionY = this.bounceVel;
    if (this.positionY < -0.5) this.positionY = -0.5;
    if (this.positionY > 1.5) { this.positionY = 1.5; this.velocity = 0; }
  }
}

export function attachBreasts(viewer, { onHeight } = {}) {
  const skin = viewer.playerObject.skin;
  // The mod works in Minecraft's model frame (origin: top of the torso, y down, front towards −z); skinview3d has the origin in the middle of the
  // torso with y up and the front towards +z: the same frame turned by 180° around X, shifted by half the torso height.
  const frame = new Group();
  frame.name = 'eternal-breasts';
  frame.position.set(0, 6, 0);
  frame.rotation.x = Math.PI;
  skin.body.add(frame);

  let settings = null;
  let sides = []; // [{ left, sign, side, pivot, back, tilt, physics }]
  let anim = null; // { id, target } the animation the per-frame callback is registered in
  let derived = null; // numbers computed from the settings (see rebuild)
  const geos = [];
  // the vertical motion of the body: a jump is simulated with the speeds of the game (0.42 blocks/tick up, gravity 0.08, drag 0.98)
  let jumpV = 0; let jumpY = 0; let prevJumpY = 0; let jumping = false;
  let acc = 0; let last = performance.now(); const t0 = last;

  function clear() {
    for (const s of sides) frame.remove(s.side);
    sides = [];
    for (const g of geos.splice(0)) g.dispose();
  }

  function physicsCfg() {
    return {
      bust: derived.bSize, bounce: clamp(num(settings.bounce_multiplier, 0.5), 0, 1), floppy: clamp(num(settings.floppy_multiplier, 0.5), 0, 1), uniboob: !!settings.breasts_uniboob,
    };
  }

  function rebuild() {
    clear();
    const s = settings;
    if (!s || s.gender === 'male') { frame.visible = false; derived = null; return; }
    const bSize = clamp(num(s.bust_size, 0.6), 0, 1);
    let size = Math.min(bSize * 1.5, 0.7);
    if (bSize > 0.7) size = bSize;
    if (size < 0.02) { frame.visible = false; derived = null; return; } // as in the mod: too small to draw
    frame.visible = true;
    size += 0.5 * Math.abs(bSize - 0.7) * 2;
    derived = {
      bSize,
      size,
      uni: !!s.breasts_uniboob,
      physics: !!s.breast_physics,
      outward: Math.min(Math.round(Math.max(0, num(s.breasts_cleavage, 0)) * 100), 10),
      offX: round1(num(s.breasts_xOffset, 0)),
      offY: -round1(num(s.breasts_yOffset, 0)),
      offZ: -round1(num(s.breasts_zOffset, 0)),
    };
    const uv = { ...DEFAULT_UV, ...(s.uv || {}) };
    for (const left of [true, false]) {
      const sign = left ? 1 : -1; // BreastSide.leftOrNegate
      // side: translations (offsets and physics); pivot/back: rotation of the bounce around the middle of the breast; tilt: the final turn
      const side = new Group();
      const pivot = new Group();
      const back = new Group();
      const tilt = new Group();
      side.add(pivot); pivot.add(back); back.add(tilt);
      const main = new Mesh(boxGeometry(left ? -4 : 0, 0, 0, 4, 5, 3, left ? uv.leftBreastUVLayout : uv.rightBreastUVLayout), skin.layer1Material);
      geos.push(main.geometry);
      tilt.add(main);
      // the second layer ("jacket"): 5 % bigger, a bit forward, drawn over the first
      const wear = new Group();
      wear.position.set(0, 0, -0.24);
      wear.scale.set(1.05, 1.05, 1.05);
      const overlay = new Mesh(boxGeometry(left ? -4 : 0, 0, 0, 4, 5, 3, left ? uv.leftBreastOverlayUVLayout : uv.rightBreastOverlayUVLayout), skin.layer2Material);
      geos.push(overlay.geometry);
      overlay.renderOrder = 1;
      wear.add(overlay);
      tilt.add(wear);
      tilt.scale.set(0.9995, 1, 1);
      if (!derived.uni) { pivot.position.x = -2 * sign; back.position.x = 2 * sign; } // T(−2)·R·T(+2): the bounce turns the breast around its own middle
      frame.add(side);
      sides.push({ left, sign, side, pivot, back, tilt, physics: new Physics(bSize) });
    }
    acc = 0;
    // warm up: the springs settle into the pose of a standing player, as they have in the game by the time one looks
    if (derived.physics) for (let i = 0; i < 120; i += 1) stepPhysics(0, 0);
    pose(1);
  }

  function stepPhysics(motionY, vy) {
    const cfg = physicsCfg();
    sides[0].physics.tick(cfg, motionY, vy);
    if (derived.uni) { // one breast's numbers are used for both
      const a = sides[0].physics; const b = sides[1].physics;
      Object.assign(b, a);
    } else {
      sides[1].physics.tick(cfg, motionY, vy);
    }
  }

  // Sets the transforms of both breasts; alpha: how far between the previous tick and the current one we are
  function pose(alpha) {
    if (!derived || !sides.length) return;
    const d = derived;
    const ticks = ((performance.now() - t0) / 1000) * 20;
    const breath = -Math.cos(ticks * 0.09) * 0.45 + 0.45; // degrees, as in the mod
    const q = new Quaternion(); const qx = new Quaternion();
    for (const s of sides) {
      const p = s.physics;
      const posX = d.physics ? lerp(p.prePositionX, p.positionX, alpha) : 0;
      const posY = d.physics ? lerp(p.prePositionY, p.positionY, alpha) : 0;
      const rot = d.physics ? lerp(p.preBounceRotation, p.bounceRotation, alpha) : 0;
      // translate(±offX + physX/2, 0.9 + offY + physY/2, (1 − bSize) − 2 + offZ·0.68) px (the mod's physX/32 blocks)
      s.side.position.set(s.sign * d.offX + posX / 2, 0.9 + d.offY + posY / 2, (1 - d.bSize) - 2 + d.offZ * 0.68);
      s.pivot.rotation.y = rot * DEG; // Axis.YP.rotationDegrees(bounce rotation)
      let rotation = d.size;
      s.back.position.y = 0;
      if (d.physics) { s.back.position.y = -0.56 * d.size; rotation -= posY / 12; } // translate(0, −0.035·size blocks, 0)
      rotation = Math.min(rotation, d.size + 0.2);
      rotation = Math.min(rotation, 1);
      q.setFromAxisAngle(Y_AXIS, s.sign * d.outward * DEG);
      qx.setFromAxisAngle(X_AXIS, (-35 * rotation + breath) * DEG);
      s.tilt.quaternion.copy(q.multiply(qx));
    }
  }

  // Once per frame: the game ticks of the physics (20 a second), the jump of the body, then the pose of the breasts
  function frameTick() {
    if (!derived || !sides.length) return;
    const now = performance.now();
    acc += Math.min(0.25, (now - last) / 1000) * 20; // ticks (a long pause, e.g. a hidden window, does not make a burst)
    last = now;
    while (acc >= 1) {
      acc -= 1;
      prevJumpY = jumpY;
      let motionY = 0; let vy = 0;
      if (jumping) {
        // one tick of the game's own physics: move by the current speed, then gravity and drag; the ground stops the fall
        const prevY = jumpY;
        const v0 = jumpV;
        let nextY = prevY + v0;
        jumpV = (v0 - 0.08) * 0.98;
        if (nextY <= 0) { nextY = 0; jumpV = 0; jumping = false; }
        motionY = nextY - prevY; // how far the body really went in this tick (negative on the way down)
        jumpY = nextY;
        vy = jumpV;
      }
      if (derived.physics) stepPhysics(motionY, vy);
    }
    // the height between two game ticks is interpolated, like the pose of the breasts: the picture moves at the frame rate, not at 20 steps a second
    if (onHeight) onHeight(jumping || jumpY !== 0 || prevJumpY !== 0 ? lerp(prevJumpY, jumpY, acc) : 0);
    pose(acc);
  }

  function start() {
    if (anim || !viewer.animation) return; // the pages set an idle animation right after creating the viewer; update() tries again
    anim = { target: viewer.animation, id: viewer.animation.addAnimation(frameTick) };
  }

  return {
    update(next) {
      settings = next || null;
      rebuild();
      start();
    },
    // One jump (the push-off of a player: 0.42 blocks up, then the fall); the physics of the breasts follows it
    jump() {
      if (jumping) return;
      jumping = true;
      jumpV = 0.42;
      jumpY = 0;
    },
    dispose() {
      try { if (anim) anim.target.removeAnimation(anim.id); } catch { /* the animation is gone with the viewer */ }
      anim = null;
      clear();
      skin.body.remove(frame);
    },
  };
}
