import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, SearchIcon } from './Icons.jsx';
import {
  FORM_EXTENSIONS, extensionOf, parseConfig, setConfigValue,
} from '../utils/configParse.js';

const LINE_HEIGHT = 20;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Built-in text editor for the instance's files (configs above all).
// - "Text" mode: a plain editor with line numbers, find/replace, Ctrl+S,
//   Tab indentation and (for .json) validation + formatting.
// - "Parameters" mode (for .toml/.cfg/.properties/...): the file's simple
//   `key = value` lines as a form — switches for true/false, number and text
//   fields — with the comment above each setting shown as its description.
//   Only the edited value changes in the file; everything else is left alone.
export default function FileEditorModal({ instanceId, relPath, onClose, onSaved }) {
  const name = relPath.split('/').pop();
  const ext = extensionOf(name);
  const formCapable = FORM_EXTENSIONS.includes(ext);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [original, setOriginal] = useState('');
  const [content, setContent] = useState('');
  const [meta, setMeta] = useState({ bom: false, eol: '\n', size: 0 });
  const [mode, setMode] = useState('text');
  const [wrap, setWrap] = useState(false);
  const [backup, setBackup] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [formFilter, setFormFilter] = useState('');
  const taRef = useRef(null);
  const gutterRef = useRef(null);
  const findInputRef = useRef(null);

  const dirty = content !== original;

  useEffect(() => {
    let cancelled = false;
    window.api.files.readText(instanceId, relPath).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) { setError(res.error); return; }
      setOriginal(res.content);
      setContent(res.content);
      setMeta({ bom: res.bom, eol: res.eol, size: res.size });
      if (formCapable && parseConfig(res.content).length >= 3) setMode('form');
    });
    return () => { cancelled = true; };
  }, [instanceId, relPath]);

  const lineCount = useMemo(() => content.split('\n').length, [content]);

  // JSON files: live validity check.
  const jsonStatus = useMemo(() => {
    if (ext !== 'json' && ext !== 'mcmeta') return null;
    if (!content.trim()) return { ok: true };
    try {
      JSON.parse(content);
      return { ok: true };
    } catch (err) {
      const pos = /position (\d+)/.exec(err.message);
      const line = pos ? content.slice(0, Number(pos[1])).split('\n').length : null;
      return { ok: false, text: `${err.message.replace(/^JSON\.parse: /, '')}${line ? ` (line ${line})` : ''}` };
    }
  }, [content, ext]);

  const formItems = useMemo(() => (mode === 'form' ? parseConfig(content) : []), [mode, content]);

  // ---- saving / closing --------------------------------------------------

  async function save() {
    if (saving || loading || error) return;
    if (jsonStatus && !jsonStatus.ok && !confirm(`JSON has an error: ${jsonStatus.text}Keep it anyway?`)) return;
    setSaving(true);
    setMessage(null);
    const res = await window.api.files.writeText(instanceId, relPath, {
      content, bom: meta.bom, eol: meta.eol, backup,
    });
    setSaving(false);
    if (!res.ok) { setMessage({ error: true, text: res.error }); return; }
    setOriginal(content);
    setMessage({ text: 'Saved' });
    onSaved?.();
  }

  function requestClose() {
    if (dirty && !confirm('There are unsaved changes. Close without saving?')) return;
    onClose();
  }

  useEffect(() => {
    function onKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyS') { e.preventDefault(); save(); }
      else if (mod && e.code === 'KeyF' && mode === 'text') { e.preventDefault(); setFindOpen(true); setTimeout(() => findInputRef.current?.select(), 0); }
      else if (e.key === 'Escape') { if (findOpen) setFindOpen(false); else requestClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, original, mode, findOpen, meta, backup, saving, loading, error, jsonStatus]);

  // ---- textarea helpers ------------------------------------------------------

  function updateCursor() {
    const ta = taRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const lines = before.split('\n');
    setCursor({ line: lines.length, col: lines[lines.length - 1].length + 1 });
  }

  // Inserts text through the browser's own edit pipeline so the textarea's
  // native undo (Ctrl+Z) keeps working.
  function insertAtCursor(text) {
    const ta = taRef.current;
    ta.focus();
    if (!document.execCommand('insertText', false, text)) {
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      setContent(ta.value);
    }
  }

  function onKeyDownText(e) {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      insertAtCursor(/^\t/m.test(content) ? '\t' : '  ');
    }
  }

  function syncGutter() {
    if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop;
  }

  function selectRange(start, end) {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(start, end);
    const line = ta.value.slice(0, start).split('\n').length - 1;
    ta.scrollTop = Math.max(0, line * LINE_HEIGHT - ta.clientHeight / 2);
    syncGutter();
    updateCursor();
  }

  // ---- find / replace ------------------------------------------------------------

  const matchCount = useMemo(() => {
    if (!findText) return 0;
    return (content.match(new RegExp(escapeRegExp(findText), 'gi')) || []).length;
  }, [content, findText]);

  function findNext(dir = 1) {
    const ta = taRef.current;
    if (!ta || !findText) return;
    const hay = ta.value.toLowerCase();
    const needle = findText.toLowerCase();
    let idx;
    if (dir === 1) {
      idx = hay.indexOf(needle, ta.selectionEnd);
      if (idx < 0) idx = hay.indexOf(needle);
    } else {
      idx = ta.selectionStart > 0 ? hay.lastIndexOf(needle, ta.selectionStart - 1) : -1;
      if (idx < 0) idx = hay.lastIndexOf(needle);
    }
    if (idx >= 0) selectRange(idx, idx + needle.length);
  }

  function replaceOne() {
    const ta = taRef.current;
    if (!ta || !findText) return;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel.toLowerCase() === findText.toLowerCase() && sel) insertAtCursor(replaceText);
    findNext(1);
  }

  function replaceAll() {
    const ta = taRef.current;
    if (!ta || !findText || matchCount === 0) return;
    const next = content.replace(new RegExp(escapeRegExp(findText), 'gi'), () => replaceText);
    ta.focus();
    ta.select();
    if (!document.execCommand('insertText', false, next)) setContent(next);
    setMessage({ text: `Replaced: ${matchCount}` });
  }

  function formatJson() {
    try {
      const pretty = JSON.stringify(JSON.parse(content), null, 2);
      const ta = taRef.current;
      ta.focus();
      ta.select();
      if (!document.execCommand('insertText', false, pretty)) setContent(pretty);
    } catch (err) {
      setMessage({ error: true, text: `You can’t format: ${err.message}` });
    }
  }

  // ---- form mode --------------------------------------------------------------------

  function setValue(item, raw) {
    setContent((prev) => setConfigValue(prev, item, raw));
  }

  function renderControl(item) {
    if (item.type === 'bool') {
      return (
        <input
          type="checkbox" className="switch"
          checked={item.value === 'true'}
          onChange={(e) => setValue(item, e.target.checked ? 'true' : 'false')}
        />
      );
    }
    if (item.type === 'number') {
      return (
        <input
          className="text-input cfg-input" type="text" inputMode="decimal"
          value={item.value}
          onChange={(e) => setValue(item, e.target.value.replace(/[^0-9eE+.\-]/g, ''))}
        />
      );
    }
    if (item.type === 'string') {
      const quote = item.value[0];
      return (
        <input
          className="text-input cfg-input"
          value={item.value.slice(1, -1)}
          onChange={(e) => setValue(item, `${quote}${e.target.value}${quote}`)}
        />
      );
    }
    return (
      <input className="text-input cfg-input" value={item.value} onChange={(e) => setValue(item, e.target.value)} />
    );
  }

  const shownItems = useMemo(() => {
    const q = formFilter.trim().toLowerCase();
    if (!q) return formItems;
    return formItems.filter((i) => i.key.toLowerCase().includes(q)
      || i.comment.toLowerCase().includes(q) || i.section.toLowerCase().includes(q));
  }, [formItems, formFilter]);

  let lastSection = null;

  return createPortal(
    <div className="shot-editor-overlay">
      <div className="file-editor">
        <div className="shot-editor-head">
          <div style={{ minWidth: 0 }}>
            <div className="shot-editor-title">
              {name}{dirty && <span className="file-editor-dirty" title="There are unsaved changes"> ●</span>}
            </div>
            <div className="shot-editor-sub">{relPath}</div>
          </div>
          <div className="shot-editor-head-actions">
            {formCapable && (
              <div className="pill-tabs file-editor-modes">
                <button className={`pill-tab ${mode === 'form' ? 'active' : ''}`} onClick={() => setMode('form')}>Parameters</button>
                <button className={`pill-tab ${mode === 'text' ? 'active' : ''}`} onClick={() => setMode('text')}>Text</button>
              </div>
            )}
            <button className="btn btn-primary" onClick={save} disabled={!dirty || saving || loading || !!error} title="Save (Ctrl+S)">
              {saving ? 'Conservation...' : 'Save'}
            </button>
            <button className="icon-btn" onClick={requestClose} title="Close (Esc)"><CloseIcon /></button>
          </div>
        </div>

        {loading && <div className="progress-label" style={{ padding: 24 }}>Loading...</div>}
        {error && <div className="error-text" style={{ padding: 24, whiteSpace: 'pre-wrap' }}>{error}</div>}

        {!loading && !error && mode === 'text' && (
          <>
            <div className="file-editor-tools">
              <button className="btn" onClick={() => { setFindOpen((v) => !v); setTimeout(() => findInputRef.current?.focus(), 0); }} title="Search and Replacement (Ctrl+F)">
                <SearchIcon width={14} height={14} /> Find
              </button>
              <label className="snapshot-toggle">
                lineage
                <input type="checkbox" className="switch small" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
              </label>
              {jsonStatus && (
                <>
                  <button className="btn" onClick={formatJson} disabled={!jsonStatus.ok}>Format JSON</button>
                  <span className={jsonStatus.ok ? 'file-editor-ok' : 'file-editor-bad'}>
                    {jsonStatus.ok ? 'JSON is correct' : jsonStatus.text}
                  </span>
                </>
              )}
            </div>

            {findOpen && (
              <div className="file-editor-find">
                <input
                  ref={findInputRef} className="text-input" placeholder="Search…" value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); } }}
                />
                <input
                  className="text-input" placeholder="Replace by..." value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } }}
                />
                <span className="file-editor-count">{findText ? `${matchCount} matches` : ''}</span>
                <button className="btn" onClick={() => findNext(-1)} disabled={!matchCount}>↑</button>
                <button className="btn" onClick={() => findNext(1)} disabled={!matchCount}>↓</button>
                <button className="btn" onClick={replaceOne} disabled={!matchCount}>Replace</button>
                <button className="btn" onClick={replaceAll} disabled={!matchCount}>All</button>
              </div>
            )}

            <div className="file-editor-area">
              {!wrap && (
                <div className="file-editor-gutter" ref={gutterRef} aria-hidden="true">
                  {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
                </div>
              )}
              <textarea
                ref={taRef}
                className={`file-editor-text ${wrap ? 'wrap' : ''}`}
                value={content}
                spellCheck={false}
                onChange={(e) => setContent(e.target.value)}
                onScroll={syncGutter}
                onKeyDown={onKeyDownText}
                onKeyUp={updateCursor}
                onClick={updateCursor}
                onSelect={updateCursor}
              />
            </div>
          </>
        )}

        {!loading && !error && mode === 'form' && (
          <div className="file-editor-form">
            <div className="search-bar" style={{ marginBottom: 12 }}>
              <SearchIcon width={16} height={16} />
              <input placeholder={`Search for parameters (${formItems.length})…`} value={formFilter} onChange={(e) => setFormFilter(e.target.value)} />
            </div>
            {formItems.length === 0 && (
              <div className="empty-state" style={{ padding: 40 }}>
                <p>There are no simple parameters “key = value“ in the file - open the tab “Text“.</p>
              </div>
            )}
            <div className="cfg-list">
              {shownItems.map((item) => {
                const header = item.section !== lastSection && !formFilter ? item.section : null;
                lastSection = item.section;
                return (
                  <div key={item.line}>
                    {header !== null && header !== '' && <div className="cfg-section">{header}</div>}
                    <div className="cfg-row">
                      <div className="cfg-row-text">
                        <div className="cfg-key">{item.key}</div>
                        {item.comment && <div className="cfg-comment">{item.comment}</div>}
                      </div>
                      <div className="cfg-control">{renderControl(item)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="file-editor-foot">
          <span>{mode === 'text' ? `Line ${cursor.line}, column ${cursor.col} · ` : ''}{lineCount} lines · {content.length.toLocaleString('en-US')} Simv. • {meta.eol === '\r\n' ? 'CRLF' : 'LF'}{meta.bom ? ' · UTF-8 BOM' : ' · UTF-8'}</span>
          <span className="file-editor-foot-right">
            {message && <span className={message.error ? 'file-editor-bad' : 'file-editor-ok'}>{message.text}</span>}
            <label className="snapshot-toggle" title="Before saving the old version is copied to “name.bak“">
              backup
              <input type="checkbox" className="switch small" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
            </label>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
