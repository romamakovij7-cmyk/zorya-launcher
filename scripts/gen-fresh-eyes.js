// Строит src/assets/freshmoves/eyes.json из модели пака Fresh Moves (assets/minecraft/optifine/cem/player.jem).
//   node scripts/gen-fresh-eyes.js <player.jem> [выходной.json]
// В файл попадают только части головы, которые показывают глаза, брови и ресницы: каждая коробка в координатах skinview3d (начало — шея,
// y вверх, перед лица — +z; у модели пака y вверх, перед — −z, x зеркален), её текстурные области в скине и признак «веко» (моргание).
// Сам пак в лаунчер не входит: он (CC BY-NC-SA 4.0) скачивается у автора на Modrinth.
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
const out = process.argv[3] || path.join(__dirname, '..', 'src', 'assets', 'freshmoves', 'eyes.json');
if (!src || !fs.existsSync(src)) { console.error('Укажите путь к player.jem'); process.exit(1); }
const jem = JSON.parse(fs.readFileSync(src, 'utf8'));
const head = jem.models.find((m) => m.part === 'head' || m.id === 'head');
const HEAD_BASE_Y = 24; // низ головы в координатах модели (translate головы −24, коробка головы y 24..32)

// Постоянные масштабы из анимаций пака: "right_eye_white.sx = 2"
// Варианты 2..24 ссылаются на первый: "right_eye_white2.sx = right_eye_white.sx" — ссылки раскрываются; выражения от взгляда
// (clamp(1 - r_eye_top.ty ...)) в покое равны 1 и остаются без изменений.
const scales = {}; // part id -> { sx, sy, sz }
const raw = {}; // "part.sx" -> выражение
(function walk(models) {
  for (const m of models || []) {
    for (const a of m.animations || []) for (const [k, v] of Object.entries(a)) if (/^[A-Za-z0-9_]+\.(sx|sy|sz)$/.test(k)) raw[k] = String(v).trim();
    walk(m.submodels);
  }
}(jem.models));
const resolve = (key, depth = 0) => {
  const v = raw[key];
  if (v === undefined || depth > 8) return undefined;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^[A-Za-z0-9_]+\.(sx|sy|sz)$/.test(v)) return resolve(v, depth + 1);
  return undefined;
};
for (const key of Object.keys(raw)) {
  const [id, ax] = key.split('.');
  const n = resolve(key);
  if (n !== undefined) (scales[id] = scales[id] || {})[ax] = n;
}

const parts = [];
function visit(m, origin, groupId, variant, side) {
  // Зрачок в покое: анимация пака ставит ему сдвиг по x (+0.5 правому, −0.5 левому), ровно гасящий базовый translate (−0.5/+0.5): зрачок по центру
  // белка по ширине. По высоте базовый −0.5 остаётся: зрачок высотой 1 как раз ложится на белок (y 1..2)
  const base = m.translate || [0, 0, 0];
  const t = /^[rl]_eye_pupil\d*$/.test(m.id) ? [0, base[1], 0] : base;
  const o =[origin[0] + t[0], origin[1] + t[1], origin[2] + t[2]]; // начало этой части в координатах модели
  const sc = scales[m.id] || {};
  const isBlink = /blink/i.test(m.id);
  const faces = ['uvEast', 'uvWest', 'uvUp', 'uvDown', 'uvNorth', 'uvSouth'];
  (m.boxes || []).forEach((b, i) => {
    const [cx, cy, cz, dx, dy, dz] = b.coordinates;
    const k = [sc.sx ?? 1, sc.sy ?? 1, sc.sz ?? 1];
    // коробка относительно начала части (масштаб — вокруг начала), в системе модели
    const x1 = cx * k[0]; const x2 = (cx + dx) * k[0];
    const y1 = cy * k[1]; const y2 = (cy + dy) * k[1];
    const z1 = cz * k[2]; const z2 = (cz + dz) * k[2];
    const uv = {};
    for (const f of faces) if (b[f]) uv[f.slice(2).toLowerCase()] = b[f];
    parts.push({
      id: m.id + (i ? `#${i}` : ''), group: groupId, variant, side, blink: isBlink, mirror: m.mirrorTexture || null,
      // начало части в системе skinview3d (шея — 0, перед +z, x зеркален) и коробка относительно него, уже в этой системе
      origin: [-o[0], o[1] - HEAD_BASE_Y + (head.translate ? 0 : 0) - 0, -o[2]],
      min: [-x2, y1, -z2], max: [-x1, y2, -z1],
      uv,
    });
  });
  for (const s of m.submodels || []) visit(s, o, groupId, variant, side);
}

// У дочерних частей translate считается от начала родителя; у «голова/глаза/брови» родитель — голова (translate −24 по y)
const headOrigin = [0, head.translate ? head.translate[1] : 0, 0];
for (const top of head.submodels || []) {
  if (/Created_by/i.test(top.id)) continue;
  if (top.id === 'eyes') {
    for (const eye of top.submodels) {
      const mm = /^(right|left)_eye(\d*)$/.exec(eye.id);
      if (!mm) continue;
      visit(eye, [0, 0, 0], 'eye', Number(mm[2] || 1), mm[1]);
    }
  } else if (top.id === 'brows') {
    visit(top, [0, 0, 0], 'brow', 0, 'both');
  } else if (top.id === 'extras') {
    visit(top, [0, 0, 0], 'extra', 0, 'both');
  }
}

// y в системе модели у частей глаз уже отсчитывается от «нуля» с нижним краем головы на 24: переводим к шее (y − 24)
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ source: 'Fresh Moves 3.1.1 (With Animated Eyes), CC BY-NC-SA 4.0, https://modrinth.com/resourcepack/tras-fresh-player', headTranslateY: headOrigin[1], parts }));
const byGroup = {};
for (const p of parts) byGroup[p.group] = (byGroup[p.group] || 0) + 1;
console.log(`Записано ${parts.length} коробок: ${JSON.stringify(byGroup)} → ${out}`);
