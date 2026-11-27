// Переключатель сборщика мусора: G1GC (по умолчанию) или ZGC. Пишет флаги в строку JVM-аргументов (args → onChange(newArgs)).
import { detectGc, setGc } from '../utils/gcFlags.js';

const OPTIONS = [
  { id: 'g1', label: 'G1GC', hint: 'Standard builder: suitable for almost all instances.' },
  { id: 'zgc', label: 'ZGC', hint: 'Almost no pauses in garbage collection — fewer microfreezes on large instances with more memory. Java 15+ is required; Java 21+ includes generational mode.' },
];

export default function GcPicker({ args, onChange, compact = false }) {
  const cur = detectGc(args);
  const shown = cur === 'default' ? 'g1' : cur;
  return (
    <div className={`gc-picker ${compact ? 'compact' : ''}`}>
      <div className="gc-picker-row">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`shot-editor-tool ${shown === o.id ? 'active' : ''}`}
            title={o.hint}
            onClick={() => onChange(setGc(args, o.id))}
          >
            {o.label}
          </button>
        ))}
        {cur === 'other' && <span className="gc-picker-note">Arguments indicate another collector</span>}
      </div>
      <p className="settings-block-hint" style={{ marginTop: 8 }}>
        {shown === 'zgc'
          ? OPTIONS[1].hint + ' On old Java, the launcher will shut down the ZGC itself to start the game.'
          : OPTIONS[0].hint + ' ZGC can be tried if there are twitches on a large instance.'}
      </p>
    </div>
  );
}
