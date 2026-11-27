package eternal.core;

import java.lang.reflect.Method;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Nick colour (Premium): the name of a player who has one is drawn as a gradient — over the head and in the tab list.
 * Called from two patched methods (see Patcher): Player.getDisplayName() (source = the player) and
 * PlayerTabOverlay.getNameForDisplay(PlayerInfo) (source = the PlayerInfo); both get the game's own Component and return one.
 *
 * Only the player's OWN NAME inside the component is recoloured: on a server the component is usually "[Rank] Name suffix" (team
 * prefix/suffix, a tab-list plugin), and then just the letters of the name get the gradient while the rest stays as the server made
 * it. A display name that does not contain the name at all (a nickname plugin) is returned untouched. Every letter keeps the style
 * (hover, click, insertion, bold…) of the piece of text it came from.
 * Works through the game's own API by reflection and only where its names are official at run time (Minecraft 26.1+, NeoForge 1.20.5+);
 * on any failure the feature switches itself off and every name stays as the game made it.
 */
final class Names {
    private final CapeClient client;
    private volatile Reflection reflection;
    private volatile boolean broken;
    private final ConcurrentHashMap<String, Built> built = new ConcurrentHashMap<String, Built>();

    Names(CapeClient client) {
        this.client = client;
    }

    private static final class Built {
        final int[] stops;
        final String plain;
        final java.util.List<Object> styles;
        final Object component;

        Built(int[] stops, String plain, java.util.List<Object> styles, Object component) {
            this.stops = stops;
            this.plain = plain;
            this.styles = styles;
            this.component = component;
        }
    }

    static final class Reflection {
        final Method level;
        final Method isClientSide;
        final Method getUuid;
        final Method entityName;
        final Method getString;
        final Method getStyle;
        final Method literal;
        final Method append;
        final Method withStyle;
        final Method withColor;
        final Method fromRgb;
        final Method getProfile;
        final Method visit;
        final Class<?> consumer;
        final Object emptyStyle;

        Reflection(ClassLoader cl) throws Exception {
            Class<?> entity = Class.forName("net.minecraft.world.entity.Entity", true, cl);
            Class<?> levelClass = Class.forName("net.minecraft.world.level.Level", true, cl);
            Class<?> component = Class.forName("net.minecraft.network.chat.Component", true, cl);
            Class<?> mutable = Class.forName("net.minecraft.network.chat.MutableComponent", true, cl);
            Class<?> style = Class.forName("net.minecraft.network.chat.Style", true, cl);
            Class<?> textColor = Class.forName("net.minecraft.network.chat.TextColor", true, cl);
            Class<?> info = Class.forName("net.minecraft.client.multiplayer.PlayerInfo", true, cl);
            level = entity.getMethod("level");
            isClientSide = levelClass.getMethod("isClientSide");
            getUuid = entity.getMethod("getUUID");
            entityName = entity.getMethod("getName");
            getString = component.getMethod("getString");
            getStyle = component.getMethod("getStyle");
            literal = component.getMethod("literal", String.class);
            append = mutable.getMethod("append", component);
            withStyle = mutable.getMethod("withStyle", style);
            withColor = style.getMethod("withColor", textColor);
            fromRgb = textColor.getMethod("fromRgb", int.class);
            getProfile = info.getMethod("getProfile");
            Class<?> formatted = Class.forName("net.minecraft.network.chat.FormattedText", true, cl);
            consumer = Class.forName("net.minecraft.network.chat.FormattedText$StyledContentConsumer", true, cl);
            visit = formatted.getMethod("visit", consumer, style);
            emptyStyle = style.getField("EMPTY").get(null);
        }
    }

    Object apply(Object result, Object source) {
        if (broken || result == null || source == null) return result;
        try {
            Reflection r = reflection;
            if (r == null) {
                r = new Reflection(result.getClass().getClassLoader());
                reflection = r;
                Debug.log("names: game API found");
            }
            String uuid;
            String name;
            if (source.getClass().getName().endsWith("PlayerInfo")) {
                Object profile = r.getProfile.invoke(source);
                if (profile == null) return result;
                Object id = first(profile, "id", "getId");
                Object n = first(profile, "name", "getName");
                if (id == null || n == null) return result;
                uuid = id.toString();
                name = n.toString();
            } else {
                Object level = r.level.invoke(source);
                if (level == null || !((Boolean) r.isClientSide.invoke(level))) return result; // the integrated server's copy of the player
                uuid = r.getUuid.invoke(source).toString();
                name = (String) r.getString.invoke(r.entityName.invoke(source));
            }
            return recolor(r, result, uuid.replace("-", "").toLowerCase(), name, source.getClass().getName().endsWith("PlayerInfo"));
        } catch (Throwable t) {
            broken = true;
            Debug.log("names switched off: " + t);
            return result;
        }
    }

    /** The component with the letters of `name` painted in the player's gradient (the component itself when there is nothing to paint). */
    Object recolor(Reflection r, Object result, String uuid, String name, boolean tab) throws Exception {
        {
            int[] stops = client.nick(uuid);
            if (stops == null) return result;
            if (name.isEmpty()) return result;
            // The component as runs of (style, text): every inherited style is already merged into each run.
            final java.util.List<Object> styles = new java.util.ArrayList<Object>();
            final java.util.List<String> texts = new java.util.ArrayList<String>();
            Object collector = java.lang.reflect.Proxy.newProxyInstance(result.getClass().getClassLoader(), new Class<?>[] {r.consumer},
                new java.lang.reflect.InvocationHandler() {
                    public Object invoke(Object proxy, Method m, Object[] args) {
                        if (m.getDeclaringClass() == Object.class) {
                            if ("hashCode".equals(m.getName())) return System.identityHashCode(proxy);
                            if ("equals".equals(m.getName())) return proxy == args[0];
                            return "eternal-collector";
                        }
                        styles.add(args[0]);
                        texts.add((String) args[1]);
                        return java.util.Optional.empty(); // go on to the next piece
                    }
                });
            r.visit.invoke(result, collector, r.emptyStyle);
            StringBuilder all = new StringBuilder();
            for (String s : texts) all.append(s);
            String plain = all.toString();
            int at = plain.indexOf(name);
            if (at < 0) return result; // a display name without the player's name in it (nickname plugin…): leave it alone
            String key = uuid + (tab ? "|t" : "|n");
            Built b = built.get(key);
            if (b != null && b.stops == stops && b.plain.equals(plain) && b.styles.equals(styles)) return b.component;
            Object comp = paint(r, styles, texts, at, name, stops);
            if (built.size() > 500) built.clear();
            built.put(key, new Built(stops, plain, styles, comp));
            return comp;
        }
    }

    private volatile boolean probed;

    /**
     * Debug aid (only with the debug log on): once, for the local player, asks the game for the name over the head and in the tab
     * list — through the patched methods, exactly as the game does — and writes what came back (text and the colour of the first and
     * last letter). A way to see the feature work without a second player or a keyboard.
     */
    void probe(Object player) {
        if (probed || broken || !Debug.enabled() || player == null) return;
        try {
            Reflection r = reflection;
            if (r == null) {
                r = new Reflection(player.getClass().getClassLoader());
                reflection = r;
            }
            Object level = r.level.invoke(player);
            if (level == null || !((Boolean) r.isClientSide.invoke(level))) return;
            if (client.nick(r.getUuid.invoke(player).toString().replace("-", "").toLowerCase()) == null) return; // the answer is still on its way
            probed = true;
            ClassLoader cl = player.getClass().getClassLoader();
            Object over = player.getClass().getMethod("getDisplayName").invoke(player);
            Debug.log("names probe (over the head): " + describe(r, over));
            // What a big server sends: "[VIP] Name *" (team prefix and suffix). Only the name's letters may be painted.
            String own = (String) r.getString.invoke(r.entityName.invoke(player));
            Object decorated = r.append.invoke(r.append.invoke(r.literal.invoke(null, "[VIP] "), r.literal.invoke(null, own)), r.literal.invoke(null, " *"));
            Object painted = apply(decorated, player);
            java.util.List<?> parts = (java.util.List<?>) painted.getClass().getMethod("getSiblings").invoke(painted);
            StringBuilder dump = new StringBuilder("names probe (with prefix and suffix): '" + r.getString.invoke(painted) + "' ->");
            for (Object p : parts) dump.append(" [").append(r.getString.invoke(p)).append(':').append(colorOf(r, p)).append(']');
            Debug.log(dump.toString());
            Class<?> mc = Class.forName("net.minecraft.client.Minecraft", true, cl);
            Object minecraft = mc.getMethod("getInstance").invoke(null);
            Object gui = mc.getField("gui").get(minecraft);
            Object tab = gui.getClass().getMethod("getTabList").invoke(gui);
            Object connection = mc.getMethod("getConnection").invoke(minecraft);
            Object info = connection.getClass().getMethod("getPlayerInfo", java.util.UUID.class).invoke(connection, r.getUuid.invoke(player));
            if (info == null) {
                Debug.log("names probe (tab list): no PlayerInfo for the local player");
                return;
            }
            Object inTab = tab.getClass().getMethod("getNameForDisplay", info.getClass()).invoke(tab, info);
            Debug.log("names probe (tab list): " + describe(r, inTab));
        } catch (Throwable t) {
            probed = true;
            Debug.log("names probe failed: " + t);
        }
    }

    /** "text | first letter colour | last letter colour" of a component made of one component per letter. */
    private static String describe(Reflection r, Object component) throws Exception {
        String text = (String) r.getString.invoke(component);
        java.util.List<?> siblings = (java.util.List<?>) component.getClass().getMethod("getSiblings").invoke(component);
        if (siblings.isEmpty()) return text + " | (no letters: left as the game made it)";
        return text + " | " + colorOf(r, siblings.get(0)) + " .. " + colorOf(r, siblings.get(siblings.size() - 1)) + " | letters=" + siblings.size();
    }

    private static String colorOf(Reflection r, Object letter) throws Exception {
        Object style = r.getStyle.invoke(letter);
        Object color = style.getClass().getMethod("getColor").invoke(style);
        return color == null ? "none" : color.toString();
    }

    /** The first of these no-argument methods that exists. */
    private static Object first(Object target, String... methods) throws Exception {
        for (String m : methods) {
            try {
                return target.getClass().getMethod(m).invoke(target);
            } catch (NoSuchMethodException next) {
                // try the other spelling (authlib 6 / 7)
            }
        }
        return null;
    }

    /** The whole component again, run by run, with the letters of the name (from `at`) in the gradient. */
    private static Object paint(Reflection r, java.util.List<Object> styles, java.util.List<String> texts, int at, String name, int[] stops) throws Exception {
        Object root = r.literal.invoke(null, "");
        int nameEnd = at + name.length();
        int nameCps = name.codePointCount(0, name.length());
        int nameIdx = 0;
        int pos = 0;
        for (int k = 0; k < texts.size(); k++) {
            String text = texts.get(k);
            Object style = styles.get(k);
            StringBuilder pending = new StringBuilder();
            int i = 0;
            while (i < text.length()) {
                int cp = text.codePointAt(i);
                int abs = pos + i;
                if (abs >= at && abs < nameEnd) {
                    flush(r, root, pending, style);
                    double t = nameCps > 1 ? (double) nameIdx / (nameCps - 1) : 0.0;
                    nameIdx++;
                    Object color = r.fromRgb.invoke(null, blend(stops, t));
                    Object letter = r.literal.invoke(null, new String(Character.toChars(cp)));
                    letter = r.withStyle.invoke(letter, r.withColor.invoke(style, color));
                    r.append.invoke(root, letter);
                } else {
                    pending.appendCodePoint(cp);
                }
                i += Character.charCount(cp);
            }
            flush(r, root, pending, style);
            pos += text.length();
        }
        return root;
    }

    private static void flush(Reflection r, Object root, StringBuilder pending, Object style) throws Exception {
        if (pending.length() == 0) return;
        Object piece = r.literal.invoke(null, pending.toString());
        r.append.invoke(root, r.withStyle.invoke(piece, style));
        pending.setLength(0);
    }
    private static int blend(int[] stops, double t) {
        if (stops.length == 1) return stops[0];
        double pos = t * (stops.length - 1);
        int i = Math.min(stops.length - 2, (int) Math.floor(pos));
        double f = pos - i;
        int a = stops[i];
        int b = stops[i + 1];
        int rr = (int) Math.round(((a >> 16) & 255) * (1 - f) + ((b >> 16) & 255) * f);
        int gg = (int) Math.round(((a >> 8) & 255) * (1 - f) + ((b >> 8) & 255) * f);
        int bb = (int) Math.round((a & 255) * (1 - f) + (b & 255) * f);
        return (rr << 16) | (gg << 8) | bb;
    }
}
