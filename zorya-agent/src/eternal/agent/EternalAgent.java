package eternal.agent;

import java.io.File;
import java.lang.instrument.Instrumentation;
import java.net.URL;
import java.net.URLClassLoader;

/**
 * Eternal Cosmetics: shows Eternal capes on Microsoft accounts. It does not touch authentication at all — it only adds a cape
 * texture to what authlib already unpacked for a player. Started with
 *   -javaagent:eternal-agent.jar=CORE_JAR_NAME|API_ROOT[|DEBUG_FILE]
 * The (big) core with ASM lives in its own class loader whose parent is the platform loader, so nothing of it is visible to the
 * game's own libraries (Fabric/Forge bring their own ASM) and nothing of the game is visible to it.
 */
public final class EternalAgent {
    private EternalAgent() { }

    public static void premain(String args, Instrumentation inst) {
        try {
            if (System.getProperty("eternal.agent.trace") != null) System.err.println("[eternal-agent] premain, args=" + args);
            if (args == null) return;
            String[] parts = args.split("\\|", 3);
            if (parts.length < 2) return;

            // The core is found next to this jar by its file name: paths with non-Latin letters (a Cyrillic Windows user name)
            // arrive in agent options as question marks, so a full path in the options cannot be trusted.
            File self = new File(EternalAgent.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            File core = new File(parts[0]);
            if (!core.isAbsolute()) core = new File(self.getParentFile(), parts[0]);
            if (!core.isFile()) {
                if (System.getProperty("eternal.agent.trace") != null) System.err.println("[eternal-agent] core not found: " + core);
                return;
            }

            URLClassLoader loader = new URLClassLoader(new URL[] {core.toURI().toURL()}, platformLoader());
            Class<?> coreClass = loader.loadClass("eternal.core.Core");
            coreClass.getMethod("install", Instrumentation.class, String.class, String.class)
                    .invoke(null, inst, parts[1], parts.length > 2 && !parts[2].isEmpty() ? parts[2] : null);
        } catch (Throwable t) {
            // cosmetics must never stop the game from starting; the reason is shown only when asked for (-Deternal.agent.trace=1)
            if (System.getProperty("eternal.agent.trace") != null) t.printStackTrace();
        }
    }

    private static ClassLoader platformLoader() {
        try {
            return (ClassLoader) ClassLoader.class.getMethod("getPlatformClassLoader").invoke(null);
        } catch (Throwable java8) {
            return null; // Java 8: the bootstrap loader is the parent
        }
    }
}
