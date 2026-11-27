// Minimal Discord Rich Presence client, talking to the local Discord app over
// its IPC socket (a named pipe on Windows, a unix socket elsewhere). No
// dependency: the protocol is just frames of [opcode:int32][length:int32]
// followed by JSON. Everything is best-effort — if Discord isn't running,
// nothing happens and it quietly retries later.
const net = require('net');
const path = require('path');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const RETRY_MS = 15000;
// The launcher's own Discord application (an Application ID is public), so
// presence works out of the box; the settings field only overrides it.
const DEFAULT_CLIENT_ID = '1552768851706380308';
// That application's icon on Discord's own CDN; shown as the big picture in the activity.
const DEFAULT_ICON_URL = 'https://cdn.discordapp.com/app-icons/1552768851706380308/9bf19162342d7b3559ecc0ad5695ce75.png?size=512';

function frame(op, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  const buf = Buffer.alloc(8 + data.length);
  buf.writeInt32LE(op, 0);
  buf.writeInt32LE(data.length, 4);
  data.copy(buf, 8);
  return buf;
}

function socketPath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return path.join(dir, `discord-ipc-${i}`);
}

class DiscordPresence {
  constructor() {
    this.clientId = null;
    this.socket = null;
    this.ready = false;
    this.connecting = false;
    this.lastAttempt = 0;
    this.activity = null; // what we want shown (null = nothing)
    this.buffer = Buffer.alloc(0);
    this.nonce = 0;
  }

  // enabled + clientId decide whether we should be connected at all.
  configure({ enabled, clientId }) {
    const id = enabled ? String(clientId || '').trim() || DEFAULT_CLIENT_ID : '';
    if (id !== this.clientId) {
      this.disconnect();
      this.clientId = id || null;
    }
  }

  setActivity(activity) {
    this.activity = activity;
    if (!this.clientId) return;
    if (this.ready) this.send();
    else this.connect();
    this.keepAlive();
  }

  // While there is something to show, keep trying to (re)connect — Discord may
  // be started after the game, or be restarted while it runs.
  keepAlive() {
    if (this.timer || !this.activity || !this.clientId) return;
    this.timer = setInterval(() => {
      if (!this.activity || !this.clientId) { clearInterval(this.timer); this.timer = null; return; }
      if (!this.ready) this.connect();
    }, RETRY_MS);
    if (this.timer.unref) this.timer.unref();
  }

  send() {
    if (!this.ready || !this.socket) return;
    const args = { pid: process.pid };
    if (this.activity) args.activity = this.activity;
    this.nonce += 1;
    this.socket.write(frame(OP_FRAME, { cmd: 'SET_ACTIVITY', args, nonce: String(this.nonce) }));
  }

  connect() {
    if (this.socket || this.connecting || !this.clientId) return;
    if (Date.now() - this.lastAttempt < RETRY_MS) return;
    this.lastAttempt = Date.now();
    this.connecting = true;
    this.tryPipe(0);
  }

  tryPipe(i) {
    if (i > 9) { this.connecting = false; return; }
    const sock = net.createConnection(socketPath(i));
    let opened = false;
    sock.on('connect', () => {
      opened = true;
      this.socket = sock;
      this.connecting = false;
      this.buffer = Buffer.alloc(0);
      sock.write(frame(OP_HANDSHAKE, { v: 1, client_id: this.clientId }));
    });
    sock.on('data', (chunk) => this.onData(chunk));
    sock.on('error', () => {
      if (!opened) this.tryPipe(i + 1);
    });
    sock.on('close', () => {
      if (this.socket === sock) { this.socket = null; this.ready = false; }
      if (!opened && i >= 9) this.connecting = false;
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const len = this.buffer.readInt32LE(4);
      // Anything can listen on that pipe name: a nonsense length would loop forever / buffer without end.
      if (len < 0 || len > 1024 * 1024) { this.disconnect(); return; }
      if (this.buffer.length < 8 + len) return;
      let msg = null;
      try { msg = JSON.parse(this.buffer.slice(8, 8 + len).toString()); } catch { /* ignore garbage */ }
      this.buffer = this.buffer.slice(8 + len);
      if (msg && msg.evt === 'READY') {
        this.ready = true;
        this.send();
      }
    }
  }

  disconnect() {
    if (this.socket) { try { this.socket.destroy(); } catch { /* already gone */ } }
    this.socket = null;
    this.ready = false;
    this.connecting = false;
    this.lastAttempt = 0;
  }
}

const presence = new DiscordPresence();
presence.DEFAULT_ICON_URL = DEFAULT_ICON_URL;
module.exports = presence;
