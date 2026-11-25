import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SkinViewer, IdleAnimation } from 'skinview3d';
import Select from './Select.jsx';
import { CloseIcon } from './Icons.jsx';
import { attachBreasts } from '../utils/breasts.js';
import { GENDER_CHANGED } from '../utils/useGenderLook.js';
import { attachFreshEyes } from '../utils/freshEyes.js';
import { readFreshLook } from '../utils/useFreshLook.js';

// Живой предпросмотр: персонаж с текущим скином и настройками из окна (до сохранения), его можно крутить мышью
const BASE_Y = -7; // the camera looks at the middle of the whole figure; this moves the head and the chest into that spot
const HOP = 0.16; // how much of a real jump (1.25 blocks = 20 px) is shown: the frame holds only the upper body, with little room above the head

function Preview({ skinUrl, skinVariant, settings, jumpRef }) {
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const breastsRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    // Кадр: голова и верх тела (от макушки примерно до середины торса), по центру; персонаж не вращается сам, повернут на три четверти,
    // чтобы была видна форма груди (мышью его можно повернуть вручную)
    const viewer = new SkinViewer({ canvas: canvasRef.current, width: 240, height: 360, fov: 40, zoom: 1.32 });
    viewer.animation = new IdleAnimation();
    viewer.controls.enableZoom = false;
    viewer.controls.enablePan = false;
    viewer.autoRotate = false;
    viewer.playerObject.position.y = BASE_Y;
    viewer.playerObject.rotation.y = -0.4;
    viewerRef.current = viewer;
    // the character hops while a jump lasts (height in blocks → pixels of the model, a part of the real height)
    const ctrl = attachBreasts(viewer, { onHeight: (blocks) => { viewer.playerObject.position.y = BASE_Y + blocks * 16 * HOP; } });
    breastsRef.current = ctrl;
    if (jumpRef) jumpRef.current = () => ctrl.jump();
    const eyes = attachFreshEyes(viewer); // глаза Fresh Moves, если они есть в скине (как на главном экране)
    eyes.update(readFreshLook());
    return () => { if (jumpRef) jumpRef.current = null; eyes.dispose(); ctrl.dispose(); breastsRef.current = null; viewer.dispose(); viewerRef.current = null; };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !skinUrl) return;
    viewer.loadSkin(skinUrl, { model: skinVariant === 'slim' ? 'slim' : 'default' }).catch(() => {});
  }, [skinUrl, skinVariant]);

  useEffect(() => { breastsRef.current?.update(settings); }, [settings]);

  return <canvas ref={canvasRef} width={240} height={360} className="gender-preview" title="Pull to rotate" />;
}

// Settings мода Wildfire's Female Gender Mod для персонажа (правый клик по персонажу на главном экране и на странице «Skins»).
// Лаунчер читает файл игрока из выбранной сборки (electron/mc/genderMod.js), показывает поля и пишет изменения в отмеченные сборки.
// Чтобы добавить поле: допишите его в GENDER_FIELDS (и, если оно новое для мода, в FIELDS в electron/mc/genderMod.js).
const GENDER_LABELS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Another' },
];

// Секции окна: { title, fields: [{ key, label, hint?, kind: 'switch' | 'range', min, max, step, digits?, needsBreasts?, versionNote? }] }
const GENDER_SECTIONS = [
  {
    title: 'Appearance',
    fields: [
      { key: 'bust_size', label: 'Size', kind: 'range', min: 0, max: 1, step: 0.01, digits: 2, needsBreasts: true },
      { key: 'breasts_uniboob', label: 'Single breast', hint: 'One general form instead of two', kind: 'switch', needsBreasts: true },
      { key: 'breasts_cleavage', label: 'The cut between', kind: 'range', min: 0, max: 0.2, step: 0.005, digits: 3, needsBreasts: true },
      { key: 'breasts_xOffset', label: 'Width offset', kind: 'range', min: -1, max: 1, step: 0.01, digits: 2, needsBreasts: true },
      { key: 'breasts_yOffset', label: 'Height offset', kind: 'range', min: -1, max: 1, step: 0.01, digits: 2, needsBreasts: true },
      { key: 'breasts_zOffset', label: 'Forward-backward shift', kind: 'range', min: -1, max: 1, step: 0.01, digits: 2, needsBreasts: true },
      { key: 'show_in_armor', label: 'Show in armor', kind: 'switch', needsBreasts: true },
    ],
  },
  {
    title: 'Physics',
    fields: [
      { key: 'breast_physics', label: 'Physics', kind: 'switch', needsBreasts: true },
      { key: 'breast_physics_armor', label: 'Physics in armor', kind: 'switch', needsBreasts: true },
      { key: 'bounce_multiplier', label: 'Bouncing', kind: 'range', min: 0, max: 1, step: 0.01, digits: 2, needsBreasts: true },
      { key: 'floppy_multiplier', label: 'Oscillations', kind: 'range', min: 0, max: 1, step: 0.01, digits: 2, needsBreasts: true },
    ],
  },
  {
    title: 'Sound',
    fields: [
      { key: 'hurt_sounds', label: 'Sounds of pain', kind: 'switch' },
      { key: 'voice_pitch', label: 'Voice pitch', kind: 'range', min: 0.5, max: 1.5, step: 0.01, digits: 2 },
    ],
  },
  {
    title: 'Other',
    fields: [
      { key: 'holiday_themes', label: 'Holiday themes', kind: 'switch' },
    ],
  },
];

export default function GenderModal({ account, skinUrl, skinVariant, onClose }) {
  const [instances, setInstances] = useState(null); // сборки с модом
  const [sourceId, setSourceId] = useState('');
  const [targets, setTargets] = useState(new Set());
  const [info, setInfo] = useState(null); // { format, version, exists, settings } выбранной сборки
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const jumpRef = useRef(null); // the preview puts its "jump" here
  const [message, setMessage] = useState(null); // { ok, text }

  useEffect(() => {
    let alive = true;
    window.api.genderMod.detect().then((r) => {
      if (!alive) return;
      const list = r?.ok ? r.instances : [];
      setInstances(list);
      if (list.length) { setSourceId(list[0].id); setTargets(new Set(list.map((i) => i.id))); }
    }).catch(() => alive && setInstances([]));
    return () => { alive = false; };
  }, []);

  // Текущие настройки берём из выбранной сборки
  useEffect(() => {
    if (!sourceId || !account) return undefined;
    let alive = true;
    setInfo(null); setSettings(null);
    window.api.genderMod.get(sourceId, account.id).then((r) => {
      if (!alive) return;
      if (r?.ok && r.present) { setInfo(r); setSettings({ ...r.settings, uv: r.uv || undefined }); } else setMessage({ ok: false, text: r?.error || 'Failed to read mod settings' });
    }).catch((e) => alive && setMessage({ ok: false, text: e.message }));
    return () => { alive = false; };
  }, [sourceId, account]);

  const hasBreasts = settings ? settings.gender !== 'male' : true;
  const set = (key, value) => { setSettings((s) => ({ ...s, [key]: value })); setMessage(null); };
  const sourceOptions = useMemo(() => (instances || []).map((i) => ({ value: i.id, label: `${i.name} · ${i.mcVersion}`, hint: i.format === 'v5' ? 'mod 5.x' : 'mod 3.x' })), [instances]);

  function toggleTarget(id) {
    setTargets((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function save() {
    if (!settings || !targets.size) return;
    setBusy(true); setMessage(null);
    try {
      const res = await window.api.genderMod.set([...targets], account.id, settings);
      const failed = (res?.results || []).filter((r) => !r.ok);
      if (res?.ok) {
        setMessage({ ok: true, text: `Сохранено в сборках: ${res.results.length}. Settings применятся при следующем запуске игры.` });
        window.dispatchEvent(new Event(GENDER_CHANGED)); // персонаж на главном экране и в «Скинах» обновится сразу
      }
      else setMessage({ ok: false, text: failed.length ? failed.map((f) => `${f.name || ''}: ${f.error}`).join('\n') : (res?.error || 'Failed сохранить') });
    } catch (e) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const isOnList = (field) => !info || !settings || field.key in settings; // поле есть в формате файла этой сборки

  // На верхнем уровне страницы (не внутри блока персонажа): иначе нижняя панель «Играть» главного экрана перекрывает окно
  return createPortal((
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal gender-modal" onClick={(e) => e.stopPropagation()}>
        <div className="customize-modal-header">
          <h2>Female Gender Mod</h2>
          <button className="icon-btn" onClick={onClose}><CloseIcon /></button>
        </div>
        <p className="hint-text gender-sub">Settings персонажа {account ? account.name : ''} для мода. Применяются при следующем запуске сборки с модом.</p>

        {!account && <div className="hint-text">Войдите в аккаунт, чтобы менять настройки.</div>}
        {account && instances === null && <div className="progress-label">Ищем сборки с модом…</div>}
        {account && instances && instances.length === 0 && (
          <div className="empty-state"><p>Mod Female Gender не найден ни в одной сборке. Установите его в сборку (вкладка «Mods»), и здесь появятся настройки.</p></div>
        )}

        {account && instances && instances.length > 0 && (
          <>
            <div className="gender-source">
              <span className="settings-block-label">Взять настройки из сборки</span>
              <Select value={sourceId} onChange={setSourceId} options={sourceOptions} />
            </div>

            {!settings && !message && <div className="progress-label">Читаем настройки…</div>}

            {settings && (
              <div className="gender-layout">
                <div className="gender-preview-col">
                  <Preview skinUrl={skinUrl} skinVariant={skinVariant} settings={settings} jumpRef={jumpRef} />
                  <div className="gender-preview-label">{GENDER_LABELS.find((g) => g.value === settings.gender)?.label}</div>
                  <button
                    className="btn gender-jump" onClick={() => jumpRef.current?.()} disabled={settings.gender === 'male'}
                    title={settings.gender === 'male' ? 'Males do not have breast physics' : 'Jump up and see how the physics behaves (Physics must be turned on)'}
                  >
                    Прыжок
                  </button>
                </div>
              <div className="gender-body">
                {info && !info.exists && <div className="hint-text gender-new">У этого игрока в этой сборке файла настроек ещё нет: сохранение создаст его.</div>}

                <div className="gender-row">
                  <div className="gender-row-label">Пол</div>
                  <div className="pill-tabs" style={{ marginBottom: 0 }}>
                    {GENDER_LABELS.map((g) => (
                      <button key={g.value} className={`pill-tab ${settings.gender === g.value ? 'active' : ''}`} onClick={() => set('gender', g.value)}>{g.label}</button>
                    ))}
                  </div>
                </div>

                {GENDER_SECTIONS.map((section) => {
                  const fields = section.fields.filter(isOnList);
                  if (!fields.length) return null;
                  return (
                    <div className="gender-section" key={section.title}>
                      <div className="gender-section-title">{section.title}</div>
                      {fields.map((f) => {
                        const off = f.needsBreasts && !hasBreasts;
                        return (
                          <div className={`gender-row ${off ? 'dim' : ''}`} key={f.key}>
                            <div className="gender-row-label">{f.label}{f.hint && <small>{f.hint}</small>}</div>
                            {f.kind === 'switch' ? (
                              <input type="checkbox" className="switch" checked={!!settings[f.key]} disabled={off} onChange={(e) => set(f.key, e.target.checked)} />
                            ) : (
                              <div className="gender-range">
                                <input
                                  type="range" className="mem-range" min={f.min} max={f.max} step={f.step} value={settings[f.key]} disabled={off}
                                  onChange={(e) => set(f.key, Number(e.target.value))}
                                />
                                <span>{Number(settings[f.key]).toFixed(f.digits ?? 2)}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                <div className="gender-section">
                  <div className="gender-section-title">Apply в сборках</div>
                  <div className="gender-targets">
                    {instances.map((i) => (
                      <label className="gender-target" key={i.id}>
                        <input type="checkbox" checked={targets.has(i.id)} onChange={() => toggleTarget(i.id)} />
                        <span>{i.name} <small>{i.mcVersion} · {i.format === 'v5' ? 'mod 5.x' : 'mod 3.x'}</small></span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              </div>
            )}

            {message &&<div className={message.ok ? 'hint-text gender-msg ok' : 'error-text gender-msg'} style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>}

            <div className="modal-actions gender-actions">
              <button className="btn" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={save} disabled={busy || !settings || !targets.size}>{busy ? 'Let\'s save...' : `Save${targets.size ? ` (${targets.size})` : ''}`}</button>
            </div>
          </>
        )}
        {account && instances && instances.length === 0 && (
          <div className="modal-actions"><button className="btn" onClick={onClose}>Close</button></div>
        )}
      </div>
    </div>
  ), document.body);
}
