import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.net.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

/**
 * Test probe: asks the real authlib of a Minecraft version to unpack the textures of a player, exactly as the game does, and prints
 * which skin/cape came out. Run with the version's own libraries on the class path, with and without the Eternal agent.
 * Reflection only, so one compiled class works against every authlib version.
 */
public class Probe {
    public static void main(String[] args) throws Exception {
        String hex = args[0].replace("-", "").toLowerCase();
        UUID id = UUID.fromString(hex.replaceFirst("(\\p{XDigit}{8})(\\p{XDigit}{4})(\\p{XDigit}{4})(\\p{XDigit}{4})(\\p{XDigit}+)", "$1-$2-$3-$4-$5"));
        String json = "{\"timestamp\":1,\"profileId\":\"" + hex + "\",\"profileName\":\"Notch\",\"textures\":{\"SKIN\":{\"url\":\"http://textures.minecraft.net/texture/abcdef\"}}}";
        String value = Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));

        Class<?> authClass = Class.forName("com.mojang.authlib.yggdrasil.YggdrasilAuthenticationService");
        Object auth = newAuth(authClass);
        Object session = authClass.getMethod("createMinecraftSessionService").invoke(auth);

        Class<?> propertyClass = Class.forName("com.mojang.authlib.properties.Property");
        Object property = propertyClass.getConstructor(String.class, String.class, String.class).newInstance("textures", value, null);

        Object result;
        Method unpack = null;
        for (Method m : session.getClass().getMethods()) {
            if (m.getName().equals("unpackTextures") && m.getParameterTypes().length == 1) unpack = m;
        }
        String shape;
        if (unpack != null) {
            shape = "record";
            result = unpack.invoke(session, property);
        } else {
            shape = "map";
            Class<?> profileClass = Class.forName("com.mojang.authlib.GameProfile");
            Object profile = profileClass.getConstructor(UUID.class, String.class).newInstance(id, "Notch");
            Object props = profileClass.getMethod("getProperties").invoke(profile);
            props.getClass().getMethod("put", Object.class, Object.class).invoke(props, "textures", property);
            result = session.getClass().getMethod("getTextures", profileClass, boolean.class).invoke(session, profile, false);
        }
        System.out.println("authlib " + shape + " | SKIN=" + urlOf(result, "SKIN") + " | CAPE=" + urlOf(result, "CAPE"));
        // joinServer: with -Deternal.offline=1 and the agent it must return at once; otherwise it tries the network and fails
        long t0 = System.currentTimeMillis();
        try {
            session.getClass().getMethod("joinServer", UUID.class, String.class, String.class).invoke(session, id, "0", "probe");
            System.out.println("joinServer returned after " + (System.currentTimeMillis() - t0) + " ms");
        } catch (java.lang.reflect.InvocationTargetException e) {
            System.out.println("joinServer threw " + e.getCause().getClass().getSimpleName() + " after " + (System.currentTimeMillis() - t0) + " ms");
        }
    }

    private static Object newAuth(Class<?> authClass) throws Exception {
        for (Constructor<?> c : authClass.getConstructors()) {
            Class<?>[] t = c.getParameterTypes();
            if (t.length == 1 && t[0] == Proxy.class) return c.newInstance(Proxy.NO_PROXY);
        }
        for (Constructor<?> c : authClass.getConstructors()) {
            Class<?>[] t = c.getParameterTypes();
            if (t.length == 2 && t[0] == Proxy.class && t[1] == String.class) return c.newInstance(Proxy.NO_PROXY, "probe");
        }
        throw new IllegalStateException("no usable YggdrasilAuthenticationService constructor");
    }

    private static String urlOf(Object result, String type) throws Exception {
        Object texture = null;
        if (result instanceof Map) {
            for (Object entry : ((Map<?, ?>) result).entrySet()) {
                Map.Entry<?, ?> e = (Map.Entry<?, ?>) entry;
                if (e.getKey().toString().equals(type)) texture = e.getValue();
            }
        } else {
            texture = result.getClass().getMethod(type.toLowerCase()).invoke(result);
        }
        return texture == null ? "none" : String.valueOf(texture.getClass().getMethod("getUrl").invoke(texture));
    }
}
