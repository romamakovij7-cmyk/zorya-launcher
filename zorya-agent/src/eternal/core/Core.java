package eternal.core;

import java.lang.instrument.Instrumentation;
import java.util.function.BiFunction;

/** Entry point called by the agent: installs the cape hook and starts patching authlib when it loads. */
public final class Core {
    private Core() { }

    public static void install(Instrumentation inst, String apiRoot, String debugFile) {
        Debug.init(debugFile);
        final CapeClient client = new CapeClient(apiRoot);
        final Cosmetics cosmetics = new Cosmetics(client);
        final Particles particles = new Particles(client);
        final Names names = new Names(client);
        final VirtualPack virtualPack = new VirtualPack();
        final Metrics metrics = new Metrics();

        // The patched authlib code calls this and nothing else of ours. It must never throw and never return null:
        // any problem means "leave authlib's own result as it is".
        final BiFunction<Object, Object, Object> hook = new BiFunction<Object, Object, Object>() {
            @Override
            public Object apply(Object result, Object source) {
                if (result == null) return null;
                try {
                    Object patched = cosmetics.apply(result, source);
                    return patched != null ? patched : result;
                } catch (Throwable t) {
                    return result;
                }
            }
        };
        final BiFunction<Object, Object, Object> packed = new BiFunction<Object, Object, Object>() {
            @Override
            public Object apply(Object result, Object profile) {
                try {
                    return cosmetics.packed(result, profile);
                } catch (Throwable t) {
                    return result;
                }
            }
        };
        final BiFunction<Object, Object, Object> vpack = new BiFunction<Object, Object, Object>() {
            @Override
            public Object apply(Object list, Object type) {
                try {
                    return virtualPack.addTo(list, type);
                } catch (Throwable t) {
                    return list;
                }
            }
        };
        final BiFunction<Object, Object, Object> tick = new BiFunction<Object, Object, Object>() {
            @Override
            public Object apply(Object player, Object unused) {
                names.probe(player);
                virtualPack.probe(player);
                return particles.tick(player, unused);
            }
        };
        final BiFunction<Object, Object, Object> name = new BiFunction<Object, Object, Object>() {
            @Override
            public Object apply(Object result, Object source) {
                return names.apply(result, source);
            }
        };
        final BiFunction<Object, Object, Object> frame = new BiFunction<Object, Object, Object>() {
            @Override
            public Object apply(Object minecraft, Object unused) {
                return metrics.frame(minecraft);
            }
        };
        System.getProperties().put(Patcher.TEXTURES_KEY, hook);
        System.getProperties().put(Patcher.TICK_KEY, tick);
        System.getProperties().put(Patcher.NAME_KEY, name);
        System.getProperties().put(Patcher.PACKED_KEY, packed);
        System.getProperties().put(Patcher.VPACK_KEY, vpack);
        System.getProperties().put(Patcher.FRAME_KEY, frame);
        inst.addTransformer(new Patcher(), false);

        // If something replaces the whole set of system properties, the hook would vanish and the patched method would fail:
        // a daemon thread puts it back (checked every few seconds, costs nothing).
        Thread guard = new Thread(new Runnable() {
            @Override
            public void run() {
                while (true) {
                    try {
                        Thread.sleep(5000);
                        if (System.getProperties().get(Patcher.TEXTURES_KEY) != hook || System.getProperties().get(Patcher.TICK_KEY) != tick || System.getProperties().get(Patcher.NAME_KEY) != name || System.getProperties().get(Patcher.PACKED_KEY) != packed || System.getProperties().get(Patcher.VPACK_KEY) != vpack || System.getProperties().get(Patcher.FRAME_KEY) != frame) {
                            System.getProperties().put(Patcher.TEXTURES_KEY, hook);
                            System.getProperties().put(Patcher.TICK_KEY, tick);
                            System.getProperties().put(Patcher.NAME_KEY, name);
                            System.getProperties().put(Patcher.PACKED_KEY, packed);
                            System.getProperties().put(Patcher.VPACK_KEY, vpack);
                            System.getProperties().put(Patcher.FRAME_KEY, frame);
                            Debug.log("hooks restored");
                        }
                    } catch (InterruptedException e) {
                        return;
                    } catch (Throwable ignored) {
                        // keep guarding
                    }
                }
            }
        }, "eternal-cosmetics-guard");
        guard.setDaemon(true);
        guard.start();
        Debug.log("installed, api=" + apiRoot + ", java=" + System.getProperty("java.version"));
    }
}
