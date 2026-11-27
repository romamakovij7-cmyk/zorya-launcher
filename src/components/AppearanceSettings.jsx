// Settings → Interface → Appearance: themes, accent colour (own colour too), background picture, glass, size and density.
// Every change is applied at once (App.jsx watches the settings) and saved.
import { useEffect, useRef, useState } from 'react';
import { ACCENT_PRESETS } from '../utils/accent.js';
import { THEMES, DEFAULT_APPEARANCE } from '../utils/theme.js';

// commitOnRelease: the value is applied only when the handle is let go (for things that reflow the whole window, like the
// interface size — applying while dragging made the layout jump around); otherwise it is applied live while dragging.
function Slider({
  label, value, min, max, step = 1, unit = '', onChange, disabled, commitOnRelease = false,
}) {
  const [draft, setDraft] = useState(null); // while dragging: what the handle shows
  const shown = draft ?? value;
  const release = () => {
    if (draft !== null && commitOnRelease && draft !== value) onChange(draft);
    setDraft(null);
  };
  return (
    <label className="appearance-slider">
      <span>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={shown} disabled={disabled}
        onChange={(e) => { const v = Number(e.target.value); setDraft(v); if (!commitOnRelease) onChange(v); }}
        onPointerUp={release} onPointerCancel={release} onKeyUp={release} onBlur={release}
      />
      <output>{shown}{unit}</output>
    </label>
  );
}

const DENSITIES = [['compact', 'Compact'], ['normal', 'Normal.'], ['roomy', 'Spacious']];

export default function AppearanceSettings({ settings, updateSetting, updateSettings }) {
  const theme = THEMES.find((t) => t.id === settings.theme) || THEMES[0];
  const accent = settings.accentColor || 'rose';
  const [bgPreview, setBgPreview] = useState(null);
  const [bgError, setBgError] = useState(null);
  const colorTimer = useRef(null);

  // Preview of the chosen background in the settings (a separate object URL, so it needs no App state).
  useEffect(() => {
    let alive = true;
    let url = null;
    if (!settings.bgFile) { setBgPreview(null); return undefined; }
    window.api.appearance.getBackground().then((res) => {
      if (!alive || !res?.ok) return;
      url = URL.createObjectURL(new Blob([res.data], { type: res.mime }));
      setBgPreview(url);
    }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [settings.bgFile]);

  function pickTheme(t) {
    // A theme with its own natural accent (the blue one) brings it along when the accent is still the default.
    if (accent === 'rose' && t.suggestAccent !== 'rose') updateSettings({ theme: t.id, accentColor: t.suggestAccent });
    else updateSetting('theme', t.id);
  }

  function pickColor(hex) {
    clearTimeout(colorTimer.current);
    colorTimer.current = setTimeout(() => updateSettings({ accentCustom: hex, accentColor: 'custom' }), 120);
  }

  async function chooseBackground() {
    setBgError(null);
    const res = await window.api.appearance.pickBackground();
    if (res?.ok) updateSettings({ bgFile: res.file });
    else if (res?.error) setBgError(res.error);
  }

  async function removeBackground() {
    await window.api.appearance.clearBackground();
    updateSettings({ bgFile: null });
  }

  // the picture behind the character on the "Play view" home screen
  const [sceneError, setSceneError] = useState(null);
  async function chooseScene() {
    setSceneError(null);
    const res = await window.api.appearance.pickSceneBackground();
    if (res?.ok) updateSettings({ homeSceneFile: res.file });
    else if (res?.error) setSceneError(res.error);
  }
  async function removeScene() {
    await window.api.appearance.clearSceneBackground();
    updateSettings({ homeSceneFile: null });
  }

  function reset() {
    if (!window.confirm('Return the default design? The background picture will also be removed.')) return;
    window.api.appearance.clearBackground();
    window.api.appearance.clearSceneBackground();
    updateSettings({ ...DEFAULT_APPEARANCE, homeSceneFile: null });
  }

  const layout = settings.homeLayout === 'play' ? 'play' : 'library';

  return (
    <>
      <div className="ui-group">
        <div className="ui-group-title">Main screen screen</div>
        <div className="layout-grid">
          <button type="button" className={`layout-card ${layout === 'library' ? 'active' : ''}`} onClick={() => updateSetting('homeLayout', 'library')}>
            <div className="layout-card-preview">
              <div className="lc-block" style={{ height: 14, flex: 'none', width: '46%' }} />
              <div className="lc-row"><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /></div>
              <div className="lc-row"><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /></div>
            </div>
            <div className="layout-card-name">Library</div>
            <div className="layout-card-desc">Grid of instances and recent worlds</div>
          </button>
          <button type="button" className={`layout-card ${layout === 'play' ? 'active' : ''}`} onClick={() => updateSetting('homeLayout', 'play')}>
            <div className="layout-card-preview">
              <div className="lc-row">
                <div style={{ width: 34, display: 'flex', flexDirection: 'column', gap: 4 }}><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /></div>
                <div className="lc-grow" style={{ display: 'flex', justifyContent: 'center' }}><span className="lc-fig" /></div>
                <div style={{ width: 34, display: 'flex', flexDirection: 'column', gap: 4 }}><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /></div>
              </div>
              <div className="lc-row" style={{ flex: 'none', height: 20 }}><span className="lc-block lc-grow" /><span className="lc-block hot" style={{ width: 54 }} /></div>
            </div>
            <div className="layout-card-name">Play view</div>
            <div className="layout-card-desc">Character and big \"Play\" button</div>
          </button>
        </div>
        {layout === 'play' && (
          <div className="settings-row" style={{ marginTop: 14 }}>
            <div>
              <div className="settings-row-label">Background behind the character</div>
              <div className="settings-row-desc">Night pixel scene with mountains, moon and sparks or your own picture. Turn it off if you want a simple background.</div>
            </div>
            <input
              type="checkbox"
              className="switch"
              checked={settings.homeScene !== false}
              onChange={(e) => updateSetting('homeScene', e.target.checked)}
            />
          </div>
        )}
        {layout === 'play' && settings.homeScene !== false && (
          <div className="settings-row" style={{ marginTop: 6 }}>
            <div>
              <div className="settings-row-label">My picture.</div>
              <div className="settings-row-desc">
                {settings.homeSceneFile ? 'It shows a picture instead of a night scene.' : 'Select PNG, JPG, WebP or GIF (up to 20 MB). She will stand behind the character on the whole block.'}
                {sceneError && <span className="error-text" style={{ display: 'block' }}>{sceneError}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={chooseScene}>{settings.homeSceneFile ? 'Replace...' : 'Choose…'}</button>
              {settings.homeSceneFile && <button className="btn" onClick={removeScene}>Bring the stage back</button>}
            </div>
          </div>
        )}
      </div>

      <div className="ui-group">
        <div className="ui-group-title">Theme</div>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button key={t.id} type="button" className={`theme-card ${theme.id === t.id ? 'active' : ''}`} onClick={() => pickTheme(t)}>
              <div className="theme-card-preview" style={{ background: t.preview.bg }}>
                <span className="theme-card-side" style={{ background: t.preview.panel }} />
                <span className="theme-card-main">
                  <span className="theme-card-bar" style={{ background: t.preview.bar }} />
                  <span className="theme-card-chip" style={{ background: t.preview.panel, border: `1px solid ${t.preview.bar}` }} />
                </span>
              </div>
              <div className="theme-card-name">{t.name}</div>
              <div className="theme-card-desc">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="ui-group">
        <div className="ui-group-title">Accent color</div>
        <div className="accent-picker">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.id} type="button" className={`accent-swatch ${accent === p.id ? 'active' : ''}`}
              onClick={() => updateSetting('accentColor', p.id)} title={p.name}
            >
              <span className="accent-swatch-dot" style={{ background: `linear-gradient(135deg, ${p.wine}, ${p.rose})` }} />
              <span className="accent-swatch-name">{p.name}</span>
            </button>
          ))}
          <label className={`accent-swatch ${accent === 'custom' ? 'active' : ''}`} title="Your color.">
            <span className="accent-custom">
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(settings.accentCustom) ? settings.accentCustom : '#B85C72'} onChange={(e) => pickColor(e.target.value)} />
            </span>
            <span className="accent-swatch-name">Yours.</span>
          </label>
        </div>
      </div>

      <div className="ui-group">
        <div className="ui-group-title">von</div>
        <div className="bg-picker">
          <div className="bg-preview" style={bgPreview ? { backgroundImage: `url("${bgPreview}")` } : undefined} />
          <button className="btn" onClick={chooseBackground}>{settings.bgFile ? 'Another picture.' : 'Select a picture'}</button>
          {settings.bgFile && <button className="btn" onClick={removeBackground}>Clean up.</button>}
        </div>
        {bgError && <div className="error-text" style={{ marginBottom: 8 }}>{bgError}</div>}
        {settings.bgFile && (
          <>
            <Slider label="Background dimming" value={settings.bgDim ?? 50} min={0} max={100} unit="%" onChange={(v) => updateSetting('bgDim', v)} />
            <Slider label="Blurring background" value={settings.bgBlur ?? 0} min={0} max={30} unit=" px" onChange={(v) => updateSetting('bgBlur', v)} />
          </>
        )}
      </div>

      <div className="ui-group">
        <div className="ui-group-title">Glass.</div>
        <Slider label="Transparency of panels" value={settings.glassOpacity ?? 50} min={0} max={100} unit="%" disabled={theme.flat} onChange={(v) => updateSetting('glassOpacity', v)} />
        <Slider label="Blurring behind the panels" value={settings.glassBlur ?? 50} min={0} max={100} unit="%" disabled={theme.flat} onChange={(v) => updateSetting('glassBlur', v)} />
        {theme.flat && <div className="ui-toggle-desc">In the topic of “minimalism” there is no glass: the panels are solid.</div>}
      </div>

      <div className="ui-group">
        <div className="ui-group-title">Size and density</div>
        <Slider label="Interface size" value={settings.uiScale ?? 100} min={80} max={130} step={5} unit="%" commitOnRelease onChange={(v) => updateSetting('uiScale', v)} />
        <div className="pill-tabs" style={{ marginTop: 8 }}>
          {DENSITIES.map(([id, label]) => (
            <button key={id} className={`pill-tab ${(settings.density || 'normal') === id ? 'active' : ''}`} onClick={() => updateSetting('density', id)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="ui-group">
        <button className="btn" onClick={reset}>Reset the design</button>
      </div>
    </>
  );
}
