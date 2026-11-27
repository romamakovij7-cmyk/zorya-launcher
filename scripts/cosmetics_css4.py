from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src" / "appearance.css"
css = """

/* ---------- Cosmetics: grouped tabs + equip ---------- */
.cosmetics-tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 5px; margin-bottom: 12px; border-radius: 13px; background: rgba(var(--ink-rgb), .05); }
.cosmetics-tab {
  padding: 9px 15px; border-radius: 10px; border: 0; cursor: pointer; font: inherit;
  font-size: 12.5px; font-weight: 700; color: var(--text-dim); background: transparent;
  transition: background .15s ease, color .15s ease, transform .15s ease;
}
.cosmetics-tab:hover { color: var(--text); background: rgba(var(--ink-rgb), .08); }
.cosmetics-tab.active {
  color: #fff; background: linear-gradient(120deg, var(--rose), var(--wine));
  box-shadow: 0 5px 14px rgba(var(--wine-rgb), .3);
}
.cosmetics-worn { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 10px; border-radius: 12px; background: rgba(var(--rose-rgb), .09); border: 1px solid rgba(var(--rose-rgb), .2); }
.cosmetics-worn-label { font-size: 12px; font-weight: 750; color: var(--rose); }
.cosmetics-worn-item { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 9px; border: 1px solid rgba(var(--ink-rgb), .14); background: rgba(var(--ink-rgb), .06); cursor: pointer; color: var(--text); }
.cosmetics-worn-item img { width: 26px; height: 26px; object-fit: contain; image-rendering: pixelated; }
.cosmetics-worn-item span { font-size: 11px; }
.cosmetics-cell.worn { border-color: var(--rose); box-shadow: 0 0 0 2px rgba(var(--rose-rgb), .25), 0 8px 20px rgba(var(--wine-rgb), .25); }
.cosmetics-equip {
  position: absolute; top: 5px; left: 5px; width: 22px; height: 22px; border-radius: 7px;
  border: 0; cursor: pointer; font-size: 15px; font-weight: 800; line-height: 1;
  color: var(--text-faint); background: rgba(0,0,0,.3);
}
.cosmetics-equip:hover { color: #fff; background: var(--rose); }
.cosmetics-equip.on { color: #fff; background: linear-gradient(145deg, #34d399, #059669); }
html[data-reduce-motion="true"] .cosmetics-tab:hover { transform: none; }
"""
text = ROOT.read_text(encoding="utf-8")
if "Cosmetics: grouped tabs" not in text:
    ROOT.write_text(text + css, encoding="utf-8")
    print("cosmetics css4 added")
else:
    print("already present")
