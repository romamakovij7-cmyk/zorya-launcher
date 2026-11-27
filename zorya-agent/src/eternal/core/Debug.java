package eternal.core;

import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;

/** Optional log file (agent option 3): what was patched, which players were asked about, what came back. Off by default. */
final class Debug {
    private static volatile String file;

    private Debug() { }

    static boolean enabled() {
        return file != null;
    }

    static void init(String path) {
        file = path;
    }

    static synchronized void log(String message) {
        String f = file;
        if (f == null) return;
        try (PrintWriter out = new PrintWriter(new FileWriter(f, true))) {
            out.println(System.currentTimeMillis() + " " + message);
        } catch (IOException ignored) {
            // logging only
        }
    }
}
