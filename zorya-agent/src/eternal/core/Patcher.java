package eternal.core;

import java.lang.instrument.ClassFileTransformer;
import java.security.ProtectionDomain;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

/**
 * Patches two places of the game, each through a hook (a java.util.function.BiFunction kept in the system properties):
 *
 * 1. authlib's YggdrasilMinecraftSessionService — right before the method that turns a player's profile into textures returns, its
 *    result goes through the hook, which may add a cape:
 *      1.7 – 1.20.1   Map getTextures(GameProfile, boolean)
 *      1.20.2 and up  MinecraftProfileTextures unpackTextures(Property)
 * 2. net.minecraft.world.entity.player.Player.tick() — at its end the hook gets the player (hearts around the player). This class
 *    has this name and a method "tick" only where the game's own names are used at run time (Minecraft 26.1 and newer, NeoForge from
 *    1.20.5); anywhere else it simply is not found and nothing happens.
 *
 * The inserted code is one call to a small static helper that is generated into the same class. The helper wraps the hook call in
 * try/catch, so a missing or failing hook can never break skins or crash the game: it returns authlib's own result / does nothing.
 * It refers to JDK classes only (System, Properties, BiFunction): Fabric's class loader refuses to hand any class from the class path
 * to the game, and Forge's module layers see only what is exported to them — the JDK is visible everywhere. The patched methods get
 * straight-line code (no branches), so their stack-map frames stay valid.
 */
final class Patcher implements ClassFileTransformer {
    static final String TEXTURES_KEY = "eternal.cosmetics.hook";
    static final String TICK_KEY = "eternal.cosmetics.tick";
    static final String NAME_KEY = "eternal.cosmetics.name";
    static final String PACKED_KEY = "eternal.cosmetics.packed";
    static final String VPACK_KEY = "eternal.cosmetics.vpack";
    static final String FRAME_KEY = "eternal.cosmetics.frame";

    // authlib up to 7.x: yggdrasil.YggdrasilMinecraftSessionService; authlib 10 (Minecraft 26.3) renamed it, same methods
    private static final String AUTHLIB = "com/mojang/authlib/yggdrasil/YggdrasilMinecraftSessionService";
    private static final String AUTHLIB_NEW = "com/mojang/authlib/services/MinecraftServicesSessionService";
    private static final String PLAYER = "net/minecraft/world/entity/player/Player";
    private static final String TAB = "net/minecraft/client/gui/components/PlayerTabOverlay";
    private static final String MULTI = "net/minecraft/server/packs/resources/MultiPackResourceManager";
    private static final String MINECRAFT = "net/minecraft/client/Minecraft";
    private static final String MULTI_DESC = "(Lnet/minecraft/server/packs/PackType;Ljava/util/List;)V";
    private static final String COMPONENT_DESC = "()Lnet/minecraft/network/chat/Component;";
    private static final String TAB_NAME_DESC = "(Lnet/minecraft/client/multiplayer/PlayerInfo;)Lnet/minecraft/network/chat/Component;";
    private static final String UNPACK_DESC = "(Lcom/mojang/authlib/properties/Property;)Lcom/mojang/authlib/minecraft/MinecraftProfileTextures;";
    private static final String PACKED_DESC = "(Lcom/mojang/authlib/GameProfile;)Lcom/mojang/authlib/properties/Property;";
    private static final String GET_DESC = "(Lcom/mojang/authlib/GameProfile;Z)Ljava/util/Map;";
    private static final String OBJ = "java/lang/Object";
    private static final String BIFUNCTION = "java/util/function/BiFunction";
    private static final String APPLY_DESC = "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;";
    private static final String HELPER_TEXTURES = "eternal$textures";
    private static final String HELPER_TICK = "eternal$tick";
    private static final String HELPER_NAME = "eternal$name";
    private static final String HELPER_PACKED = "eternal$packed";
    private static final String HELPER_VPACK = "eternal$vpack";
    private static final String HELPER_FRAME = "eternal$frame";
    private static final String HELPER_OFFLINE = "eternal$offline";
    private static final String JOIN_DESC = "(Ljava/util/UUID;Ljava/lang/String;Ljava/lang/String;)V";

    @Override
    public byte[] transform(ClassLoader loader, String className, Class<?> redefined, ProtectionDomain domain, byte[] classfile) {
        final boolean authlib = AUTHLIB.equals(className) || AUTHLIB_NEW.equals(className);
        final boolean player = PLAYER.equals(className);
        final boolean tab = TAB.equals(className);
        final boolean multi = MULTI.equals(className);
        final boolean minecraft = MINECRAFT.equals(className);
        if (!authlib && !player && !tab && !multi && !minecraft) return null;
        try {
            ClassReader reader = new ClassReader(classfile);
            ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
            PatchVisitor visitor = new PatchVisitor(writer, className, authlib, tab, multi, minecraft);
            reader.accept(visitor, 0);
            if (visitor.patched == 0) {
                Debug.log("class " + className + " found but no known method to patch");
                return null;
            }
            Debug.log("patched " + visitor.patched + " method(s) of " + className);
            return writer.toByteArray();
        } catch (Throwable t) {
            Debug.log("patch failed for " + className + ": " + t);
            return null;
        }
    }

    private static final class PatchVisitor extends ClassVisitor {
        private final String owner;
        private final boolean authlib;
        private final boolean tab;
        private final boolean multi;
        private final boolean minecraft;
        private boolean framePatched;
        private boolean vpackPatched;
        private boolean joinPatched;
        private boolean tickPatched;
        private boolean namePatched;
        private boolean packedPatched;
        int patched;

        PatchVisitor(ClassVisitor next, String owner, boolean authlib, boolean tab, boolean multi, boolean minecraft) {
            super(Opcodes.ASM9, next);
            this.owner = owner;
            this.authlib = authlib;
            this.tab = tab;
            this.multi = multi;
            this.minecraft = minecraft;
        }

        @Override
        public MethodVisitor visitMethod(int access, String name, String desc, String signature, String[] exceptions) {
            MethodVisitor mv = super.visitMethod(access, name, desc, signature, exceptions);
            // An offline account has no Mojang session: joining a server (the game's "join" call to the session server) is skipped for it
            // instead of failing. A LAN world of a licensed player then lets it in (the integrated server does not insist on the check).
            if (authlib && "joinServer".equals(name) && JOIN_DESC.equals(desc)) {
                patched++;
                joinPatched = true;
                return new MethodVisitor(Opcodes.ASM9, mv) {
                    @Override
                    public void visitCode() {
                        super.visitCode();
                        Label go = new Label();
                        super.visitMethodInsn(Opcodes.INVOKESTATIC, owner, HELPER_OFFLINE, "()Z", false);
                        super.visitJumpInsn(Opcodes.IFEQ, go);
                        super.visitInsn(Opcodes.RETURN);
                        super.visitLabel(go);
                        super.visitFrame(Opcodes.F_SAME, 0, null, 0, null);
                    }
                };
            }
            if (authlib && "getPackedTextures".equals(name) && PACKED_DESC.equals(desc)) {
                patched++;
                packedPatched = true;
                return new MethodVisitor(Opcodes.ASM9, mv) {
                    @Override
                    public void visitInsn(int opcode) {
                        if (opcode == Opcodes.ARETURN) {
                            // stack: property or null  ->  property, profile  ->  the game's own answer or a made-up textures property
                            super.visitVarInsn(Opcodes.ALOAD, 1);
                            super.visitMethodInsn(Opcodes.INVOKESTATIC, owner, HELPER_PACKED, APPLY_DESC, false);
                            super.visitTypeInsn(Opcodes.CHECKCAST, "com/mojang/authlib/properties/Property");
                        }
                        super.visitInsn(opcode);
                    }
                };
            }
            if (authlib) {
                final String returnType;
                if ("unpackTextures".equals(name) && UNPACK_DESC.equals(desc)) {
                    returnType = "com/mojang/authlib/minecraft/MinecraftProfileTextures";
                } else if ("getTextures".equals(name) && GET_DESC.equals(desc)) {
                    returnType = "java/util/Map";
                } else {
                    return mv;
                }
                patched++;
                return new MethodVisitor(Opcodes.ASM9, mv) {
                    @Override
                    public void visitInsn(int opcode) {
                        if (opcode == Opcodes.ARETURN) {
                            // stack: result  ->  result, argument  ->  patched result (the helper never throws)
                            super.visitVarInsn(Opcodes.ALOAD, 1);
                            super.visitMethodInsn(Opcodes.INVOKESTATIC, owner, HELPER_TEXTURES, APPLY_DESC, false);
                            super.visitTypeInsn(Opcodes.CHECKCAST, returnType);
                        }
                        super.visitInsn(opcode);
                    }
                };
            }
            if ((access & Opcodes.ACC_STATIC) != 0 || (access & Opcodes.ACC_ABSTRACT) != 0) return mv;
            // The game's main loop: once per frame the monitor of the overlay is told (see Metrics)
            if (minecraft) {
                if (!"runTick".equals(name) || !"(Z)V".equals(desc)) return mv;
                patched++;
                framePatched = true;
                return new MethodVisitor(Opcodes.ASM9, mv) {
                    @Override
                    public void visitCode() {
                        super.visitCode();
                        super.visitVarInsn(Opcodes.ALOAD, 0);
                        super.visitMethodInsn(Opcodes.INVOKESTATIC, owner, HELPER_FRAME, "(Ljava/lang/Object;)V", false);
                    }
                };
            }
            // The game's resource manager: the constructor gets our in-memory pack added to its list of packs (see VirtualPack)
            if (multi) {
                if (!"<init>".equals(name) || !MULTI_DESC.equals(desc)) return mv;
                patched++;
                vpackPatched = true;
                return new MethodVisitor(Opcodes.ASM9, mv) {
                    @Override
                    public void visitCode() {
                        super.visitCode();
                        // list = hook(list, type), before the constructor's own first instruction (plain local variables only)
                        super.visitVarInsn(Opcodes.ALOAD, 2);
                        super.visitVarInsn(Opcodes.ALOAD, 1);
                        super.visitMethodInsn(Opcodes.INVOKESTATIC, owner, HELPER_VPACK, APPLY_DESC, false);
                        super.visitTypeInsn(Opcodes.CHECKCAST, "java/util/List");
                        super.visitVarInsn(Opcodes.ASTORE, 2);
                    }
                };
            }            // the name shown over the head (Player.getDisplayName) and in the tab list (PlayerTabOverlay.getNameForDisplay)
            final boolean displayName = !tab && "getDisplayName".equals(name) && COMPONENT_DESC.equals(desc);
            final boolean tabName = tab && "getNameForDisplay".equals(name) && TAB_NAME_DESC.equals(desc);
            if (displayName || tabName) {
                patched++;
                namePatched = true;
                final int sourceSlot = tabName ? 1 : 0;
                return new MethodVisitor(Opcodes.ASM9, mv) {
                    @Override
                    public void visitInsn(int opcode) {
                        if (opcode == Opcodes.ARETURN) {
                            // stack: component  ->  component, source  ->  recoloured component (the helper never throws)
                            super.visitVarInsn(Opcodes.ALOAD, sourceSlot);
                            super.visitMethodInsn(Opcodes.INVOKESTATIC, owner, HELPER_NAME, APPLY_DESC, false);
                            super.visitTypeInsn(Opcodes.CHECKCAST, "net/minecraft/network/chat/Component");
                        }
                        super.visitInsn(opcode);
                    }
                };
            }
            if (!"tick".equals(name) || !"()V".equals(desc)) return mv;
            patched++;
            tickPatched = true;
            return new MethodVisitor(Opcodes.ASM9, mv) {
                @Override
                public void visitInsn(int opcode) {
                    if (opcode == Opcodes.RETURN) {
                        super.visitVarInsn(Opcodes.ALOAD, 0);
                        super.visitMethodInsn(Opcodes.INVOKESTATIC, owner, HELPER_TICK, "(Ljava/lang/Object;)V", false);
                    }
                    super.visitInsn(opcode);
                }
            };
        }

        @Override
        public void visitEnd() {
            if (patched > 0) {
                if (authlib && patched > (packedPatched ? 1 : 0) + (joinPatched ? 1 : 0)) addTexturesHelper();
                if (joinPatched) addOfflineHelper();
                if (packedPatched) addHelper(HELPER_PACKED, PACKED_KEY);
                if (vpackPatched) addHelper(HELPER_VPACK, VPACK_KEY);
                if (tickPatched) addTickHelper(HELPER_TICK, TICK_KEY);
                if (framePatched) addTickHelper(HELPER_FRAME, FRAME_KEY);
                if (namePatched) addNameHelper();
            }
            super.visitEnd();
        }

        /** private static Object eternal$textures(Object result, Object source) { try { return hook.apply(result, source); } catch (Throwable t) { return result; } } */
        private void addTexturesHelper() {
            MethodVisitor m = super.visitMethod(Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC | Opcodes.ACC_SYNTHETIC, HELPER_TEXTURES, APPLY_DESC, null, null);
            Label start = new Label();
            Label end = new Label();
            Label handler = new Label();
            m.visitCode();
            m.visitTryCatchBlock(start, end, handler, "java/lang/Throwable");
            m.visitLabel(start);
            loadHook(m, TEXTURES_KEY);
            m.visitVarInsn(Opcodes.ALOAD, 0);
            m.visitVarInsn(Opcodes.ALOAD, 1);
            m.visitMethodInsn(Opcodes.INVOKEINTERFACE, BIFUNCTION, "apply", APPLY_DESC, true);
            m.visitLabel(end);
            m.visitInsn(Opcodes.ARETURN);
            m.visitLabel(handler);
            m.visitFrame(Opcodes.F_NEW, 2, new Object[] {OBJ, OBJ}, 1, new Object[] {"java/lang/Throwable"});
            m.visitVarInsn(Opcodes.ASTORE, 2);
            m.visitVarInsn(Opcodes.ALOAD, 0);
            m.visitInsn(Opcodes.ARETURN);
            m.visitMaxs(0, 0);
            m.visitEnd();
        }

        /** private static boolean eternal$offline() { return "1".equals(System.getProperty("eternal.offline")); }  (no branches) */
        private void addOfflineHelper() {
            MethodVisitor m = super.visitMethod(Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC | Opcodes.ACC_SYNTHETIC, HELPER_OFFLINE, "()Z", null, null);
            m.visitCode();
            m.visitLdcInsn("1");
            m.visitLdcInsn("eternal.offline");
            m.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/System", "getProperty", "(Ljava/lang/String;)Ljava/lang/String;", false);
            m.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "equals", "(Ljava/lang/Object;)Z", false);
            m.visitInsn(Opcodes.IRETURN);
            m.visitMaxs(0, 0);
            m.visitEnd();
        }

        /** same shape as the helpers above, for another hook key */
        private void addHelper(String helper, String key) {
            MethodVisitor m = super.visitMethod(Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC | Opcodes.ACC_SYNTHETIC, helper, APPLY_DESC, null, null);
            Label start = new Label();
            Label end = new Label();
            Label handler = new Label();
            m.visitCode();
            m.visitTryCatchBlock(start, end, handler, "java/lang/Throwable");
            m.visitLabel(start);
            loadHook(m, key);
            m.visitVarInsn(Opcodes.ALOAD, 0);
            m.visitVarInsn(Opcodes.ALOAD, 1);
            m.visitMethodInsn(Opcodes.INVOKEINTERFACE, BIFUNCTION, "apply", APPLY_DESC, true);
            m.visitLabel(end);
            m.visitInsn(Opcodes.ARETURN);
            m.visitLabel(handler);
            m.visitFrame(Opcodes.F_NEW, 2, new Object[] {OBJ, OBJ}, 1, new Object[] {"java/lang/Throwable"});
            m.visitVarInsn(Opcodes.ASTORE, 2);
            m.visitVarInsn(Opcodes.ALOAD, 0);
            m.visitInsn(Opcodes.ARETURN);
            m.visitMaxs(0, 0);
            m.visitEnd();
        }

        /** private static Object eternal$name(Object result, Object source) { try { return hook.apply(result, source); } catch (Throwable t) { return result; } } */
        private void addNameHelper() {
            MethodVisitor m = super.visitMethod(Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC | Opcodes.ACC_SYNTHETIC, HELPER_NAME, APPLY_DESC, null, null);
            Label start = new Label();
            Label end = new Label();
            Label handler = new Label();
            m.visitCode();
            m.visitTryCatchBlock(start, end, handler, "java/lang/Throwable");
            m.visitLabel(start);
            loadHook(m, NAME_KEY);
            m.visitVarInsn(Opcodes.ALOAD, 0);
            m.visitVarInsn(Opcodes.ALOAD, 1);
            m.visitMethodInsn(Opcodes.INVOKEINTERFACE, BIFUNCTION, "apply", APPLY_DESC, true);
            m.visitLabel(end);
            m.visitInsn(Opcodes.ARETURN);
            m.visitLabel(handler);
            m.visitFrame(Opcodes.F_NEW, 2, new Object[] {OBJ, OBJ}, 1, new Object[] {"java/lang/Throwable"});
            m.visitVarInsn(Opcodes.ASTORE, 2);
            m.visitVarInsn(Opcodes.ALOAD, 0);
            m.visitInsn(Opcodes.ARETURN);
            m.visitMaxs(0, 0);
            m.visitEnd();
        }

        /** private static void eternal$tick(Object player) { try { hook.apply(player, null); } catch (Throwable t) { } } */
        private void addTickHelper(String helper, String key) {
            MethodVisitor m = super.visitMethod(Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC | Opcodes.ACC_SYNTHETIC, helper, "(Ljava/lang/Object;)V", null, null);
            Label start = new Label();
            Label end = new Label();
            Label handler = new Label();
            m.visitCode();
            m.visitTryCatchBlock(start, end, handler, "java/lang/Throwable");
            m.visitLabel(start);
            loadHook(m, key);
            m.visitVarInsn(Opcodes.ALOAD, 0);
            m.visitInsn(Opcodes.ACONST_NULL);
            m.visitMethodInsn(Opcodes.INVOKEINTERFACE, BIFUNCTION, "apply", APPLY_DESC, true);
            m.visitInsn(Opcodes.POP);
            m.visitLabel(end);
            m.visitInsn(Opcodes.RETURN);
            m.visitLabel(handler);
            m.visitFrame(Opcodes.F_NEW, 1, new Object[] {OBJ}, 1, new Object[] {"java/lang/Throwable"});
            m.visitVarInsn(Opcodes.ASTORE, 1);
            m.visitInsn(Opcodes.RETURN);
            m.visitMaxs(0, 0);
            m.visitEnd();
        }

        private void loadHook(MethodVisitor m, String key) {
            m.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/System", "getProperties", "()Ljava/util/Properties;", false);
            m.visitLdcInsn(key);
            m.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/Properties", "get", "(Ljava/lang/Object;)Ljava/lang/Object;", false);
            m.visitTypeInsn(Opcodes.CHECKCAST, BIFUNCTION);
        }
    }
}
