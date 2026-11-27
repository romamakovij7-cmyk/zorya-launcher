from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src" / "appearance.css"
css = """

/* ---------- Optimization modal: richer customization UI ---------- */
.optimize-modal { width: 720px; max-width: 94vw; display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.opt-hero {
  position: relative; display: flex; align-items: center; gap: 16px; padding: 22px 26px 20px;
  background: linear-gradient(120deg, rgba(var(--wine-rgb), .28), rgba(var(--rose-rgb), .12) 55%, transparent);
  border-bottom: 1px solid rgba(var(--ink-rgb), .12);
}
.opt-hero::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle at 82% 20%, rgba(var(--rose-rgb), .18), transparent 42%);
}
.opt-hero-icon {
  width: 52px; height: 52px; flex: 0 0 52px; border-radius: 16px; display: grid; place-items: center;
  color: #fff; background: linear-gradient(145deg, var(--rose), var(--wine));
  box-shadow: 0 8px 22px rgba(var(--wine-rgb), .42), inset 0 1px 0 rgba(255,255,255,.25);
}
.opt-hero-text { flex: 1; min-width: 0; position: relative; z-index: 1; }
.opt-hero-text h2 { margin: 0; font-family: var(--font-display); font-size: 24px; letter-spacing: .4px; }
.opt-hero-text p { margin: 5px 0 0; font-size: 13.5px; color: var(--text-dim); }
.opt-hero-text strong { color: var(--rose); text-transform: capitalize; }
.opt-close { position: relative; z-index: 1; }

.opt-body { padding: 18px 26px 6px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
.opt-presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.opt-preset {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left;
  padding: 12px 13px; border-radius: 14px; cursor: pointer; color: var(--text);
  background: rgba(var(--ink-rgb), .06); border: 1px solid rgba(var(--ink-rgb), .12);
  transition: transform .16s ease, border-color .16s ease, background .16s ease, box-shadow .16s ease;
}
.opt-preset:hover { transform: translateY(-2px); border-color: rgba(var(--rose-rgb), .55); background: rgba(var(--rose-rgb), .09); }
.opt-preset.active {
  border-color: var(--rose); background: linear-gradient(145deg, rgba(var(--rose-rgb), .18), rgba(var(--wine-rgb), .1));
  box-shadow: 0 6px 18px rgba(var(--wine-rgb), .25), inset 0 1px 0 rgba(255,255,255,.08);
}
.opt-preset-icon { font-size: 19px; line-height: 1; }
.opt-preset-label { font-weight: 750; font-size: 13.5px; margin-top: 4px; }
.opt-preset-desc { font-size: 11.5px; color: var(--text-faint); }

.opt-toolbar { display: flex; align-items: center; gap: 12px; margin: 16px 0 10px; }
.opt-search {
  flex: 1; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 11px;
  background: rgba(var(--ink-rgb), .06); border: 1px solid rgba(var(--ink-rgb), .13); color: var(--text-faint);
}
.opt-search:focus-within { border-color: var(--rose); box-shadow: 0 0 0 3px rgba(var(--rose-rgb), .14); }
.opt-search input { flex: 1; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 13px; }
.opt-search input::placeholder { color: var(--text-faint); }

.opt-list { display: flex; flex-direction: column; gap: 8px; max-height: 48vh; overflow-y: auto; padding: 2px 6px 6px 2px; }
.opt-list::-webkit-scrollbar { width: 7px; }
.opt-list::-webkit-scrollbar-thumb { background: rgba(var(--ink-rgb), .22); border-radius: 99px; }
.opt-cat { display: flex; flex-direction: column; gap: 7px; }
.opt-cat-title {
  display: flex; align-items: center; gap: 7px; margin: 6px 0 1px;
  font-size: 11px; font-weight: 800; letter-spacing: 1.1px; text-transform: uppercase; color: var(--text-faint);
}
.opt-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; box-shadow: 0 0 9px currentColor; }
.opt-dot.violet { background: #a78bfa; color: #a78bfa; }
.opt-dot.rose { background: #fb7185; color: #fb7185; }
.opt-dot.mint { background: #34d399; color: #34d399; }
.opt-dot.blue { background: #60a5fa; color: #60a5fa; }
.opt-dot.amber { background: #fbbf24; color: #fbbf24; }
.opt-dot.pink { background: #f472b6; color: #f472b6; }

.opt-card {
  position: relative; display: flex; align-items: center; gap: 12px; padding: 11px 14px;
  border-radius: 14px; cursor: pointer; border: 1px solid rgba(var(--ink-rgb), .12);
  background: rgba(var(--ink-rgb), .045);
  transition: transform .14s ease, border-color .14s ease, background .14s ease, box-shadow .14s ease;
}
.opt-card:hover { transform: translateX(3px); border-color: rgba(var(--rose-rgb), .5); background: rgba(var(--rose-rgb), .07); }
.opt-card.selected {
  border-color: rgba(var(--rose-rgb), .65);
  background: linear-gradient(100deg, rgba(var(--rose-rgb), .12), rgba(var(--wine-rgb), .06));
  box-shadow: inset 3px 0 0 var(--rose);
}
.opt-card-icon {
  width: 38px; height: 38px; flex: 0 0 38px; border-radius: 11px; display: grid; place-items: center;
  font-size: 17px; background: rgba(var(--ink-rgb), .08); color: var(--rose);
}
.opt-card.selected .opt-card-icon { background: rgba(var(--rose-rgb), .18); box-shadow: 0 4px 12px rgba(var(--wine-rgb), .22); }
.opt-card-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.opt-card-name { font-weight: 750; font-size: 14px; }
.opt-card-desc { font-size: 12px; color: var(--text-faint); line-height: 1.35; }
.opt-card-status { font-size: 11.5px; color: var(--text-dim); white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; }
.opt-done .opt-card-status { color: var(--success); }
.opt-none .opt-card-status, .opt-error .opt-card-status { color: var(--danger); }
.opt-have .opt-card-status { color: var(--text-faint); }
.opt-card.opt-search, .opt-card.opt-install { animation: opt-pulse 1.1s ease-in-out infinite; }
.opt-empty { padding: 28px; text-align: center; color: var(--text-faint); font-size: 13px; }

.opt-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 16px 26px 20px; border-top: 1px solid rgba(var(--ink-rgb), .12);
  background: rgba(var(--ink-rgb), .035);
}
.opt-count { font-size: 13px; color: var(--text-dim); }
.opt-count strong { color: var(--rose); font-size: 16px; }
.opt-footer .modal-actions { margin: 0; }
.opt-install { min-width: 150px; background: linear-gradient(120deg, var(--rose), var(--wine)); border: 0; }
.opt-install:hover { filter: brightness(1.1); transform: translateY(-1px); }

@keyframes opt-pulse { 0%,100% { opacity: .65; } 50% { opacity: 1; } }
html[data-reduce-motion="true"] .opt-preset:hover,
html[data-reduce-motion="true"] .opt-card:hover { transform: none; }
html[data-reduce-motion="true"] .opt-card.opt-search,
html[data-reduce-motion="true"] .opt-card.opt-install { animation: none; }

@media (max-width: 620px) {
  .opt-presets { grid-template-columns: repeat(2, 1fr); }
  .opt-footer { flex-direction: column; align-items: stretch; }
  .opt-footer .modal-actions { justify-content: space-between; }
}
"""
text = ROOT.read_text(encoding="utf-8")
if "Optimization modal: richer customization UI" not in text:
    ROOT.write_text(text + css, encoding="utf-8")
    print("optimize UI css added")
else:
    print("css already present")
