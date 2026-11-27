"""Re-apply Zorya custom patches after restoring clean source."""
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"


def edit(path, pairs):
    p = SRC / path
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        if old not in t:
            print("MISS", path, old[:60])
            continue
        t = t.replace(old, new)
    p.write_text(t, encoding="utf-8")
    print("patched", path)


edit("main.jsx", [
    ("import LicenseGate from './components/LicenseGate.jsx';\n", ""),
    ("import './appearance.css';", "import './appearance.css';\nimport './zorya-theme.css';"),
    ("<LicenseGate>\n      <App />\n    </LicenseGate>", "<App />"),
])

edit("App.jsx", [
    ("import PremiumModal from './components/PremiumModal.jsx';\n", ""),
    ("import { computeRecap, isRecapDay, markShown, recapNow, wasShownToday } from './utils/recap.js';",
     "import { applyLanguage } from './i18n.js';"),
    ("      <PremiumModal account={account} />\n", ""),
    ("  const updater = useUpdater();\n", "  const updater = useUpdater();\n  useEffect(() => { updater.check(); }, []);\n"),
    ("  const [recap, setRecap] = useState(null);", "  const [recap] = useState(null);"),
    ("    setRecap({ sessions: r?.sessions || [], deleted: r?.deleted || [], now: recapNow() });", "    return undefined;"),
    ("      setRecap({ sessions, deleted, now });", "      return undefined;"),
    ("    const res = await runInstallCall(() => window.api.instances.launch(id, null, false));",
     "    const res = await runInstallCall(() => window.api.instances.zoryaLaunch(id));"),
])

# Remove the YearRecap overlay render block entirely.
p = SRC / "App.jsx"
t = p.read_text(encoding="utf-8")
t = re.sub(r"\n\s*\{recap && \(\n.*?\n\s*\)\}\n", "\n", t, flags=re.S)
p.write_text(t, encoding="utf-8")
print("removed YearRecap overlay")

edit("pages/Instance.jsx", [
    ("window.api.instances.launch(instance.id, quickPlay, forceRestart)", "window.api.instances.zoryaLaunch(instance.id)"),
])

edit("pages/Skins.jsx", [
    ("const notMain = isOffline && account.isMain === false;", "const notMain = false;"),
    ("const wornId = isOffline && !notMain ? account.offlineSkinId || null : null;", "const wornId = isOffline ? account.offlineSkinId || null : null;"),
    ("    if (notMain) return; // only a preview: the banner above explains why the skin is not put on\n", ""),
])
p = SRC / "pages/Skins.jsx"
t = p.read_text(encoding="utf-8")
t = re.sub(r"\n\s*\{notMain && \(\n.*?\n\s*\)\}\n", "\n", t, flags=re.S)
p.write_text(t, encoding="utf-8")
print("removed skins main-account banner")

edit("components/AccountFace.jsx", [
    ("account?.type === 'offline' && account.isMain !== false ? account.offlineSkinId", "account?.type === 'offline' ? account.offlineSkinId"),
])
edit("pages/HomePlay.jsx", [
    ("account?.type === 'offline' && account.isMain !== false && account.offlineSkinId", "account?.type === 'offline' && account.offlineSkinId"),
])
edit("components/CustomizeModal.jsx", [
    ("disabled={!isMicrosoft}\n", ""),
])

p = SRC / "pages/Settings.jsx"
t = p.read_text(encoding="utf-8")
needle = "        <div className=\"ui-group\">\n          <div className=\"ui-group-title\">Interface style</div>"
insert = """        <div className="ui-group">
          <div className="ui-group-title">Language / Мова</div>
          <div className="style-picker">
            {[{ id: 'en', name: 'English' }, { id: 'uk', name: 'Українська' }].map((opt) => (
              <button key={opt.id} type="button" className={`style-card ${(settings.language || 'en') === opt.id ? 'active' : ''}`} onClick={() => updateSetting('language', opt.id)}>
                <div className="style-card-name">{opt.name}</div>
              </button>
            ))}
          </div>
        </div>
"""
if needle in t and "Language / Мова" not in t:
    t = t.replace(needle, insert + needle)
    p.write_text(t, encoding="utf-8")
    print("language UI added")
