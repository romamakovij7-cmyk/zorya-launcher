// Launch игры так, чтобы она жила независимо от лаунчера: отдельный процесс (detached), а вывод идёт не в трубу, а в файл.
// Почему файл: если лаунчер закрыт, труба рвётся, и игра на Rust (println! при обрыве паникует) падала бы вместе с ним.
// Лаунчер читает файл по мере роста (живой журнал), а после перезапуска подхватывает его с того же места.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { app } = require('electron');

const POLL_MS = 250;
const MAX_CHUNK = 64 * 1024; // как раньше с трубой: большие порции вывода идут в окно кусками, а не одним сообщением
const TAIL_ON_ADOPT = 256 * 1024; // сколько уже написанного показать при подхвате запущенной игры

function runLogDir() {
  const dir = path.join(app.getPath('userData'), 'run-logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// id сборки — uuid, но проверяем: имя файла строим из него
function logPathFor(instanceId) {
  const safe = String(instanceId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  return path.join(runLogDir(), `${safe}.log`);
}

// Читает файл с позиции `from`, отдаёт новые куски текста. Возвращает { flush, stop, position }.
function tailFile(file, onChunk, from = 0) {
  let pos = from;
  const decoder = new StringDecoder('utf8');
  function read() {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const size = fs.fstatSync(fd).size;
      if (size < pos) pos = 0; // файл начали заново
      while (pos < size) {
        const len = Math.min(size - pos, MAX_CHUNK);
        const buf = Buffer.alloc(len);
        const n = fs.readSync(fd, buf, 0, len, pos);
        if (n <= 0) break;
        pos += n;
        const text = decoder.write(buf.subarray(0, n));
        if (text) onChunk(text);
      }
    } catch { /* файла ещё нет или занят — попробуем в следующий раз */ } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
  const timer = setInterval(read, POLL_MS);
  timer.unref?.();
  return {
    flush: read,
    stop() { clearInterval(timer); },
    position: () => pos,
  };
}

// Последние байты файла как текст (для подхвата)
function readTail(file, maxBytes = TAIL_ON_ADOPT) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - maxBytes);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      let text = buf.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1); // начало могло попасть в середину строки
      return { text, size };
    } finally { fs.closeSync(fd); }
  } catch { return { text: '', size: 0 }; }
}

// Launch процесс отдельно от лаунчера. stdin: 'ignore' | 'pipe' (если игре нужно что-то передать при старте).
// onLine(text) получает новый вывод, onExit({ code, signal }) вызывается после того, как вывод дочитан до конца.
function startDetached({
  exe, args, cwd, stdin = 'ignore', instanceId, onLine, onExit, onError, env,
}) {
  const logFile = logPathFor(instanceId);
  const fd = fs.openSync(logFile, 'w');
  let child;
  try {
    child = spawn(exe, args, {
      cwd, detached: true, windowsHide: true, stdio: [stdin, fd, fd], ...(env ? { env: { ...process.env, ...env } } : {}),
    });
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ } // у игры своя копия дескриптора
  }
  const tail = tailFile(logFile, (t) => onLine && onLine(t), 0);
  child.on('error', (err) => { tail.stop(); onError && onError(err); });
  child.on('exit', (code, signal) => {
    tail.stop();
    tail.flush(); // дочитать хвост до анализа падения
    onExit && onExit({ code, signal });
  });
  child.logFile = logFile;
  child.tail = tail;
  return child;
}

module.exports = { startDetached, tailFile, readTail, logPathFor };
