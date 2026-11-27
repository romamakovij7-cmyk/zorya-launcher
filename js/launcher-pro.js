/**
 * launcher-pro.js — страница лаунчера, основной дизайн.
 * Страница читается и без скрипта. Здесь только: появление блоков, скачивание, наклон скриншота в hero,
 * 3D-персонаж в «Скинах и плащах», цвет страницы, скриншот на весь экран, счётчик.
 * Скачивание: подписка не нужна, но нужен вход на сайте; версию и размер берём с сервера (/api/launcher/info).
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var qa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var calm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var body = document.body;
  document.documentElement.classList.add('lp-js');

  function whenVisible(el, cb) {
    if (!el) return;
    if (!('IntersectionObserver' in window)) { cb(true); return; }
    new IntersectionObserver(function (es) { cb(es[0].isIntersecting); }, { threshold: 0.1 }).observe(el);
  }

  // ------------------------------------------------------------------ появление блоков
  (function () {
    var els = qa('.lp-rv');
    if (calm || !('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('is-in'); }); return; }
    qa('.lp-bento, .lp-sec3').forEach(function (g) { qa('.lp-rv', g).forEach(function (e, i) { e.style.setProperty('--d', (i * 0.07) + 's'); }); });
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach(function (e) { io.observe(e); });
  })();

  // ------------------------------------------------------------------ download
  (function () {
    var LINK = "https://github.com/romamakovij7-cmyk/zorya-launcher/releases/latest";
    var btns = [['lnGet', 'lnGetText'], ['lnGet2', 'lnGetText2']].map(function (p) { return { a: $(p[0]), t: $(p[1]) }; }).filter(function (b) { return b.a && b.t; });
    var meta = $('lnMeta');
    btns.forEach(function (b) {
      b.a.classList.remove('is-off');
      b.a.href = LINK;
      b.a.removeAttribute('download');
      b.t.textContent = 'Download for Windows';
      b.a.addEventListener('click', function () { location.href = LINK; });
    });
    if (meta) meta.textContent = 'Windows 10/11 · 64-bit · installer from GitHub';
    // Resolve the newest installer asset so the button never points at an old tag.
    fetch('https://api.github.com/repos/romamakovij7-cmyk/zorya-launcher/releases/latest')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rel) {
        if (!rel || !rel.assets) return;
        var exe = rel.assets.find(function (a) { return /\.exe$/i.test(a.name); });
        if (!exe) return;
        LINK = exe.browser_download_url;
        btns.forEach(function (b) { b.a.href = LINK; });
      })
      .catch(function () {});
  })();

  // ------------------------------------------------------------------ hero: «Запарься» / «Не парься»
  (function () {
    var mode = $('lpMode'), shot = $('lpHeroShot'); if (!mode || !shot) return;
    var btns = qa('button', mode), touched = false, vis = true, cur = 'tune';
    function set(m) {
      cur = m; shot.dataset.mode = m; mode.dataset.m = m;
      btns.forEach(function (b) { var on = b.dataset.m === m; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      qa('.lp-switch img', shot).forEach(function (im) { im.classList.toggle('is-on', im.classList.contains(m === 'tune' ? 's-tune' : 's-calm')); });
    }
    mode.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; touched = true; set(b.dataset.m); });
    whenVisible(shot, function (v) { vis = v; });
    if (!calm) setInterval(function () { if (!touched && vis) set(cur === 'tune' ? 'calm' : 'tune'); }, 5200);
    set('tune');
  })();

  // ------------------------------------------------------------------ скриншот в hero «выпрямляется» при прокрутке
  (function () {
    var box = $('lpHeroShot'); if (!box || calm) return;
    var busy = false;
    function upd() { busy = false; var p = Math.min(1, Math.max(0, window.scrollY / (innerHeight * 0.55))); box.style.setProperty('--tilt', (1 - p).toFixed(3)); }
    window.addEventListener('scroll', function () { if (!busy) { busy = true; requestAnimationFrame(upd); } }, { passive: true });
    upd();
  })();

  // ------------------------------------------------------------------ 3D-персонаж со своим плащом (skinview3d, своя копия)
  (function () {
    var cv = $('lpSkin'); if (!cv) return;
    var SKIN = 'assets/launcher/authors/miha1ychh.png', CAPE = 'assets/launcher/cape-Zorya.png';
    function boot() {
      try {
        var t = document.createElement('canvas'); if (!(t.getContext('webgl') || t.getContext('experimental-webgl'))) return;
        var v = new skinview3d.SkinViewer({ canvas: cv, width: 420, height: 440, skin: SKIN, model: 'auto-detect' });
        v.fov = 36; v.zoom = 0.85; v.autoRotate = !calm; v.autoRotateSpeed = 0.8;
        v.animation = new skinview3d.IdleAnimation();
        if (v.controls) { v.controls.enableZoom = false; v.controls.enablePan = false; v.controls.enabled = false; }
        v.loadCape(CAPE); cv.hidden = false;
        whenVisible(cv.parentNode, function (vis) { v.renderPaused = !vis; });
      } catch (e) { cv.hidden = true; }
    }
    function load() { var s = document.createElement('script'); s.src = 'assets/launcher/js/skinview3d.bundle.js'; s.onload = boot; document.body.appendChild(s); }
    if (!('IntersectionObserver' in window)) { load(); return; }
    var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); load(); } }, { rootMargin: '400px 0px' });
    io.observe(cv.parentNode);
  })();

  // ------------------------------------------------------------------ цвет страницы
  (function () {
    var sws = $('lpSws'); if (!sws) return;
    var rgb = function (h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    sws.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      qa('button', sws).forEach(function (x) { x.classList.toggle('is-on', x === b); });
      var w = rgb(b.dataset.w), r = rgb(b.dataset.r), d = rgb(b.dataset.d);
      body.style.setProperty('--w', b.dataset.w); body.style.setProperty('--r', b.dataset.r); body.style.setProperty('--d', b.dataset.d);
      body.style.setProperty('--wr', w.join(',')); body.style.setProperty('--rr', r.join(',')); body.style.setProperty('--dr', d.join(','));
    });
  })();

  // ------------------------------------------------------------------ скриншот на весь экран
  (function () {
    var box = $('lpLb'); if (!box) return;
    var im = $('lpLbImg'), opener = null;
    function open(src) { opener = document.activeElement; im.src = src.currentSrc || src.src; im.alt = src.alt; box.hidden = false; document.documentElement.style.overflow = 'hidden'; $('lpLbX').focus(); }
    function close() { box.hidden = true; document.documentElement.style.overflow = ''; if (opener && opener.focus) opener.focus(); }
    qa('.lp-frame img').forEach(function (x) { x.addEventListener('click', function () { open(x); }); });
    $('lpLbX').addEventListener('click', close);
    box.addEventListener('click', function (e) { if (e.target === box || e.target === im) close(); });
    document.addEventListener('keydown', function (e) { if (!box.hidden && e.key === 'Escape') close(); });
  })();

  // ------------------------------------------------------------------ счётчик установщика
  (function () {
    qa('[data-count]').forEach(function (el) {
      var to = +el.dataset.count; if (!to || calm || !('IntersectionObserver' in window)) return;
      var io = new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) return; io.disconnect();
        var t0 = performance.now(), D = 1300;
        (function f(now) { var p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(to * e); if (p < 1) requestAnimationFrame(f); })(t0);
      }, { threshold: 0.6 });
      el.textContent = '0'; io.observe(el);
    });
  })();
})();
