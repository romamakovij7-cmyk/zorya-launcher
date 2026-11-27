from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src" / "appearance.css"
css = """

/* ---------- Cosmetics: full collection controls ---------- */
.cosmetics-controls { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
.cosmetics-search { max-width: none; }
.cosmetics-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.cosmetics-chip {
  padding: 7px 11px; border-radius: 99px; cursor: pointer; font: inherit; font-size: 12px;
  color: var(--text-dim); border: 1px solid rgba(var(--ink-rgb), .14);
  background: rgba(var(--ink-rgb), .05); transition: all .14s ease;
}
.cosmetics-chip:hover { border-color: var(--rose); color: var(--text); }
.cosmetics-chip.active {
  color: #fff; border-color: transparent;
  background: linear-gradient(120deg, var(--rose), var(--wine));
  box-shadow: 0 5px 14px rgba(var(--wine-rgb), .3);
}
.cosmetics-chip span { opacity: .7; margin-left: 4px; font-size: 11px; }
.cosmetics-grid { grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 8px; }
.cosmetics-cell img { width: 100%; height: 56px; object-fit: contain; }
.cosmetics-cell.emoji img { width: 52px; height: 52px; image-rendering: pixelated; }
.cosmetics-cell.capes img { height: 56px; width: auto; max-width: 100%; }
.cosmetics-cell.bg img, .cosmetics-cell.mode-art img { object-fit: cover; border-radius: 8px; }
.cosmetics-cell.catalog-art img, .cosmetics-cell.packs img { object-fit: cover; border-radius: 8px; }
.cosmetics-cell.lobby img, .cosmetics-cell.chests img, .cosmetics-cell.presets img { image-rendering: pixelated; }
.cosmetics-empty { padding: 30px; text-align: center; color: var(--text-faint); }
.cosmetics-preview-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.cosmetics-preview-text span { font-size: 12px; color: var(--text-faint); }
"""
text = ROOT.read_text(encoding="utf-8")
if "Cosmetics: full collection controls" not in text:
    ROOT.write_text(text + css, encoding="utf-8")
    print("cosmetics css2 added")
else:
    print("already present")
