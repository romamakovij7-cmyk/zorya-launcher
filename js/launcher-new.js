/**
 * launcher-new.js — вступление страницы лаунчера: сначала голая страница «без красивой обёртки»,
 * по кнопке «Нужна» или «Скачать» идёт «взлом» (розовый дождь из символов и строки терминала), потом настоящая страница проявляется поверх дождя (другие варианты: ?fx=crt, ?fx=glitch, ?fx=fade, ?fx=wave).
 * Без JS вступления нет вообще: страница сразу красивая (оверлей включается только классом ln-intro).
 * Вступление показывается, пока человек его не посмотрел (запоминаем в localStorage, ключ lnIntroSeen); повтор: ?intro=1.
 * «Скачать» заодно запускает скачивание установщика (если он уже найден), потом всё равно идёт преображение.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var calm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Запоминаем в браузере, что человек уже видел вступление: в следующий раз сразу настоящая страница, без голой страницы и дождя.
  // Если хранилище недоступно (приватное окно, запрет), вступление просто показывается каждый раз. Показать снова: добавить к адресу ?intro=1
  var SEEN_KEY = 'lnIntroSeen', seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { /* без хранилища показываем вступление */ }
  function markSeen() { try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* не страшно */ } }
  if (false && seen && !/[?&]intro=1(?:&|$)/.test(location.search)) {
    root.classList.add('ln-revealed');
    document.addEventListener('DOMContentLoaded', function () { var o = document.getElementById('lnIntro'); if (o) o.remove(); });
    return;
  }

  root.classList.add('ln-intro');                     // сразу, до отрисовки: оверлей закрывает страницу

  document.addEventListener('DOMContentLoaded', function () {
    var ov = document.getElementById('lnIntro'); if (!ov) { root.classList.remove('ln-intro'); return; }
    var busy = false;

    function startDownload() {
      // скачивание только после входа: если человек уже в аккаунте, нажимаем основную кнопку (она сама спросит ссылку у сервера);
      // если нет, ничего не качаем и окно входа поверх вступления не открываем
      var a = document.getElementById('lnGet');
      var P = window.Premium;
      if (a && !a.classList.contains('is-off') && P && P.isLoggedIn && P.isLoggedIn()) a.click();
    }
    function finish() {
      ov.remove(); var r = document.getElementById('lnRing'); if (r) r.remove();
      root.classList.remove('ln-intro'); root.classList.add('ln-revealed');
      root.style.removeProperty('--ir');
    }
    // «хакерский» дождь из символов и строки терминала поверх голой страницы
    var rainRAF = 0, rainCv = null;
    function hack(done) {
      ov.style.background = '#000'; ov.style.transition = 'background .3s';
      var plain = ov.querySelector('.ln-plain'); if (plain) { plain.style.transition = 'opacity .25s'; plain.style.opacity = '0'; }
      var cv = document.createElement('canvas'); cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;display:block;z-index:1;pointer-events:none';
      ov.appendChild(cv); rainCv = cv;
      var w = cv.width = innerWidth, h = cv.height = innerHeight, ctx = cv.getContext('2d'), fs = 16, cols = Math.ceil(w / fs), drops = [];
      for (var i = 0; i < cols; i++) drops.push(Math.random() * -40);
      var G = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/{}[]=+*$#'.split('');
      ctx.font = fs + 'px monospace'; var last = 0;
      (function loop(now) {
        if (now - last > 38) {                       // ~26 кадров в секунду: как в кино
          last = now; ctx.fillStyle = 'rgba(0,0,0,.09)'; ctx.fillRect(0, 0, w, h);
          for (var c = 0; c < cols; c++) {
            var ch = G[Math.floor(Math.random() * G.length)], y = drops[c] * fs;
            ctx.fillStyle = '#fff0f5'; ctx.fillText(ch, c * fs, y);                  // голова столбца
            ctx.fillStyle = '#ff7eb0'; ctx.fillText(G[Math.floor(Math.random() * G.length)], c * fs, y - fs);
            if (y > h && Math.random() > 0.975) drops[c] = 0; else drops[c] += 1;
          }
        }
        rainRAF = requestAnimationFrame(loop);
      })(0);
      var term = document.createElement('pre');
      term.style.cssText = 'position:fixed;left:24px;top:24px;margin:0;z-index:2;font:15px/1.5 monospace;color:#ff7eb0;text-shadow:0 0 8px #ff7eb0;background:rgba(0,0,0,.72);padding:12px 16px;border:1px solid #ff7eb0;max-width:calc(100% - 48px)';
      ov.appendChild(term);
      var lines = ['> sudo install --обёртка', '[ OK ] подключаю стили', '[ OK ] гружу шрифты', '[ OK ] бужу 3D-персонажа', '[ OK ] взламываю скучный дизайн...', '>>> ДОСТУП ПОЛУЧЕН <<<'], n = 0;
      (function type() {
        term.textContent = lines.slice(0, ++n).join(String.fromCharCode(10));
        if (n < lines.length) setTimeout(type, 260); else setTimeout(function () { term.remove(); done(); }, 420);
      })();
    }
    function wave(cx, cy) {
      var w = innerWidth, h = innerHeight, R = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + 40;
      root.style.setProperty('--icx', cx + 'px'); root.style.setProperty('--icy', cy + 'px'); root.style.setProperty('--ir', '0px');
      var ring = document.createElement('div'); ring.id = 'lnRing'; ring.style.left = cx + 'px'; ring.style.top = cy + 'px'; document.body.appendChild(ring);
      var t0 = performance.now(), D = 1250;      // волна: дыра в голой странице растёт и открывает настоящую
      (function step(now) {
        var p = Math.min(1, (now - t0) / D), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2, r = R * e;
        root.style.setProperty('--ir', r.toFixed(1) + 'px');
        ring.style.width = ring.style.height = (r * 2) + 'px'; ring.style.opacity = String(1 - Math.max(0, p - .7) / .3);
        if (p < 1) requestAnimationFrame(step); else { cancelAnimationFrame(rainRAF); finish(); }
      })(t0);
    }
    // как появляется настоящая страница. По умолчанию «поверх» (страница проявляется поверх дождя, дождь тает). Пробовать: ?fx=crt, ?fx=glitch, ?fx=fade, ?fx=wave
    var FX = (new URLSearchParams(location.search).get('fx') || 'over');
    function reveal(cx, cy) {
      if (FX === 'over' && rainCv) {                  // страница появляется поверх дождя, а дождь постепенно тает под ней
        var cv = rainCv;
        cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;display:block;z-index:0;pointer-events:none;opacity:1;transition:opacity 1.9s ease';
        document.body.appendChild(cv);                // дождь переезжает под страницу (z-index 0), экран-вступление убираем
        ov.remove(); var rg = document.getElementById('lnRing'); if (rg) rg.remove();
        root.classList.remove('ln-intro'); root.classList.add('ln-revealed', 'ln-appear');
        requestAnimationFrame(function () { requestAnimationFrame(function () { cv.style.opacity = '0'; }); });
        setTimeout(function () { cancelAnimationFrame(rainRAF); cv.remove(); root.classList.remove('ln-appear'); }, 2100);
        return;
      }
      if (FX === 'wave') { ov.style.background = ''; wave(cx, cy); return; }
      if (FX === 'fade') {
        ov.style.transition = 'opacity .9s ease'; ov.style.opacity = '0';
        setTimeout(function () { cancelAnimationFrame(rainRAF); finish(); }, 950); return;
      }
      if (FX === 'glitch') {                          // экран «сбоит»: кадры мигают и съезжают, потом страница
        var op = [1, 0, 1, .35, 1, 0, .6, 0, 1, 0, .2, 0], k = 0;
        (function frame() {
          if (k >= op.length) { cancelAnimationFrame(rainRAF); finish(); return; }
          ov.style.opacity = String(op[k]);
          ov.style.transform = 'translateX(' + ((Math.random() - .5) * 60).toFixed(0) + 'px)';
          ov.style.filter = 'hue-rotate(' + (k * 47) + 'deg) saturate(2)';
          k++; setTimeout(frame, 70);
        })(); return;
      }
      // crt: экран с дождём схлопывается в линию и в точку, и под ним уже готовая страница
      ov.style.transformOrigin = '50% 50%';
      ov.style.transition = 'transform .3s cubic-bezier(.7,0,.8,.3), filter .3s';
      ov.style.transform = 'scaleY(.006)'; ov.style.filter = 'brightness(2.2)';
      setTimeout(function () {
        ov.style.transition = 'transform .22s ease-in, opacity .22s'; ov.style.transform = 'scale(0, .006)'; ov.style.opacity = '0';
        setTimeout(function () {
          cancelAnimationFrame(rainRAF); finish();      // страница уже видна под схлопнувшимся экраном: второй раз её не анимируем
        }, 230);
      }, 310);
    }
    function go(btn, download) {
      if (busy) return; busy = true;
      markSeen();                                     // вступление пошло: больше не показываем
      if (download) startDownload();                  // пока жив пользовательский клик
      var rect = btn.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      if (calm) { ov.classList.add('is-fade'); setTimeout(finish, 350); return; }
      ov.classList.add('is-go');                      // дрожь и вспышка, потом «взлом», потом волна
      setTimeout(function () { hack(function () { reveal(cx, cy); }); }, 420);
    }
    document.getElementById('lnPlainYes').addEventListener('click', function () { go(this, false); });
    document.getElementById('lnPlainDl').addEventListener('click', function () { go(this, true); });
  });
})();
