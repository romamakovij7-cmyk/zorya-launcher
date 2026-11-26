import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Key for one distinct face image: the texture path plus the tint applied to
// it (grass/leaves are grayscale masks colored per block). Schematics.jsx
// builds its image map with the same function.
export function textureKey(path, tint) {
  return tint ? `${path}|${tint.toString(16)}` : path;
}

// Fallback for blocks we couldn't resolve a model for — a distinct, stable
// hue per block type rather than a random guess, so at least different
// block types stay visually distinguishable.
function colorForBlock(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return new THREE.Color().setHSL(hue / 360, 0.45, 0.5);
}

// Vertex corners of each cuboid face (0 = element's "from", 1 = "to" on that
// axis), in Minecraft's own order — counter-clockwise seen from outside, and
// vertex i takes UV corner i (top-left, bottom-left, bottom-right, top-right).
const FACE_VERTS = {
  down: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]],
  up: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  north: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]],
  south: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]],
  west: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]],
  east: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]],
};

// UV rectangle [u0, v0, u1, v1] (0–16, v downward) used when a face has none.
function defaultUv(dir, [x1, y1, z1], [x2, y2, z2]) {
  switch (dir) {
    case 'down': return [x1, 16 - z2, x2, 16 - z1];
    case 'up': return [x1, z1, x2, z2];
    case 'north': return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    case 'south': return [x1, 16 - y2, x2, 16 - y1];
    case 'west': return [z1, 16 - y2, z2, 16 - y1];
    default: return [16 - z2, 16 - y2, 16 - z1, 16 - y1]; // east
  }
}

const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const CENTER = new THREE.Vector3(0.5, 0.5, 0.5);
const rad = (deg) => THREE.MathUtils.degToRad(deg);

// Builds one geometry (in 0–1 block space) for a block's parts, with one
// geometry group per distinct face image. `keys[i]` is the image key of
// material index i.
function buildGeometry(block) {
  const buckets = new Map(); // image key -> { pos, uv }
  const v = new THREE.Vector3();

  for (const part of block.parts) {
    for (const el of part.elements) {
      const from = el.from;
      const to = el.to;
      const rot = el.rotation;
      const origin = rot ? new THREE.Vector3(rot.origin[0] / 16, rot.origin[1] / 16, rot.origin[2] / 16) : null;

      for (const [dir, face] of Object.entries(el.faces)) {
        const key = textureKey(face.tex, face.tint ? block.tint : null);
        if (!buckets.has(key)) buckets.set(key, { pos: [], uv: [] });
        const bucket = buckets.get(key);

        const [u0, v0, u1, v1] = face.uv || defaultUv(dir, from, to);
        const corners = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
        const shift = ((face.rotation || 0) / 90) % 4;

        const quad = [];
        FACE_VERTS[dir].forEach((sel, i) => {
          v.set(
            (sel[0] ? to[0] : from[0]) / 16,
            (sel[1] ? to[1] : from[1]) / 16,
            (sel[2] ? to[2] : from[2]) / 16,
          );
          if (rot) {
            v.sub(origin).applyAxisAngle(AXES[rot.axis], rad(rot.angle));
            if (rot.rescale) {
              const s = 1 / Math.cos(rad(rot.angle));
              if (rot.axis !== 'x') v.x *= s;
              if (rot.axis !== 'y') v.y *= s;
              if (rot.axis !== 'z') v.z *= s;
            }
            v.add(origin);
          }
          // Blockstate rotation: tip about X first, then spin about Y — both
          // clockwise for positive degrees, hence the negation.
          if (part.rotX || part.rotY) {
            v.sub(CENTER);
            if (part.rotX) v.applyAxisAngle(AXES.x, -rad(part.rotX));
            if (part.rotY) v.applyAxisAngle(AXES.y, -rad(part.rotY));
            v.add(CENTER);
          }
          const [cu, cv] = corners[(i + shift) % 4];
          quad.push({ x: v.x, y: v.y, z: v.z, u: cu / 16, v: 1 - cv / 16 });
        });

        for (const idx of [0, 1, 2, 0, 2, 3]) {
          const q = quad[idx];
          bucket.pos.push(q.x, q.y, q.z);
          bucket.uv.push(q.u, q.v);
        }
      }
    }
  }

  const keys = [...buckets.keys()];
  const positions = [];
  const uvs = [];
  const geometry = new THREE.BufferGeometry();
  let start = 0;
  keys.forEach((key, materialIndex) => {
    const { pos, uv } = buckets.get(key);
    positions.push(...pos);
    uvs.push(...uv);
    const count = pos.length / 3;
    geometry.addGroup(start, count, materialIndex);
    start += count;
  });
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals(); // vertices aren't shared → flat per-face normals
  return { geometry, keys };
}

// Number of leading entries of an ascending array that are < limit.
function countBelow(sorted, limit) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < limit) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// `progress` (0..1) reveals the structure in build order — bottom layer
// first, and within a layer row by row — so it can be played back as a
// "construction" animation. 1 shows everything.
export default function SchematicViewer3D({
  blocks, sizeHint, textures, progress = 1,
}) {
  const canvasRef = useRef(null);
  const meshesRef = useRef([]); // [{ mesh, ranks }]
  const totalRef = useRef(0);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  function applyProgress(p) {
    const reveal = Math.round(Math.min(Math.max(p, 0), 1) * totalRef.current);
    for (const { mesh, ranks } of meshesRef.current) mesh.count = countBelow(ranks, reveal);
  }

  useEffect(() => {
    if (!canvasRef.current || !blocks || blocks.length === 0) return undefined;

    const canvas = canvasRef.current;
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x12080c);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
    const maxDim = Math.max(sizeHint?.x || 1, sizeHint?.y || 1, sizeHint?.z || 1, 1);
    camera.position.set(maxDim * 1.3, maxDim * 1.1, maxDim * 1.3);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set((sizeHint?.x || 0) / 2, (sizeHint?.y || 0) / 2, (sizeHint?.z || 0) / 2);
    controls.enableDamping = true;
    camera.lookAt(controls.target);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 0.65);
    dir.position.set(1, 1.5, 1);
    scene.add(dir);

    const blockDefs = textures?.blocks || {};
    const images = textures?.images || {};
    const loader = new THREE.TextureLoader();
    const disposables = [];
    const materialCache = new Map();

    function imageMaterial(key) {
      if (materialCache.has(key)) return materialCache.get(key);
      const tex = loader.load(images[key]);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      // Minecraft block textures lean on alpha a lot (leaves, vines, tall
      // grass, glass, flowers) — without transparent+alphaTest the GPU
      // ignores the alpha channel and every "empty" pixel renders as solid
      // garbage color. Double-sided since flowers/crops are flat planes.
      const material = new THREE.MeshLambertMaterial({
        map: tex, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide,
      });
      disposables.push(tex, material);
      materialCache.set(key, material);
      return material;
    }

    function colorMaterial(name) {
      const key = `color:${name}`;
      if (materialCache.has(key)) return materialCache.get(key);
      const material = new THREE.MeshLambertMaterial({ color: colorForBlock(name) });
      disposables.push(material);
      materialCache.set(key, material);
      return material;
    }

    // One InstancedMesh per unique (block name + properties) combo, using
    // that block's real model geometry; anything unresolved is a flat-color
    // cube. Instance transform is translation only — rotations are already
    // baked into each block's geometry.
    // Build order: layer by layer (y), then z, then x.
    const order = blocks.map((_, i) => i).sort((a, b) => {
      const A = blocks[a];
      const B = blocks[b];
      return (A.y - B.y) || (A.z - B.z) || (A.x - B.x);
    });
    const rankOf = new Int32Array(blocks.length);
    order.forEach((blockIndex, rank) => { rankOf[blockIndex] = rank; });
    totalRef.current = blocks.length;
    meshesRef.current = [];

    const groups = new Map();
    blocks.forEach((b, i) => {
      const key = b.key || b.name;
      if (!groups.has(key)) groups.set(key, { name: b.name, items: [] });
      groups.get(key).items.push({ b, rank: rankOf[i] });
    });

    const fallbackGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    disposables.push(fallbackGeometry);
    const matrix = new THREE.Matrix4();

    for (const [key, { name, items }] of groups) {
      let geometry = fallbackGeometry;
      let material = colorMaterial(name);

      const def = blockDefs[key];
      if (def) {
        try {
          const built = buildGeometry(def);
          geometry = built.geometry;
          disposables.push(geometry);
          material = built.keys.map((k) => (images[k] ? imageMaterial(k) : colorMaterial(name)));
        } catch {
          geometry = fallbackGeometry;
          material = colorMaterial(name);
        }
      }

      items.sort((a, b) => a.rank - b.rank); // ascending, so a prefix = "built so far"
      const mesh = new THREE.InstancedMesh(geometry, material, items.length);
      items.forEach(({ b }, i) => {
        matrix.makeTranslation(b.x, b.y, b.z);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false; // bounding sphere ignores instance offsets
      scene.add(mesh);
      meshesRef.current.push({ mesh, ranks: Int32Array.from(items, (it) => it.rank) });
    }
    applyProgress(progressRef.current);

    let raf = null;
    function animate() {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    }
    animate();

    function handleResize() {
      const w = canvas.clientWidth || width;
      const h = canvas.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    const ro = new ResizeObserver(handleResize);
    ro.observe(canvas);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
    };
  }, [blocks, sizeHint, textures]);

  useEffect(() => { applyProgress(progress); }, [progress]);

  return <canvas ref={canvasRef} className="schematic-3d-canvas" />;
}
