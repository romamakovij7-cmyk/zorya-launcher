import { useEffect, useMemo, useState } from 'react';
import Select, { LOADER_OPTIONS } from './Select.jsx';
import { autoOptimize } from '../utils/autoOptimize.js';

export default function CreateInstanceModal({ onClose, onCreated }) {
  const [manifest, setManifest] = useState(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [name, setName] = useState('');
  const [mcVersion, setMcVersion] = useState('');
  // 'minecraft' (the usual game, with a mod loader) or 'horizon' (Minecraft rewritten in Rust).
  const [kind, setKind] = useState('minecraft');
  const [loader, setLoader] = useState('vanilla');
  const [loaderVersions, setLoaderVersions] = useState([]);
  const [loaderVersion, setLoaderVersion] = useState('');
  const [loaderError, setLoaderError] = useState(null); // why the list of loader versions did not load
  const [loaderLoading, setLoaderLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [optimize, setOptimize] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    window.api.mc.versionManifest().then((m) => {
      setManifest(m);
      setMcVersion(m.latest.release);
    }).catch((e) => setError(e.message));
  }, []);

  const versionList = useMemo(() => {
    if (!manifest) return [];
    return manifest.versions.filter((v) => showSnapshots || v.type === 'release');
  }, [manifest, showSnapshots]);

  const LOADER_FETCHERS = {
    fabric: window.api.mc.fabricLoaders,
    quilt: window.api.mc.quiltLoaders,
    forge: window.api.mc.forgeLoaders,
    neoforge: window.api.mc.neoforgeLoaders,
  };

  useEffect(() => {
    if (!mcVersion) return;
    setLoaderVersion('');
    setLoaderError(null);
    const fetcher = LOADER_FETCHERS[loader];
    let alive = true; // a late answer for a version the user has already left must not overwrite the list
    if (fetcher) {
      setLoaderLoading(true);
      fetcher(mcVersion).then((list) => {
        if (!alive) return;
        setLoaderVersions(list);
        const stable = list.find((l) => l.stable) || list[0];
        if (stable) setLoaderVersion(stable.loaderVersion);
      }).catch((e) => {
        if (!alive) return;
        setLoaderVersions([]);
        // Electron prefixes the message ("Error invoking remote method …: Error: …")
        setLoaderError(String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));
      }).finally(() => { if (alive) setLoaderLoading(false); });
    } else {
      setLoaderVersions([]);
      setLoaderLoading(false);
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, mcVersion]);

  const isHorizon = kind === 'horizon';
  const needsLoaderVersion = !isHorizon && loader !== 'vanilla';

  async function handleCreate() {
    setError(null);
    if (!name.trim()) { setError('Come up with an instance name.'); return; }
    if (!isHorizon && !mcVersion) { setError('Select the Minecraft version'); return; }
    if (needsLoaderVersion && !loaderVersion) { setError('Select the bootloader version'); return; }
    setBusy(true);
    try {
      const instance = await window.api.instances.create(isHorizon
        ? { name: name.trim(), loader: 'horizon' }
        : {
          name: name.trim(),
          mcVersion,
          loader,
          loaderVersion: loader === 'vanilla' ? null : loaderVersion,
        });
      onCreated(instance);
      // Optimization runs in the background: the instance is already usable,
      // and the mods appear in its Mods tab as they finish downloading.
      if (optimize && !isHorizon) autoOptimize(instance);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Create instance</h2>

        <div className="field">
          <label>Title</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My instance." autoFocus />
        </div>

        <div className="field">
          <label>Game.</label>
          <Select
            value={kind}
            onChange={setKind}
            options={[
              { value: 'minecraft', label: 'Minecraft Java' },
              { value: 'horizon', label: 'Rust (Horizon)' },
            ]}
          />
          {isHorizon && (
            <div className="field-hint">
              Horizon - Minecraft Java, rewritten in Rust. The launcher itself downloads the latest build, Java and Mojang files.
              First launch will take a few minutes.
            </div>
          )}
        </div>

        {!isHorizon && (
          <div className="field">
            <label>Mode loader</label>
            <Select value={loader} onChange={setLoader} options={LOADER_OPTIONS} />
          </div>
        )}

        {!isHorizon && (
          <div className="field">
            <div className="field-label-row">
              <label style={{ marginBottom: 0 }}>Minecraft version</label>
              <label className="snapshot-toggle">
                snapshot
                <input type="checkbox" className="switch small" checked={showSnapshots} onChange={(e) => setShowSnapshots(e.target.checked)} />
              </label>
            </div>
            <Select
              value={mcVersion}
              onChange={setMcVersion}
              disabled={!manifest}
              options={versionList.map((v) => ({ value: v.id, label: v.id, hint: v.type !== 'release' ? v.type : '' }))}
            />
          </div>
        )}

        {needsLoaderVersion && (
          <div className="field">
            <label>Loader version</label>
            <Select
              value={loaderVersion}
              onChange={setLoaderVersion}
              disabled={loaderVersions.length === 0}
              placeholder={loaderLoading ? 'Downloading the list...' : loaderError ? 'The list didn\'t load.' : 'There are no available versions'}
              options={loaderVersions.map((l) => ({ value: l.loaderVersion, label: l.loaderVersion, hint: l.stable ? '' : 'unstable' }))}
            />
            {loaderError && (
              <div className="error-text" style={{ marginTop: 8 }}>
                {loaderError}{' '}
                <button type="button" className="btn-text" onClick={() => { const v = mcVersion; setMcVersion(''); setTimeout(() => setMcVersion(v), 0); }}>Retry</button>
              </div>
            )}
            {(loader === 'forge' || loader === 'neoforge') && (
              <div className="field-hint">
                At the first start of the instance will be downloaded and launched the official installer {loader === 'forge' ? 'Forge' : 'NeoForge'} It may take longer than a normal launch.
              </div>
            )}
          </div>
        )}

        {!isHorizon && loader !== 'vanilla' && (
          <label className="field-hint" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} />
            Install optimization mods automatically (Sodium/Lithium and dependencies)
          </label>
        )}

        {error && <div className="error-text">{error}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancellation</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={busy}>
            {busy ? 'Creation of...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
