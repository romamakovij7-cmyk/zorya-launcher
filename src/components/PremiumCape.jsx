// Our capes в окне Премиума: настоящая 3D-модель плаща, стоит рисунком к нам чуть под углом, по нему бегает тёплый свет,
// а сзади мягко пульсирует сияние. Модель — тот же просмотрщик скинов (skinview3d) с невидимым персонажем: остаётся один плащ.
import { useEffect, useRef, useState } from 'react';
import { SkinViewer } from 'skinview3d';
import { Box3, Group, PointLight, Vector3 } from 'three';
import capesPng from '../assets/pixel/capes.png';

export default function PremiumCape({ width = 170, height = 200 }) {
  const canvasRef = useRef(null);
  const [url, setUrl] = useState(undefined); // undefined = Still loading, null. = no cloak

  useEffect(() => {
    let alive = true;
    window.api.skins.listCapes().then((r) => { if (alive) setUrl(r?.ok && r.capes[0] ? r.capes[0].url : null); }).catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!url || !canvasRef.current) return undefined;
    let viewer;
    let raf = 0;
    let dead = false;
    try {
      viewer = new SkinViewer({ canvas: canvasRef.current, width, height, fov: 34, zoom: 1.55 });
      viewer.controls.enableRotate = false;
      viewer.controls.enableZoom = false;
      viewer.controls.enablePan = false;
      viewer.autoRotate = false;
      const player = viewer.playerObject;
      player.skin.visible = false; // No character - only a cloak is visible
      // Плащ висит позади центра персонажа, поэтому вращаем не персонажа, а «ось» (pivot), совмещённую с центром плаща.
      const pivot = new Group();
      viewer.scene.remove(player);
      pivot.add(player);
      viewer.scene.add(pivot);
      viewer.loadCape(url).then(() => {
        if (dead) return;
        player.cape.rotation.x = 0; // Default cloak from toss at 10° — For the window, it should hang exactly.
        // Центр плаща считаем в неповёрнутом виде (цикл анимации уже мог повернуть pivot), иначе плащ съедет в сторону
        const turn = pivot.rotation.y;
        pivot.rotation.y = 0;
        player.position.set(0, 0, 0);
        pivot.updateMatrixWorld(true);
        const c = new Box3().setFromObject(player.cape).getCenter(new Vector3());
        player.position.set(-c.x, -c.y, -c.z);
        pivot.rotation.y = turn;
      }).catch(() => {});
      const glow = new PointLight(0xffd27a, 2.4, 140);
      viewer.scene.add(glow);
      const t0 = performance.now();
      const loop = () => {
        if (dead) return;
        const t = (performance.now() - t0) / 1000;
        // Не крутится: стоит рисунком к нам, чуть под углом (π — лицевая сторона к зрителю), едва заметно покачивается
        pivot.rotation.y = Math.PI + 0.38 + Math.sin(t * 0.8) * 0.04;
        // свет облетает плащ, поэтому складки и края по очереди вспыхивают
        glow.position.set(Math.cos(t * 1.5) * 20, Math.sin(t * 0.9) * 10, Math.sin(t * 1.5) * 20 + 4);
        glow.intensity = 2.2 + Math.sin(t * 2.2) * 0.8;
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } catch (e) { console.error('PremiumCape:', e && e.message); }
    return () => { dead = true; cancelAnimationFrame(raf); try { viewer && viewer.dispose(); } catch { /* ignore */ } };
  }, [url, width, height]);

  if (url === null) return <img src={capesPng} alt="" className="pm-pixel" />;
  return (
    <div className="pm-cape" style={{ width, height }}>
      <div className="pm-cape-glow" />
      <canvas ref={canvasRef} width={width} height={height} />
    </div>
  );
}
