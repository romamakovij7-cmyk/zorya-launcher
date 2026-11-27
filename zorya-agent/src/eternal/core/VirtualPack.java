package eternal.core;

import java.io.ByteArrayInputStream;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.BiConsumer;

/**
 * The hearts' pictures without any file: an in-memory "resource pack" (a dynamic proxy of the game's PackResources interface) is
 * added to the game's resource manager. It answers for exactly seven resources of the "minecraft" namespace:
 *   particles/heart.json                      (the vanilla heart particle now cycles through our six sprites)
 *   textures/particle/eternal_heart_0..5.png  (the sprites, decoded from the masked data inside this agent)
 * Nothing is written to disk and the pack is not in any list the player can see. It sits right above the vanilla pack, so a pack of
 * the player's own can still override the hearts. Added from the constructor of MultiPackResourceManager (see Patcher).
 *
 * Works through the game's own API by reflection and only where its names are official at run time (Minecraft 26.1+, NeoForge 1.20.5+).
 * Any failure leaves the resource manager as the game built it (the hearts are then the plain vanilla ones).
 */
final class VirtualPack {
    private static final String NS = "minecraft";
    private static final int FRAMES = 6;

    private final Map<String, byte[]> files = new LinkedHashMap<String, byte[]>(); // path -> bytes
    private volatile Object pack; // the proxy, made once
    private volatile boolean broken;

    VirtualPack() {
        StringBuilder sprites = new StringBuilder("{\"textures\":[");
        for (int i = 0; i < FRAMES; i++) {
            byte[] png = Base64.getDecoder().decode(HeartData.FRAMES[i]);
            for (int k = 0; k < png.length; k++) png[k] = (byte) (png[k] ^ HeartData.KEY[k % HeartData.KEY.length]);
            files.put("textures/particle/eternal_heart_" + i + ".png", png);
            sprites.append(i == 0 ? "" : ",").append("\"minecraft:eternal_heart_").append(i).append('"');
        }
        sprites.append("]}");
        files.put("particles/heart.json", sprites.toString().getBytes(StandardCharsets.UTF_8));
    }

    /** MultiPackResourceManager(PackType type, List packs): returns the list to use. */
    Object addTo(Object list, Object type) {
        if (broken || !(list instanceof List) || type == null) return list;
        try {
            if (!"CLIENT_RESOURCES".equals(((Enum<?>) type).name())) return list; // data packs (server side) are not ours
            List<?> in = (List<?>) list;
            if (in.isEmpty()) return list;
            ClassLoader cl = type.getClass().getClassLoader();
            Object ours = pack;
            if (ours == null) {
                ours = makePack(cl);
                pack = ours;
                Debug.log("virtual pack made (hearts)");
            }
            for (Object p : in) if (p == ours) return list;
            List<Object> out = new ArrayList<Object>(in);
            out.add(Math.min(1, out.size()), ours); // right above the first (vanilla) pack: the player's own packs stay above us
            return out;
        } catch (Throwable t) {
            broken = true;
            Debug.log("virtual pack switched off: " + t);
            return list;
        }
    }

    private Object makePack(final ClassLoader cl) throws Exception {
        final Class<?> packResources = Class.forName("net.minecraft.server.packs.PackResources", true, cl);
        final Class<?> ioSupplier = Class.forName("net.minecraft.server.packs.resources.IoSupplier", true, cl);
        Class<?> locationClass;
        try {
            locationClass = Class.forName("net.minecraft.resources.Identifier", true, cl);
        } catch (ClassNotFoundException e) {
            locationClass = Class.forName("net.minecraft.resources.ResourceLocation", true, cl);
        }
        final Method factory = locationClass.getMethod("fromNamespaceAndPath", String.class, String.class);
        final Method getPath = locationClass.getMethod("getPath");
        final Method getNamespace = locationClass.getMethod("getNamespace");

        final InvocationHandler supplierHandler = new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method m, Object[] args) {
                return null; // replaced per file below
            }
        };
        // one supplier proxy per request, reading the bytes of one file
        final Map<String, byte[]> data = files;
        final Object[] holder = new Object[1];
        InvocationHandler handler = new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method m, Object[] args) throws Throwable {
                String name = m.getName();
                try {
                    if ("getResource".equals(name) && args != null && args.length == 2) {
                        if (!isClient(args[0])) return null;
                        Object loc = args[1];
                        if (!NS.equals(getNamespace.invoke(loc))) return null;
                        byte[] bytes = data.get((String) getPath.invoke(loc));
                        return bytes == null ? null : supplier(ioSupplier, cl, bytes);
                    }
                    if ("listResources".equals(name) && args != null && args.length == 4) {
                        if (!isClient(args[0]) || !NS.equals(args[1])) return null;
                        String prefix = (String) args[2];
                        @SuppressWarnings("unchecked")
                        BiConsumer<Object, Object> out = (BiConsumer<Object, Object>) args[3];
                        for (Map.Entry<String, byte[]> e : data.entrySet()) {
                            String p = e.getKey();
                            if (p.equals(prefix) || p.startsWith(prefix.endsWith("/") ? prefix : prefix + "/")) {
                                out.accept(factory.invoke(null, NS, p), supplier(ioSupplier, cl, e.getValue()));
                            }
                        }
                        return null;
                    }
                    if ("getNamespaces".equals(name)) {
                        Set<String> s = args != null && args.length == 1 && isClient(args[0]) ? Collections.singleton(NS) : Collections.<String>emptySet();
                        return s;
                    }
                    if ("packId".equals(name)) return "eternal_hearts";
                    if ("location".equals(name)) return location(cl);
                    if ("knownPackInfo".equals(name)) return Optional.empty();
                    if ("toString".equals(name)) return "EternalHearts";
                    if ("hashCode".equals(name)) return System.identityHashCode(proxy);
                    if ("equals".equals(name)) return args != null && args.length == 1 && args[0] == proxy;
                } catch (java.lang.reflect.InvocationTargetException e) {
                    throw e.getCause();
                }
                // getRootResource, getMetadataSection, close, anything else: "nothing here"
                Class<?> r = m.getReturnType();
                if (r == void.class) return null;
                if (r == Optional.class) return Optional.empty();
                if (r == boolean.class) return Boolean.FALSE;
                if (r == int.class) return Integer.valueOf(0);
                if (r == long.class) return Long.valueOf(0L);
                return null;
            }
        };
        return Proxy.newProxyInstance(cl, new Class<?>[] {packResources}, handler);
    }

    private static boolean isClient(Object type) {
        return type instanceof Enum && "CLIENT_RESOURCES".equals(((Enum<?>) type).name());
    }

    private static Object supplier(Class<?> ioSupplier, ClassLoader cl, final byte[] bytes) {
        return Proxy.newProxyInstance(cl, new Class<?>[] {ioSupplier}, new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method m, Object[] args) {
                if ("get".equals(m.getName())) return new ByteArrayInputStream(bytes);
                if ("toString".equals(m.getName())) return "EternalHeartsFile";
                if ("hashCode".equals(m.getName())) return System.identityHashCode(proxy);
                if ("equals".equals(m.getName())) return args != null && args.length == 1 && args[0] == proxy;
                return null;
            }
        });
    }

    /** PackLocationInfo(id, title, source, knownPack) — only 1.21+ asks for it. */
    private static Object location(ClassLoader cl) throws Exception {
        Class<?> info = Class.forName("net.minecraft.server.packs.PackLocationInfo", true, cl);
        Class<?> component = Class.forName("net.minecraft.network.chat.Component", true, cl);
        Class<?> source = Class.forName("net.minecraft.server.packs.repository.PackSource", true, cl);
        Object title = component.getMethod("literal", String.class).invoke(null, "Eternal");
        Object builtIn = source.getField("BUILT_IN").get(null);
        return info.getConstructor(String.class, component, source, Optional.class).newInstance("eternal_hearts", title, builtIn, Optional.empty());
    }

    /** Debug aid: asks the game's resource manager for the seven resources and writes what it finds. */
    void probe(Object player) {
        if (probed || !Debug.enabled() || player == null) return;
        probed = true;
        try {
            ClassLoader cl = player.getClass().getClassLoader();
            Class<?> mc = Class.forName("net.minecraft.client.Minecraft", true, cl);
            Object minecraft = mc.getMethod("getInstance").invoke(null);
            Object manager = mc.getMethod("getResourceManager").invoke(minecraft);
            Class<?> locationClass;
            try {
                locationClass = Class.forName("net.minecraft.resources.Identifier", true, cl);
            } catch (ClassNotFoundException e) {
                locationClass = Class.forName("net.minecraft.resources.ResourceLocation", true, cl);
            }
            Method factory = locationClass.getMethod("fromNamespaceAndPath", String.class, String.class);
            StringBuilder report = new StringBuilder();
            for (String path : new String[] {"particles/heart.json", "textures/particle/eternal_heart_0.png", "textures/particle/eternal_heart_5.png", "textures/particle/heart.png"}) {
                Object opt = manager.getClass().getMethod("getResource", locationClass).invoke(manager, factory.invoke(null, NS, path));
                Object res = ((Optional<?>) opt).orElse(null);
                String detail = "absent";
                if (res != null) {
                    java.io.InputStream in = (java.io.InputStream) res.getClass().getMethod("open").invoke(res);
                    byte[] b = new byte[4096];
                    int n = in.read(b);
                    in.close();
                    detail = (path.endsWith(".json") ? new String(b, 0, Math.max(n, 0), StandardCharsets.UTF_8) : (n >= 4 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G' ? "PNG, first read " + n + " B" : "not a PNG"));
                    detail += " (pack " + res.getClass().getMethod("sourcePackId").invoke(res) + ")";
                }
                report.append(path).append(" -> ").append(detail).append(" | ");
            }
            Debug.log("virtual pack probe: " + report);
        } catch (Throwable t) {
            Debug.log("virtual pack probe failed: " + t);
        }
    }

    private volatile boolean probed;
}