from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src" / "appearance.css"
css = """

/* ---------- First-run account chooser ---------- */
.welcome-overlay { z-index: 260; }
.welcome-modal {
  position: relative; width: 600px; max-width: 94vw; padding: 34px 34px 26px; text-align: center;
  background: radial-gradient(circle at 50% -20%, rgba(var(--rose-rgb), .2), transparent 55%), var(--panel, #14101a);
  border: 1px solid rgba(var(--rose-rgb), .24);
  box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.03) inset;
}
.welcome-close { position: absolute; top: 14px; right: 14px; }
.welcome-mark {
  width: 60px; height: 60px; margin: 0 auto 14px; display: grid; place-items: center;
  border-radius: 18px; font-size: 30px; color: #fff;
  background: linear-gradient(145deg, var(--rose), var(--wine));
  box-shadow: 0 12px 28px rgba(var(--wine-rgb), .5), inset 0 1px 0 rgba(255,255,255,.28);
}
.welcome-title { margin: 0; font-family: var(--font-display); font-size: 27px; letter-spacing: .5px; }
.welcome-sub { margin: 8px 0 24px; font-size: 13.5px; color: var(--text-dim); }
.welcome-options { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.welcome-option {
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-align: left;
  padding: 20px; border-radius: 18px; cursor: pointer; color: var(--text);
  border: 1px solid rgba(var(--ink-rgb), .16); background: rgba(var(--ink-rgb), .05);
  transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease, background .16s ease;
}
.welcome-option:hover { transform: translateY(-4px); border-color: var(--rose); background: rgba(var(--rose-rgb), .1); box-shadow: 0 14px 30px rgba(var(--wine-rgb), .25); }
.welcome-option.microsoft { background: linear-gradient(160deg, rgba(91,153,255,.13), rgba(var(--wine-rgb),.08)); }
.welcome-option.offline { background: linear-gradient(160deg, rgba(52,211,153,.12), rgba(var(--wine-rgb),.08)); }
.welcome-option-icon { font-size: 28px; line-height: 1; margin-bottom: 4px; }
.welcome-option.microsoft .welcome-option-icon { color: #7aa9ff; }
.welcome-option.offline .welcome-option-icon { color: #34d399; }
.welcome-option-name { font-size: 16px; font-weight: 800; }
.welcome-option-desc { font-size: 12.5px; color: var(--text-dim); line-height: 1.4; }
.welcome-option-go { margin-top: 10px; font-size: 12.5px; font-weight: 750; color: var(--rose); }
.welcome-offline { text-align: left; padding: 6px 4px; }
.welcome-error { margin-top: 14px; }
.welcome-skip { margin-top: 20px; }
@media (max-width: 560px) {
  .welcome-options { grid-template-columns: 1fr; }
  .welcome-modal { padding: 28px 20px 20px; }
}
html[data-reduce-motion="true"] .welcome-option:hover { transform: none; }
"""
text = ROOT.read_text(encoding="utf-8")
if "First-run account chooser" not in text:
    ROOT.write_text(text + css, encoding="utf-8")
    print("welcome css added")
else:
    print("already present")
