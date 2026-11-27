package eternal.core;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Asks Eternal's skin server what a player (by UUID) wears: an Eternal cape and/or hearts. Only a public UUID is sent: no token, no
 * name, no account data. Answers are remembered for a while so every player is asked about once per session. The cape address is
 * accepted only when it lives on the same host as the API (a compromised answer could not point the game anywhere else).
 */
final class CapeClient {
    private static final long HIT_MS = 10 * 60 * 1000L;
    private static final long MISS_MS = 2 * 60 * 1000L;
    private static final long ERROR_MS = 60 * 1000L;
    private static final long DOWN_MS = 30 * 1000L; // after a failed request no new requests for this long (all players)
    private static final int MAX_BODY = 32 * 1024;
    private static final Pattern UUID32 = Pattern.compile("^[0-9a-f]{32}$");
    private static final Pattern URL_FIELD = Pattern.compile("\"url\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern HEARTS_FIELD = Pattern.compile("\"hearts\"\\s*:\\s*true");
    private static final Pattern SLIM_FIELD = Pattern.compile("\"model\"\\s*:\\s*\"slim\"");
    private static final Pattern NICK_FIELD = Pattern.compile("\"nick\"\\s*:\\s*\\[([^\\]]*)\\]");
    private static final Pattern HEX_COLOR = Pattern.compile("\"#([0-9a-fA-F]{6})\"");
    private static final Pattern VALUE_FIELD = Pattern.compile("\"value\"\\s*:\\s*\"([A-Za-z0-9+/=_-]+)\"");
    private static final Pattern CAPE_URL = Pattern.compile("\"CAPE\"\\s*:\\s*\\{[^}]*?\"url\"\\s*:\\s*\"([^\"]+)\"");

    /** What is known about one player. */
    static final class Entry {
        final String url;
        final boolean hearts;
        final int[] nick; // gradient stops (0xRRGGBB) of the nick colour, or null
        final String skinUrl; // skin of an offline nick that is on our server, or null
        final boolean skinSlim;
        final long expires;

        Entry(String url, boolean hearts, int[] nick, long ttl) {
            this(url, hearts, nick, null, false, ttl);
        }

        Entry(String url, boolean hearts, int[] nick, String skinUrl, boolean skinSlim, long ttl) {
            this.url = url;
            this.hearts = hearts;
            this.nick = nick;
            this.skinUrl = skinUrl;
            this.skinSlim = skinSlim;
            this.expires = System.currentTimeMillis() + ttl;
        }
    }

    private final String api;
    private final String scheme;
    private final String host;
    private final ConcurrentHashMap<String, Entry> cache = new ConcurrentHashMap<String, Entry>();
    private final Set<String> inflight = Collections.synchronizedSet(new HashSet<String>());
    private volatile long downUntil;
    private final ExecutorService background = Executors.newFixedThreadPool(2, new ThreadFactory() {
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "eternal-cosmetics-lookup");
            t.setDaemon(true);
            return t;
        }
    });

    CapeClient(String apiRoot) {
        String a = apiRoot.endsWith("/") ? apiRoot.substring(0, apiRoot.length() - 1) : apiRoot;
        this.api = a;
        String s = "https";
        String h = "";
        try {
            URL u = new URL(a);
            s = u.getProtocol();
            h = u.getHost();
        } catch (Exception ignored) {
            // an unusable API root simply never finds anything
        }
        this.scheme = s;
        this.host = h;
    }

    /**
     * The launcher's own skin of a licensed (Microsoft) account, for the UUID the same nick gets on an offline-mode server
     * (-Deternal.selfskin=<uuid>|<slim 0/1>|<address>). An offline server tells nobody the skin, so the game shows the default
     * one; here the account's real skin (from Mojang's texture server, given by the launcher) is put in its place.
     */
    private static final String SELF_UUID;
    private static final String SELF_SKIN;
    private static final boolean SELF_SLIM;

    static {
        String id = null;
        String url = null;
        boolean slim = false;
        try {
            String v = System.getProperty("eternal.selfskin");
            if (v != null) {
                String[] p = v.split("\\|", 3);
                if (p.length == 3 && UUID32.matcher(p[0]).matches() && p[0].charAt(12) == '3'
                        && new URL(p[2]).getProtocol().equals("https") && new URL(p[2]).getHost().equals("textures.minecraft.net")) {
                    id = p[0];
                    slim = "1".equals(p[1]);
                    url = p[2];
                }
            }
        } catch (Exception ignored) {
            // an unusable value: no own skin
        }
        SELF_UUID = id;
        SELF_SKIN = url;
        SELF_SLIM = slim;
    }

    /** Everything known about this player (may wait for the server), or null. */
    Entry entry(String uuid) {
        Entry e = lookup(uuid);
        if (SELF_UUID != null && SELF_UUID.equals(uuid) && (e == null || e.skinUrl == null)) {
            return new Entry(e == null ? null : e.url, e != null && e.hearts, e == null ? null : e.nick, SELF_SKIN, SELF_SLIM, HIT_MS);
        }
        return e;
    }

    /** The cape picture's address for this player, or null when there is none (or the server could not be reached). May wait for the server. */
    String capeUrl(String uuid) {
        Entry e = lookup(uuid);
        return e == null ? null : e.url;
    }

    /**
     * Whether this player wears hearts — answered at once, never waits: an unknown player is asked about in the background
     * (and counts as "no" until the answer arrives). Called every game tick for every player.
     */
    boolean hearts(String uuid) {
        Entry e = peek(uuid);
        return e != null && e.hearts;
    }

    /** The gradient of the player's nick colour (answered at once like hearts()), or null. */
    int[] nick(String uuid) {
        Entry e = peek(uuid);
        return e == null ? null : e.nick;
    }

    private Entry peek(final String uuid) {
        if (uuid == null) return null;
        Entry hit = cache.get(uuid);
        if (hit != null && hit.expires > System.currentTimeMillis()) return hit;
        if (System.currentTimeMillis() < downUntil || !UUID32.matcher(uuid).matches()) return hit;
        if (inflight.add(uuid)) {
            try {
                background.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            lookup(uuid);
                        } finally {
                            inflight.remove(uuid);
                        }
                    }
                });
            } catch (RuntimeException rejected) {
                inflight.remove(uuid);
            }
        }
        return hit; // a stale answer is better than none
    }

    private Entry lookup(String uuid) {
        if (uuid == null || !UUID32.matcher(uuid).matches() || host.isEmpty()) return null;
        Entry hit = cache.get(uuid);
        if (hit != null && hit.expires > System.currentTimeMillis()) return hit;
        // The server is unreachable right now: do not make every player of a big server wait for it one after another
        if (System.currentTimeMillis() < downUntil) return hit;
        Entry fresh;
        try {
            fresh = fetch(uuid);
        } catch (Exception e) {
            Debug.log("lookup failed for " + uuid + ": " + e);
            downUntil = System.currentTimeMillis() + DOWN_MS;
            fresh = new Entry(null, false, null, ERROR_MS);
        }
        if (cache.size() > 2000) cache.clear();
        cache.put(uuid, fresh);
        Debug.log("player " + uuid + " -> cape=" + fresh.url + " hearts=" + fresh.hearts + " nick=" + (fresh.nick != null));
        return fresh;
    }

    private Entry fetch(String uuid) throws Exception {
        // Light endpoint first: {"url": "...", "hearts": true} or 204
        Response r = get(api + "/cape/" + uuid);
        if (r.status == 200) {
            // the "skin" object has its own "url": take it out before looking for the cape address
            String skinBlock = null;
            String rest = r.body;
            int at = rest.indexOf("\"skin\"");
            if (at >= 0) {
                int open = rest.indexOf('{', at);
                int depth = 0;
                int end = -1;
                for (int i = open; open >= 0 && i < rest.length(); i++) {
                    char ch = rest.charAt(i);
                    if (ch == '{') depth++;
                    else if (ch == '}' && --depth == 0) { end = i; break; }
                }
                if (end > 0) {
                    skinBlock = rest.substring(open, end + 1);
                    rest = rest.substring(0, at) + rest.substring(end + 1);
                }
            }
            String url = accept(first(URL_FIELD, rest));
            boolean hearts = HEARTS_FIELD.matcher(rest).find();
            int[] nick = parseNick(rest);
            String skinUrl = null;
            boolean slim = false;
            if (skinBlock != null) {
                skinUrl = accept(first(URL_FIELD, skinBlock));
                slim = SLIM_FIELD.matcher(skinBlock).find();
            }
            return new Entry(url, hearts, nick, skinUrl, slim, url != null || hearts || nick != null || skinUrl != null ? HIT_MS : MISS_MS);
        }
        if (r.status != 404) return new Entry(null, false, null, MISS_MS); // 204: nothing worn
        // An older server has no such endpoint: the profile answer carries the same cape in its textures property
        Response p = get(api + "/sessionserver/session/minecraft/profile/" + uuid);
        if (p.status != 200) return new Entry(null, false, null, MISS_MS);
        String value = first(VALUE_FIELD, p.body);
        if (value == null) return new Entry(null, false, null, MISS_MS);
        String textures = new String(Base64.getMimeDecoder().decode(value), StandardCharsets.UTF_8);
        String url = accept(first(CAPE_URL, textures));
        return new Entry(url, false, null, url != null ? HIT_MS : MISS_MS);
    }

    private static int[] parseNick(String body) {
        Matcher list = NICK_FIELD.matcher(body);
        if (!list.find()) return null;
        Matcher c = HEX_COLOR.matcher(list.group(1));
        int[] stops = new int[8];
        int n = 0;
        while (c.find() && n < stops.length) stops[n++] = Integer.parseInt(c.group(1), 16);
        if (n == 0) return null;
        int[] out = new int[n];
        System.arraycopy(stops, 0, out, 0, n);
        return out;
    }

    private String accept(String url) {
        if (url == null) return null;
        try {
            URL u = new URL(url.replace("\\/", "/"));
            if (u.getProtocol().equals(scheme) && u.getHost().equalsIgnoreCase(host)) return u.toString();
        } catch (Exception ignored) {
            // not a valid address
        }
        return null;
    }

    private static String first(Pattern p, String text) {
        Matcher m = p.matcher(text);
        return m.find() ? m.group(1) : null;
    }

    private static final class Response {
        int status;
        String body = "";
    }

    private Response get(String address) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
        c.setConnectTimeout(1500);
        c.setReadTimeout(2000);
        c.setInstanceFollowRedirects(false);
        c.setRequestProperty("User-Agent", "EternalCosmetics/1.0");
        c.setRequestProperty("Accept", "application/json");
        Response r = new Response();
        try {
            r.status = c.getResponseCode();
            if (r.status == 200) {
                InputStream in = c.getInputStream();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > MAX_BODY) throw new IllegalStateException("answer too large");
                }
                r.body = new String(out.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally {
            c.disconnect();
        }
        return r;
    }
}
