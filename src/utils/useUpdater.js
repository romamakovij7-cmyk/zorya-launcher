import { useCallback, useEffect, useRef, useState } from 'react';

// State of the launcher's own update, shared by the banner and the Settings page.
// status: idle | checking | uptodate | available | downloading | ready | installing | error | off
export function useUpdater() {
  const [state, setState] = useState({ status: 'idle', info: null, progress: null, error: null });
  const busy = useRef(false);

  useEffect(() => {
    const offAvailable = window.api.updater.onAvailable((info) => {
      setState((s) => (['downloading', 'ready', 'installing'].includes(s.status) ? s : { status: 'available', info, progress: null, error: null }));
    });
    const offProgress = window.api.updater.onProgress((progress) => {
      setState((s) => (s.status === 'downloading' ? { ...s, progress } : s));
    });
    return () => { offAvailable(); offProgress(); };
  }, []);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState((s) => ({ ...s, status: 'checking', error: null }));
    const res = await window.api.updater.check();
    busy.current = false;
    if (!res.ok) setState((s) => ({ ...s, status: 'error', error: res.error }));
    else if (!res.configured) setState((s) => ({ ...s, status: 'off', info: res }));
    else setState({ status: res.hasUpdate ? 'available' : 'uptodate', info: res, progress: null, error: null });
  }, []);

  const download = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState((s) => ({ ...s, status: 'downloading', progress: { loaded: 0, total: s.info?.size || 0 }, error: null }));
    const res = await window.api.updater.download();
    busy.current = false;
    setState((s) => (res.ok ? { ...s, status: 'ready' } : { ...s, status: 'error', error: res.error }));
  }, []);

  const install = useCallback(async () => {
    setState((s) => ({ ...s, status: 'installing', error: null }));
    const res = await window.api.updater.install();
    // On success the launcher quits by itself; only a refusal comes back here.
    if (!res.ok) setState((s) => ({ ...s, status: 'ready', error: res.error }));
  }, []);

  return { ...state, check, download, install };
}
