import { inferModelType } from 'skinview-utils';

// Reads a skin PNG into an offscreen canvas and inspects the arm-texture
// regions to tell classic (4px-wide arms) from slim (3px-wide "Alex" arms)
// skins apart — the same heuristic skinview3d itself uses for auto-detect.
export function detectVariant(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      try {
        resolve(inferModelType(canvas) === 'slim' ? 'slim' : 'classic');
      } catch {
        resolve('classic');
      }
    };
    img.onerror = () => resolve('classic');
    img.src = dataUrl;
  });
}
