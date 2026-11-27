package eternal.core;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Called (through eternal.boot.Bridge) with what authlib produced for a player. If the player wears an Eternal cape, a CAPE
 * texture is added; everything else — the skin, the elytra, the signature state — stays exactly as authlib returned it.
 * authlib's classes are reached through reflection on the class loader that authlib itself lives in, so this works the same on
 * vanilla, Fabric, Forge and NeoForge and for every authlib version that has either result shape.
 */
final class Cosmetics {
    private static final Pattern PROFILE_ID = Pattern.compile("\"profileId\"\\s*:\\s*\"([0-9a-fA-F-]{32,36})\"");

    private final CapeClient client;

    Cosmetics(CapeClient client) {
        this.client = client;
    }

    Object apply(Object result, Object source) {
        try {
            String uuid = uuidOf(source);
            if (uuid == null) return result;
            CapeClient.Entry entry = client.entry(uuid);
            if (entry == null || (entry.url == null && entry.skinUrl == null)) return result;

            ClassLoader authlib = source.getClass().getClassLoader();
            Class<?> textureClass = Class.forName("com.mojang.authlib.minecraft.MinecraftProfileTexture", true, authlib);
            Object cape = entry.url == null ? null : textureClass.getConstructor(String.class, Map.class).newInstance(entry.url, null);
            Map<String, String> slim = new HashMap<String, String>();
            slim.put("model", "slim");
            Object ourSkin = entry.skinUrl == null ? null : textureClass.getConstructor(String.class, Map.class).newInstance(entry.skinUrl, entry.skinSlim ? slim : null);

            if (result instanceof Map) {
                // 1.7 – 1.20.1: Map<Type, MinecraftProfileTexture>
                @SuppressWarnings({"unchecked", "rawtypes"})
                Class<? extends Enum> typeClass = (Class<? extends Enum>) Class.forName("com.mojang.authlib.minecraft.MinecraftProfileTexture$Type", true, authlib);
                @SuppressWarnings({"unchecked", "rawtypes"})
                Object capeKey = Enum.valueOf((Class) typeClass, "CAPE");
                @SuppressWarnings({"unchecked", "rawtypes"})
                Map<Object, Object> copy = new HashMap<Object, Object>((Map) result);
                if (cape != null) {
                    copy.put(capeKey, cape);
                    Debug.log("cape added (map) for " + uuid);
                }
                if (ourSkin != null) {
                    @SuppressWarnings({"unchecked", "rawtypes"})
                    Object skinKey = Enum.valueOf((Class) typeClass, "SKIN");
                    if (!copy.containsKey(skinKey)) { // the game found no skin of its own: an offline nick
                        copy.put(skinKey, ourSkin);
                        Debug.log("skin added (map) for " + uuid);
                    }
                }
                return copy;
            }
            if (result.getClass().getName().equals("com.mojang.authlib.minecraft.MinecraftProfileTextures")) {
                // 1.20.2 and up: record MinecraftProfileTextures(skin, cape, elytra, signatureState)
                Class<?> rc = result.getClass();
                Object skin = call(result, "skin");
                if (skin == null && ourSkin != null) {
                    skin = ourSkin; // the game found no skin of its own: an offline nick
                    Debug.log("skin added (record) for " + uuid);
                }
                if (cape == null) cape = call(result, "cape");
                Object elytra = call(result, "elytra");
                Object state = call(result, "signatureState");
                Constructor<?> ctor = null;
                for (Constructor<?> c : rc.getConstructors()) {
                    if (c.getParameterTypes().length == 4) ctor = c;
                }
                if (ctor == null) return result;
                if (entry.url != null) Debug.log("cape added (record) for " + uuid);
                return ctor.newInstance(skin, cape, elytra, state);
            }
        } catch (Throwable t) {
            Debug.log("apply failed: " + t);
        }
        return result;
    }

    /**
     * MinecraftSessionService.getPackedTextures(GameProfile): the game's own answer is null for a nick Mojang does not know — an
     * offline nick (UUID of version 3). If our server has a skin for it, a textures property without any picture is made up, so the
     * game goes on to unpack it and apply() above puts our skin into the result. Players with a real Mojang profile are never asked about here.
     */
    Object packed(Object result, Object profile) {
        if (result != null || profile == null) return result;
        try {
            String uuid = uuidOf(profile);
            if (uuid == null || uuid.length() != 32 || uuid.charAt(12) != '3') return result;
            CapeClient.Entry entry = client.entry(uuid);
            if (entry == null || entry.skinUrl == null) return result;
            Object name = firstOf(profile, "getName", "name");
            String json = "{\"timestamp\":" + System.currentTimeMillis() + ",\"profileId\":\"" + uuid + "\",\"profileName\":\"" + (name == null ? "Player" : name.toString().replaceAll("[^A-Za-z0-9_]", "")) + "\",\"textures\":{}}";
            Class<?> propertyClass = Class.forName("com.mojang.authlib.properties.Property", true, profile.getClass().getClassLoader());
            Debug.log("packed textures made up for offline nick " + uuid);
            return propertyClass.getConstructor(String.class, String.class).newInstance("textures", Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8)));
        } catch (Throwable t) {
            Debug.log("packed failed: " + t);
            return result;
        }
    }

    private static Object call(Object target, String method) throws Exception {
        Method m = target.getClass().getMethod(method);
        return m.invoke(target);
    }

    /** A GameProfile (older authlib) or a textures Property (newer): the player's UUID as 32 lower-case hex characters. */
    private static String uuidOf(Object source) {
        if (source == null) return null;
        try {
            String type = source.getClass().getName();
            if (type.endsWith("GameProfile")) {
                Object id = firstOf(source, "getId", "id");
                return id == null ? null : id.toString().replace("-", "").toLowerCase();
            }
            if (type.endsWith("Property")) {
                Object value = firstOf(source, "value", "getValue");
                if (value == null) return null;
                String json = new String(Base64.getMimeDecoder().decode(value.toString()), StandardCharsets.UTF_8);
                Matcher m = PROFILE_ID.matcher(json);
                return m.find() ? m.group(1).replace("-", "").toLowerCase() : null;
            }
        } catch (Throwable ignored) {
            // an unknown shape: leave the player alone
        }
        return null;
    }

    private static Object firstOf(Object target, String... methods) throws Exception {
        for (String name : methods) {
            try {
                return target.getClass().getMethod(name).invoke(target);
            } catch (NoSuchMethodException next) {
                // try the next spelling
            }
        }
        return null;
    }
}
