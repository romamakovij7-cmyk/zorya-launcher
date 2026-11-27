from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src" / "appearance.css"
css = """

/* ---------- Cosmetics gallery (assets from millida/launcher) ---------- */
.cosmetics-gallery { padding: 4px 2px 10px; }
.cosmetics-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 18px 20px; border-radius: 16px; margin-bottom: 16px;
  background: linear-gradient(120deg, rgba(var(--wine-rgb), .22), rgba(var(--rose-rgb), .1) 60%, transparent);
  border: 1px solid rgba(var(--ink-rgb), .12);
}
.cosmetics-hero h3 { margin: 0 0 4px; font-family: var(--font-display); font-size: 19px; }
.cosmetics-hero p { margin: 0; font-size: 12.5px; color: var(--text-dim); }
.cosmetics-count {
  white-space: nowrap; font-size: 12px; font-weight: 750; padding: 7px 12px; border-radius: 99px;
  background: rgba(var(--rose-rgb), .16); color: var(--rose); border: 1px solid rgba(var(--rose-rgb), .3);
}
.cosmetics-search {
  width: 100%; max-width: 360px; padding: 9px 13px; margin-bottom: 6px; border-radius: 11px;
  background: rgba(var(--ink-rgb), .06); border: 1px solid rgba(var(--ink-rgb), .14);
  color: var(--text); outline: 0; font: inherit; font-size: 13px;
}
.cosmetics-search:focus { border-color: var(--rose); box-shadow: 0 0 0 3px rgba(var(--rose-rgb), .14); }
.cosmetics-section {
  margin: 20px 0 10px; font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--text-faint);
}
.cosmetics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 10px; }
.cosmetics-cell {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 10px 6px 8px; cursor: pointer; border-radius: 14px; color: var(--text);
  background: rgba(var(--ink-rgb), .05); border: 1px solid rgba(var(--ink-rgb), .12);
  transition: transform .15s ease, border-color .15s ease, background .15s ease;
}
.cosmetics-cell:hover { transform: translateY(-3px); border-color: var(--rose); background: rgba(var(--rose-rgb), .1); }
.cosmetics-cell.active { border-color: var(--rose); box-shadow: 0 0 0 2px rgba(var(--rose-rgb), .2); }
.cosmetics-cell img { width: 54px; height: 54px; object-fit: contain; image-rendering: pixelated; }
.cosmetics-cell.cape img { width: 74px; }
.cosmetics-cell.art img { width: 100%; height: 58px; object-fit: cover; border-radius: 8px; }
.cosmetics-cell span { font-size: 11px; color: var(--text-faint); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cosmetics-preview {
  position: sticky; bottom: 0; display: flex; align-items: center; gap: 14px; margin-top: 20px;
  padding: 12px 16px; border-radius: 15px; border: 1px solid rgba(var(--rose-rgb), .4);
  background: rgba(var(--wine-rgb), .16); backdrop-filter: blur(12px);
}
.cosmetics-preview img { width: 64px; height: 64px; object-fit: contain; image-rendering: pixelated; }
.cosmetics-preview span { flex: 1; font-size: 15px; font-weight: 700; }
html[data-reduce-motion="true"] .cosmetics-cell:hover { transform: none; }
"""
text = ROOT.read_text(encoding="utf-8")
if "Cosmetics gallery (assets from millida" not in text:
    ROOT.write_text(text + css, encoding="utf-8")
    print("cosmetics css added")
else:
    print("already present")
