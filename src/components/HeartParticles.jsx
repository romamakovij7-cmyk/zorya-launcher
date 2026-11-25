// Hearts вокруг персонажа на главном экране («Игровой»): частица Chubrik — 6 кадров 8×8, кадр меняется по возрасту.
// Рисуются на отдельном холсте поверх персонажа, мышь пропускают.
import { useEffect, useRef } from 'react';
import h0 from '../assets/hearts/heart_0.png';
import h1 from '../assets/hearts/heart_1.png';
import h2 from '../assets/hearts/heart_2.png';
import h3 from '../assets/hearts/heart_3.png';
import h4 from '../assets/hearts/heart_4.png';
import h5 from '../assets/hearts/heart_5.png';

const FRAMES = [h0, h1, h2, h3, h4, h5];
const RATE = 2.2; // сердечек в секунду

export default function HeartParticles({ className }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const images = FRAMES.map((src) => { const im = new Image(); im.src = src; return im; });
    let w = 0;
    let h = 0;
    let dpr = 1;
    let parts = [];
    let last = performance.now();
    let spawnAcc = 0;
    let raf = 0;

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      w = r.width; h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    function spawn() {
      const k = Math.min(1.4, Math.max(0.7, h / 700)); // масштаб от высоты окна
      const spread = Math.min(w, h * 0.8) * 0.55;
      parts.push({
        x: w / 2 + (Math.random() - 0.5) * spread,
        y: h * (0.3 + Math.random() * 0.5),
        vy: -(16 + Math.random() * 24) * k,
        sway: 6 + Math.random() * 10,
        phase: Math.random() * Math.PI * 2,
        life: 2 + Math.random() * 1.2,
        size: Math.round(3 + Math.random() * 2) * Math.max(1, Math.round(k)),
        age: 0,
      });
    }

    function tick(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      spawnAcc += dt * RATE;
      while (spawnAcc >= 1) { spawnAcc -= 1; spawn(); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;
      parts = parts.filter((p) => p.age < p.life);
      for (const p of parts) {
        p.age += dt;
        p.y += p.vy * dt;
        const t = p.age / p.life;
        const frame = images[Math.min(FRAMES.length - 1, Math.floor(t * FRAMES.length))];
        const alpha = Math.min(1, p.age / 0.2) * (t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1);
        if (!frame.complete || !frame.naturalWidth) continue;
        const s = p.size * 8;
        const x = p.x + Math.sin(p.age * 2.4 + p.phase) * p.sway - s / 2;
        ctx.globalAlpha = alpha;
        ctx.drawImage(frame, Math.round(x), Math.round(p.y - s / 2), s, s);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={canvasRef} className={className} />;
}
