package eternal.core;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.util.Locale;

/**
 * Performance monitor for the overlay of Eternal Launcher. The game is measured from inside (this is what only the game knows), the
 * numbers go to the launcher over a loopback UDP socket ten times a second, and the launcher draws them over the game window.
 *
 * Called once per frame from Minecraft.runTick (see Patcher): the time between two calls is the frame time. Every half second the
 * game's own counters are read on the render thread (entities, loaded chunks, game time for TPS). The key to show or hide the overlay
 * (Right Alt by default, the player's choice) is read the same way, from GLFW, and goes to the launcher as a counter that only grows (a lost packet loses nothing).
 *
 * It is on only when the launcher gave a target address in -Deternal.metrics=127.0.0.1:port. Works where the game's own names are used
 * at run time (Minecraft 26.1+, NeoForge 1.20.5+); anywhere else runTick is not found and nothing happens. On any failure it switches
 * itself off: the game is never affected.
 */
final class Metrics {
    private static final int RING = 8192;
    private static final int MASK = RING - 1;
    private static final int DEFAULT_KEY = 298; // GLFW_KEY_F9; the launcher passes the player's choice in -Deternal.metrics.key
    private int key = DEFAULT_KEY; // GLFW key code (Minecraft up to 26.1: isKeyDown(window, key))
    private int sdlKey = 66; // SDL scancode of the same key (Minecraft 26.3 and newer read the keyboard through SDL: isKeyDown(scancode))

    private final float[] frames = new float[RING];
    private volatile long head;
    private long sent;
    private long lastNs;

    private volatile boolean broken;
    private DatagramSocket socket;
    private InetAddress address;
    private int port;
    private boolean enabled;

    private volatile int toggles;
    private int beat;
    private volatile int focused = -1;
    private volatile int winX;
    private volatile int winY;
    private volatile int winW;
    private volatile int winH;
    private long lastWindowNs;
    private final boolean[] seenDown = new boolean[512];
    private boolean keyWasDown;

    private volatile int fps = -1;
    private volatile int entities = -1;
    private volatile int chunks = -1;
    private volatile double tps = -1;
    private long lastSampleNs;
    private long lastGameTime = -1;
    private long lastGameTimeNs;

    private volatile Reflection reflection;

    Metrics() {
        String target = System.getProperty("eternal.metrics");
        if (target == null || target.length() > 40) return;
        int colon = target.lastIndexOf(':');
        if (colon < 1) return;
        try {
            String host = target.substring(0, colon);
            port = Integer.parseInt(target.substring(colon + 1));
            address = InetAddress.getByName(host);
            if (!address.isLoopbackAddress() || port < 1024 || port > 65535) return; // only to this computer
            try {
                int k = Integer.parseInt(System.getProperty("eternal.metrics.key", String.valueOf(DEFAULT_KEY)));
                if (k >= 32 && k <= 348) key = k;
                int sdl = Integer.parseInt(System.getProperty("eternal.metrics.sdl", "66"));
                if (sdl >= 4 && sdl <= 511) sdlKey = sdl;
            } catch (NumberFormatException ignored) {
                // the default key stays
            }
            socket = new DatagramSocket();
            enabled = true;
        } catch (Throwable t) {
            Debug.log("metrics: bad target " + target + ": " + t);
            return;
        }
        Thread sender = new Thread(new Runnable() {
            @Override
            public void run() {
                while (!broken) {
                    try {
                        Thread.sleep(100);
                        send();
                    } catch (InterruptedException e) {
                        return;
                    } catch (Throwable t) {
                        // one lost datagram is nothing
                    }
                }
            }
        }, "eternal-metrics");
        sender.setDaemon(true);
        sender.start();
        Debug.log("metrics: sending to " + target);
    }

    private static final class Reflection {
        final Method isKeyDown;
        final Method getWindow; // only where the game's key check wants the window as well (26.1)
        final Method windowOf; // minecraft.getWindow(): where the game's window is (so the overlay needs no other way to find it)
        final Method winX;
        final Method winY;
        final Method winW;
        final Method winH;
        final Method getFps;
        final Method isWindowActive;
        final Method sdlState; // only for the debug log of pressed keys (Minecraft 26.3+)
        final Field level;
        final Method getEntityCount;
        final Method getGameTime;
        final Method getChunkSource;
        final Method loadedChunks;

        Reflection(Object minecraft) throws Exception {
            Class<?> mc = minecraft.getClass();
            ClassLoader cl = mc.getClassLoader();
            // the game's own key check (it knows its window); LWJGL's GLFW class is not visible from here on every launcher setup
            Class<?> input = Class.forName("com.mojang.blaze3d.platform.InputConstants", true, cl);
            Method plain = null;
            try {
                plain = input.getMethod("isKeyDown", int.class);
            } catch (NoSuchMethodException withWindow) {
                // isKeyDown(Window, int)
            }
            if (plain != null) {
                isKeyDown = plain;
                getWindow = null;
            } else {
                getWindow = mc.getMethod("getWindow");
                isKeyDown = input.getMethod("isKeyDown", getWindow.getReturnType(), int.class);
            }
            windowOf = mc.getMethod("getWindow");
            Class<?> windowClass = windowOf.getReturnType();
            winX = windowClass.getMethod("getX");
            winY = windowClass.getMethod("getY");
            winW = windowClass.getMethod("getWidth");
            winH = windowClass.getMethod("getHeight");
            getFps = mc.getMethod("getFps");
            isWindowActive = mc.getMethod("isWindowActive");
            Method state = null;
            if (Debug.enabled()) {
                try {
                    state = Class.forName("org.lwjgl.sdl.SDLKeyboard", true, cl).getMethod("SDL_GetKeyboardState");
                } catch (Throwable ignored) {
                    // no SDL: nothing to log
                }
            }
            sdlState = state;
            level = mc.getField("level");
            Class<?> levelClass = Class.forName("net.minecraft.client.multiplayer.ClientLevel", true, cl);
            getEntityCount = levelClass.getMethod("getEntityCount");
            getGameTime = levelClass.getMethod("getGameTime");
            getChunkSource = levelClass.getMethod("getChunkSource");
            loadedChunks = Class.forName("net.minecraft.client.multiplayer.ClientChunkCache", true, cl).getMethod("getLoadedChunksCount");
        }
    }

    /** Once per frame, on the render thread. */
    Object frame(Object minecraft) {
        if (!enabled || broken || minecraft == null) return null;
        long now = System.nanoTime();
        if (lastNs != 0) {
            float ms = (now - lastNs) / 1_000_000f;
            if (ms > 0f && ms < 5000f) {
                frames[(int) (head & MASK)] = ms;
                head = head + 1;
            }
        }
        lastNs = now;
        try {
            Reflection r = reflection;
            if (r == null) {
                r = new Reflection(minecraft);
                reflection = r;
                Debug.log("metrics: game API found");
            }
            // the overlay key, on its press (not while it is held)
            focused = ((Boolean) r.isWindowActive.invoke(minecraft)) ? 1 : 0;
            if (now - lastWindowNs >= 100_000_000L) {
                lastWindowNs = now;
                Object window = r.windowOf.invoke(minecraft);
                winX = (Integer) r.winX.invoke(window);
                winY = (Integer) r.winY.invoke(window);
                winW = (Integer) r.winW.invoke(window);
                winH = (Integer) r.winH.invoke(window);
            }
            if (r.sdlState != null) logPressedKeys(r);
            boolean down = (Boolean) (r.getWindow == null ? r.isKeyDown.invoke(null, sdlKey) : r.isKeyDown.invoke(null, r.getWindow.invoke(minecraft), key));
            if (down && !keyWasDown) { toggles = toggles + 1; Debug.log("metrics: overlay key pressed (" + toggles + ")"); }
            keyWasDown = down;
            if (now - lastSampleNs >= 500_000_000L) {
                lastSampleNs = now;
                if (Debug.enabled() && (++beat % 10) == 1) Debug.log("metrics: alive, frames=" + head + ", key=" + (r.getWindow == null ? "sdl " + sdlKey : "glfw " + key) + ", keyDown=" + down);
                sample(r, minecraft, now);
            }
        } catch (Throwable t) {
            broken = true;
            Debug.log("metrics switched off: " + t);
        }
        return null;
    }

    // debug only: every key the game's keyboard state shows as pressed is written once per press (to see what a real keyboard sends)
    private void logPressedKeys(Reflection r) {
        try {
            java.nio.ByteBuffer state = (java.nio.ByteBuffer) r.sdlState.invoke(null);
            if (state == null) return;
            int n = Math.min(512, state.capacity());
            for (int i = 4; i < n; i++) {
                boolean down = state.get(i) != 0;
                if (down && !seenDown[i]) Debug.log("metrics: keyboard shows scancode " + i + " pressed");
                seenDown[i] = down;
            }
        } catch (Throwable ignored) {
            // debug aid only
        }
    }

    private void sample(Reflection r, Object minecraft, long now) throws Exception {
        fps = (Integer) r.getFps.invoke(minecraft);
        Object level = r.level.get(minecraft);
        if (level == null) {
            entities = -1;
            chunks = -1;
            tps = -1;
            lastGameTime = -1;
            return;
        }
        entities = (Integer) r.getEntityCount.invoke(level);
        chunks = (Integer) r.loadedChunks.invoke(r.getChunkSource.invoke(level));
        long gameTime = (Long) r.getGameTime.invoke(level);
        if (lastGameTime >= 0 && now > lastGameTimeNs && gameTime >= lastGameTime) {
            double measured = (gameTime - lastGameTime) * 1e9 / (now - lastGameTimeNs);
            tps = Math.max(0.0, Math.min(20.0, measured));
        }
        lastGameTime = gameTime;
        lastGameTimeNs = now;
    }

    // runs on the sender thread
    private void send() throws Exception {
        long end = head;
        long start = Math.max(sent, end - 400); // at most 400 frames per packet (a 1000 fps game gives ~100 per tenth of a second)
        if (end - sent > RING) start = end - 400;
        StringBuilder sb = new StringBuilder(2200);
        sb.append("{\"v\":1,\"fps\":").append(fps).append(",\"ft\":[");
        for (long i = start; i < end; i++) {
            if (i > start) sb.append(',');
            sb.append(String.format(Locale.ROOT, "%.2f", frames[(int) (i & MASK)]));
        }
        sent = end;
        Runtime rt = Runtime.getRuntime();
        sb.append("],\"ent\":").append(entities)
            .append(",\"chk\":").append(chunks)
            .append(",\"tps\":").append(String.format(Locale.ROOT, "%.1f", tps))
            .append(",\"hu\":").append((rt.totalMemory() - rt.freeMemory()) >> 20)
            .append(",\"hm\":").append(rt.maxMemory() >> 20)
            .append(",\"tg\":").append(toggles)
            .append(",\"fo\":").append(focused)
            .append(",\"wx\":").append(winX)
            .append(",\"wy\":").append(winY)
            .append(",\"ww\":").append(winW)
            .append(",\"wh\":").append(winH)
            .append('}');
        byte[] data = sb.toString().getBytes("UTF-8");
        socket.send(new DatagramPacket(data, data.length, address, port));
    }
}
