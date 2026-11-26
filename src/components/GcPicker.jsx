// Переключатель сборщика мусора: G1GC (по умолчанию) или ZGC. Пишет флаги в строку JVM-аргументов (args → onChange(newArgs)).
import { detectGc, setGc } from '../utils/gcFlags.js';

const OPTIONS = [
  { id: 'g1', label: 'G1GC', hint: 'Стандартный сборщик: подходит почти всем сборкам.' },
  { id: 'zgc', label: 'ZGC', hint: 'Почти без пауз сборки мусора — меньше микрофризов на больших сборках с большим объёмом памяти. Нужна Java 15+; на Java 21+ включается поколенческий режим.' },
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
        {cur === 'other' && <span className="gc-picker-note">В аргументах указан другой сборщик</span>}
      </div>
      <p className="settings-block-hint" style={{ marginTop: 8 }}>
        {shown === 'zgc'
          ? OPTIONS[1].hint + ' На старой Java лаунчер сам отключит ZGC, чтобы игра запустилась.'
          : OPTIONS[0].hint + ' ZGC можно попробовать, если на большой сборке бывают подёргивания.'}
      </p>
    </div>
  );
}
