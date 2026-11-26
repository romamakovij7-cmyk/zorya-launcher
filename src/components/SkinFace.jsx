import { useEffect, useRef } from 'react';

// Crops just the face (base layer + hat overlay) out of a skin texture and
// draws it to a canvas, scaled up with nearest-neighbor sampling. Avoids
// depending on a third-party avatar-rendering service (crafatar, etc.) —
// those are flaky/rate-limited and we already have the real texture URL.
export default function SkinFace({ src, size = 40, className, style }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    if (!src) return;

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const scale = img.naturalWidth / 64; // texture is 64px wide regardless of 64x32/64x64
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 8 * scale, 8 * scale, 8 * scale, 8 * scale, 0, 0, size, size);
      ctx.drawImage(img, 40 * scale, 8 * scale, 8 * scale, 8 * scale, 0, 0, size, size);
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [src, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, imageRendering: 'pixelated', ...style }}
    />
  );
}
