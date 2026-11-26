// Готовые пиксель-арт иконки для сборки: клик по иконке — onPick(пресет). selected — id или dataUrl выбранной сейчас.
import { useEffect, useState } from 'react';

export default function IconPresetPicker({ selected, onPick, disabled = false }) {
  const [presets, setPresets] = useState(null);
  useEffect(() => {
    let alive = true;
    window.api.instances.iconPresets().then((l) => { if (alive) setPresets(Array.isArray(l) ? l : []); }).catch(() => { if (alive) setPresets([]); });
    return () => { alive = false; };
  }, []);
  if (!presets || presets.length === 0) return null;
  return (
    <div className="icon-presets">
      {presets.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`icon-preset ${selected === p.id || selected === p.dataUrl ? 'active' : ''}`}
          onClick={() => onPick(p)}
          title={p.name}
          disabled={disabled}
        >
          <img src={p.dataUrl} alt={p.name} />
        </button>
      ))}
    </div>
  );
}
