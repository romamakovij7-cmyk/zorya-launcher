const net = require('net');

class NeedMoreData extends Error {}

const MAX_RESPONSE_BYTES = 1024 * 1024;

function writeVarInt(value) {
  const bytes = [];
  let v = value;
  do {
    let temp = v & 0x7f;
    v >>>= 7;
    if (v !== 0) temp |= 0x80;
    bytes.push(temp);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function writeString(str) {
  const strBuf = Buffer.from(str, 'utf8');
  return Buffer.concat([writeVarInt(strBuf.length), strBuf]);
}

function packPacket(packetId, ...fields) {
  const body = Buffer.concat([writeVarInt(packetId), ...fields]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function readVarInt(buf, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= buf.length) throw new NeedMoreData();
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new Error('VarInt слишком длинный');
  }
  return { value: result, next: pos };
}

function extractMotdText(desc) {
  if (!desc) return '';
  if (typeof desc === 'string') return desc;
  let text = typeof desc.text === 'string' ? desc.text : '';
  if (Array.isArray(desc.extra)) text += desc.extra.map((e) => (typeof e === 'string' ? e : (typeof e?.text === 'string' ? e.text : ''))).join('');
  return text;
}

// Minecraft's Server List Ping protocol (modern handshake-based variant,
// works 1.7+): connect, send a Handshake packet requesting the "status"
// state, then a Status Request, and parse the JSON Status Response.
function pingServer(host, port, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = Buffer.alloc(0);
    let settled = false;
    const start = Date.now();

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish(() => reject(new Error('Таймаут подключения к серверу'))));
    socket.on('error', (err) => finish(() => reject(err)));

    socket.connect(port, host, () => {
      const handshake = packPacket(0x00,
        writeVarInt(767), // protocol version — irrelevant for a status-only request
        writeString(host),
        (() => { const b = Buffer.alloc(2); b.writeUInt16BE(port & 0xffff); return b; })(),
        writeVarInt(1)); // next state: status
      const statusRequest = packPacket(0x00);
      socket.write(Buffer.concat([handshake, statusRequest]));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      // The socket timeout is an idle timeout — a server that keeps dribbling bytes
      // would otherwise grow this buffer forever. A real status answer (with its
      // base64 favicon) is well under this.
      if (buffer.length > MAX_RESPONSE_BYTES) { finish(() => reject(new Error('Слишком большой ответ сервера'))); return; }
      try {
        const { value: packetLength, next: afterLen } = readVarInt(buffer, 0);
        if (packetLength < 0 || packetLength > MAX_RESPONSE_BYTES) throw new Error('Некорректный ответ сервера');
        if (buffer.length < afterLen + packetLength) return; // wait for the rest
        const { value: packetId, next: afterId } = readVarInt(buffer, afterLen);
        if (packetId !== 0x00) throw new Error('Неожиданный пакет от сервера');
        const { value: strLen, next: afterStrLen } = readVarInt(buffer, afterId);
        if (buffer.length < afterStrLen + strLen) return;
        const json = JSON.parse(buffer.toString('utf8', afterStrLen, afterStrLen + strLen));
        const ping = Date.now() - start;
        // Everything in the answer is whatever the server felt like sending: coerce it
        // to the plain shapes the UI renders (an object as "online" would crash React;
        // an arbitrary favicon string would become an <img src>).
        const count = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
        const favicon = typeof json.favicon === 'string' && json.favicon.length < 200000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(json.favicon)
          ? json.favicon : null;
        finish(() => resolve({
          motd: String(extractMotdText(json.description) || '').slice(0, 400),
          online: count(json.players?.online),
          max: count(json.players?.max),
          versionName: typeof json.version?.name === 'string' ? json.version.name.slice(0, 80) : null,
          favicon,
          ping,
        }));
      } catch (err) {
        if (err instanceof NeedMoreData) return;
        finish(() => reject(err));
      }
    });
  });
}

module.exports = { pingServer };
