from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src" / "appearance.css"
css = """

/* ---------- Real cosmetics (slots from millida catalog) ---------- */
.cosmetics-cell.cosmetic { padding: 0; overflow: hidden; min-height: 92px; }
.cosmetics-cell-main {
  width: 100%; display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 10px 6px 16px; border: 0; background: transparent; color: var(--text); cursor: pointer;
}
.cosmetics-cell-main img { width: 100%; height: 60px; object-fit: contain; image-rendering: pixelated; }
.cosmetics-cell-main span {
  max-width: 100%; font-size: 10.5px; color: var(--text-faint);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cosmetics-star {
  position: absolute; top: 5px; right: 5px; width: 22px; height: 22px; border-radius: 7px;
  border: 0; cursor: pointer; font-size: 14px; line-height: 1;
  color: var(--text-faint); background: rgba(0,0,0,.28);
}
.cosmetics-star.on { color: #fbbf24; background: rgba(0,0,0,.5); }
.cosmetics-star:hover { color: #fbbf24; }
"""
text = ROOT.read_text(encoding="utf-8")
if "Real cosmetics (slots" not in text:
    ROOT.write_text(text + css, encoding="utf-8")
    print("cosmetics css3 added")
else:
    print("already present")
