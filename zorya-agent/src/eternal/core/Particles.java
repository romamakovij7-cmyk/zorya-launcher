package eternal.core;

import java.lang.reflect.Method;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Hearts around players who wear them (Chubrik hearts, like on the launcher's home screen). Called from the patched Player.tick()
 * for every player the client knows — the local one and the others. Only the client side spawns anything, and a player who does not
 * wear hearts costs one hash lookup per tick.
 *
 * Works through the game's own API by reflection, with the names the game has at run time where it is not obfuscated (Minecraft 26.1+,
 * NeoForge 1.20.5+): Entity.level()/getX()/getY()/getZ()/getUUID(), Level.isClientSide()/addParticle(...), ParticleTypes.HEART.
 * If any of that is missing (another version/mapping) the feature switches itself off with one note in the debug log.
 *
 * The local player does not see their OWN hearts in the first-person view (they would float in front of the camera): while the camera is
 * first-person nothing is spawned for the local player; in the third-person views and for other players the hearts are drawn as usual.
 * (Minecraft.getInstance().player / .options.getCameraType().isFirstPerson(); if that API is not found the hearts simply stay as they were.)
 */
final class Particles {
    private static final double PER_TICK = 2.4 / 20.0; // about two and a half hearts per second per player, like on the home screen

    private final CapeClient client;
    private volatile Reflection reflection;
    private volatile boolean broken;
    private volatile FirstPerson firstPerson;
    private volatile boolean firstPersonMissing;
    private long ticks;

    Particles(CapeClient client) {
        this.client = client;
    }

    /** The class loader of the game's classes is only known from the first player that is ticked. */
    private static final class Reflection {
        final Method level;
        final Method isClientSide;
        final Method addParticle;
        final Method getX;
        final Method getY;
        final Method getZ;
        final Method getUuid;
        final Method bbHeight;
        final Object heart;

        Reflection(Class<?> playerClass) throws Exception {
            ClassLoader cl = playerClass.getClassLoader();
            Class<?> entity = Class.forName("net.minecraft.world.entity.Entity", true, cl);
            Class<?> levelClass = Class.forName("net.minecraft.world.level.Level", true, cl);
            Class<?> options = Class.forName("net.minecraft.core.particles.ParticleOptions", true, cl);
            level = entity.getMethod("level");
            getX = entity.getMethod("getX");
            getY = entity.getMethod("getY");
            getZ = entity.getMethod("getZ");
            getUuid = entity.getMethod("getUUID");
            bbHeight = entity.getMethod("getBbHeight");
            isClientSide = levelClass.getMethod("isClientSide");
            addParticle = levelClass.getMethod("addParticle", options, double.class, double.class, double.class, double.class, double.class, double.class);
            heart = Class.forName("net.minecraft.core.particles.ParticleTypes", true, cl).getField("HEART").get(null);
        }
    }

    /** Is this player the local one, and is the camera first-person right now? */
    private static final class FirstPerson {
        final Method getInstance;
        final java.lang.reflect.Field playerField;
        final java.lang.reflect.Field optionsField;
        final Method getCameraType;
        final Method isFirstPerson;
        final Method setCameraType;
        final Class<?> cameraTypeClass;

        FirstPerson(ClassLoader cl) throws Exception {
            Class<?> mc = Class.forName("net.minecraft.client.Minecraft", true, cl);
            Class<?> options = Class.forName("net.minecraft.client.Options", true, cl);
            cameraTypeClass = Class.forName("net.minecraft.client.CameraType", true, cl);
            getInstance = mc.getMethod("getInstance");
            playerField = mc.getField("player");
            optionsField = mc.getField("options");
            getCameraType = options.getMethod("getCameraType");
            isFirstPerson = cameraTypeClass.getMethod("isFirstPerson");
            Method set = null;
            try { set = options.getMethod("setCameraType", cameraTypeClass); } catch (NoSuchMethodException ignored) { /* only the debug switch needs it */ }
            setCameraType = set;
        }

        boolean ownAndFirstPerson(Object player) throws Exception {
            Object mc = getInstance.invoke(null);
            if (mc == null || playerField.get(mc) != player) return false;
            Object options = optionsField.get(mc);
            return options != null && (Boolean) isFirstPerson.invoke(getCameraType.invoke(options));
        }

        /** Debug aid only: what the check sees. */
        String describe(Object player) throws Exception {
            Object mc = getInstance.invoke(null);
            Object options = mc == null ? null : optionsField.get(mc);
            Object camera = options == null ? null : getCameraType.invoke(options);
            return "own=" + (mc != null && playerField.get(mc) == player) + " camera=" + camera + " mcPlayer=" + (mc == null ? null : playerField.get(mc)) + " thisPlayer=" + player.getClass().getSimpleName();
        }

        /** Debug aid only: puts the camera in the third-person (back) view. */
        void thirdPerson() throws Exception {
            Object options = optionsField.get(getInstance.invoke(null));
            if (setCameraType != null && options != null) setCameraType.invoke(options, Enum.valueOf((Class) cameraTypeClass, "THIRD_PERSON_BACK"));
        }
    }

    Object tick(Object player, Object unused) {
        if (broken || player == null) return null;
        try {
            Reflection r = reflection;
            if (r == null) {
                r = new Reflection(player.getClass());
                reflection = r;
                Debug.log("particles: game API found");
            }
            Object level = r.level.invoke(player);
            if (level == null || !((Boolean) r.isClientSide.invoke(level))) return null; // the integrated server's copy of the player
            Object id = r.getUuid.invoke(player);
            if (id == null || !client.hearts(id.toString().replace("-", "").toLowerCase())) return null;
            // your own hearts are not drawn in the first-person view
            FirstPerson fp = firstPerson;
            if (fp == null && !firstPersonMissing) {
                try {
                    fp = new FirstPerson(player.getClass().getClassLoader());
                    firstPerson = fp;
                } catch (Throwable missing) {
                    firstPersonMissing = true;
                    Debug.log("particles: first-person check unavailable, own hearts stay visible: " + missing);
                }
            }
            if (fp != null) {
                // debug aid (only with the debug log on and -Deternal.debug.thirdperson=1): after a while switch to the third-person view
                if (Debug.enabled() && Boolean.getBoolean("eternal.debug.thirdperson") && ++ticks == 240) { fp.thirdPerson(); spawnedAtSwitch = spawned; Debug.log("particles: camera switched to third person (debug), hearts so far = " + spawned); }
                if (fp.ownAndFirstPerson(player)) { skippedFirstPerson++; if (skippedFirstPerson == 1) Debug.log("particles: own hearts hidden in the first-person view"); return null; }
            }
            ThreadLocalRandom rnd = ThreadLocalRandom.current();
            if (rnd.nextDouble() >= PER_TICK) return null;
            double height = ((Number) r.bbHeight.invoke(player)).doubleValue();
            double x = ((Number) r.getX.invoke(player)).doubleValue() + (rnd.nextDouble() - 0.5) * 1.1;
            double y = ((Number) r.getY.invoke(player)).doubleValue() + 0.15 + rnd.nextDouble() * (height * 0.9);
            double z = ((Number) r.getZ.invoke(player)).doubleValue() + (rnd.nextDouble() - 0.5) * 1.1;
            r.addParticle.invoke(level, r.heart, x, y, z, 0.0, 0.0, 0.0);
            spawned++;
            if (spawned == 1 || spawned % 50 == 0) Debug.log("particles: hearts spawned so far = " + spawned);
            if (Debug.enabled() && firstPerson != null && (spawned == 1 || spawned == 10)) Debug.log("particles: spawn context: " + firstPerson.describe(player));
            if (spawnedAtSwitch >= 0 && spawned == spawnedAtSwitch + 1) Debug.log("particles: first heart after the camera switch (debug)");
        } catch (Throwable t) {
            broken = true;
            Debug.log("particles switched off: " + t);
        }
        return null;
    }

    private volatile long spawned;
    private volatile long skippedFirstPerson;
    private volatile long spawnedAtSwitch = -1;
}
