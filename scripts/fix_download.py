from pathlib import Path

p = Path(__file__).resolve().parents[1] / "electron" / "ipc.js"
t = p.read_text(encoding="utf-8")

old = """          let have = fs.existsSync(zip) ? fs.statSync(zip).size : 0;
          if (have !== expectedSize) {
            // Resume a partial download instead of starting from zero.
            const res = await fetch(url, have > 0 ? { headers: { Range: `bytes=${have}-` } } : {});
            if (!res.ok && res.status !== 206) throw new Error(`download ${res.status}`);
            const append = have > 0 && res.status === 206;
            if (!append) have = 0;
            const out = fs.createWriteStream(zip, { flags: append ? 'a' : 'w' });
            let loaded = have;
            let last = 0;
            for await (const chunk of res.body) {
              loaded += chunk.length;
              if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
              const now = Date.now();
              if (now - last > 500) { last = now; send('launch:progress', { instanceId: id, stage: 'downloading', completed: loaded, total: expectedSize }); }
            }
            await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
            if (fs.statSync(zip).size !== expectedSize) throw new Error('incomplete download');
          }
"""

new = """          let have = fs.existsSync(zip) ? fs.statSync(zip).size : 0;
          if (have > expectedSize) { fs.rmSync(zip, { force: true }); have = 0; }
          // A stalled connection used to leave the launcher stuck at ~98%.
          // Every attempt resumes from the bytes already on disk; a watchdog
          // aborts a silent stream and the loop simply continues.
          for (let attempt = 0; have < expectedSize && attempt < 25; attempt += 1) {
            const offset = have;
            const controller = new AbortController();
            let lastChunk = Date.now();
            const watchdog = setInterval(() => {
              if (Date.now() - lastChunk > 15000) controller.abort();
            }, 3000);
            let out = null;
            try {
              const res = await fetch(url, {
                headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
                signal: controller.signal,
              });
              if (!res.ok && res.status !== 206) throw new Error(`download ${res.status}`);
              const append = offset > 0 && res.status === 206;
              if (!append) { fs.rmSync(zip, { force: true }); have = 0; }
              out = fs.createWriteStream(zip, { flags: append ? 'a' : 'w' });
              let loaded = append ? offset : 0;
              let last = 0;
              for await (const chunk of res.body) {
                lastChunk = Date.now();
                loaded += chunk.length;
                if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
                const now = Date.now();
                if (now - last > 300) {
                  last = now;
                  send('launch:progress', { instanceId: id, stage: 'downloading', completed: loaded, total: expectedSize });
                }
              }
              await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
              out = null;
            } catch {
              if (out && !out.destroyed) out.destroy();
              // Keep the partial file: the next attempt resumes from its size.
            } finally {
              clearInterval(watchdog);
            }
            have = fs.existsSync(zip) ? fs.statSync(zip).size : 0;
          }
          if (have !== expectedSize) throw new Error(`incomplete download (${have}/${expectedSize})`);
"""

if old not in t:
    raise SystemExit("download block not found")
p.write_text(t.replace(old, new), encoding="utf-8")
print("download retry fixed")
