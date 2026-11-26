// Реакции 3D-персонажа (skinview3d): мелкие «занятия» в простое и реакции на тык мышью.
// Общий код для страницы «Skins» и главного экрана «Игровой». belly: false — без удара по животу.
import { useEffect, useRef } from 'react';
import {
  Box3, Raycaster, Vector2, Vector3,
} from 'three';
import { parseEmote, makeEmoteAnimation } from './emotes.js';

// Эмоции в формате Emotecraft (src/assets/emotes: руки за спиной, пожимает плечами, кивает, мотает головой, руки в стороны). Files
// подгружаются лениво, когда выпадает их очередь, и в основной бандл не входят.
const EMOTE_FILES = import.meta.glob('../assets/emotes/*.json');
const EMOTE_NAMES = ['hands-behind', 'shrug', 'yes', 'no', 'holding-hands'];
const emoteCache = new Map();
async function loadEmote(name) {
  if (emoteCache.has(name)) return emoteCache.get(name);
  const load = EMOTE_FILES[`../assets/emotes/${name}.json`];
  if (!load) return null;
  const parsed = parseEmote((await load()).default);
  emoteCache.set(name, parsed);
  return parsed;
}

// Every joint name the reaction/idle-fidget animations below touch — used to
// snapshot and to reset a pose (otherwise the model would freeze mid-pose
// when one animation ends or gets interrupted).
const REACTION_JOINTS = [
  ['body', 'x'], ['body', 'y'],
  ['head', 'x'], ['head', 'y'], ['head', 'z'],
  ['leftArm', 'x'], ['leftArm', 'z'],
  ['rightArm', 'x'], ['rightArm', 'z'],
  ['leftLeg', 'x'], ['rightLeg', 'x'],
];

function snapshotPose(player) {
  const pose = {};
  for (const [part, axis] of REACTION_JOINTS) pose[`${part}.${axis}`] = player.skin[part].rotation[axis];
  return pose;
}

function resetReactionPose(player) {
  for (const [part, axis] of REACTION_JOINTS) player.skin[part].rotation[axis] = 0;
}

const lerp = (a, b, t) => a + (b - a) * t;
// Smooth S-curve — zero velocity at both ends, used for every envelope below
// so motion eases in and out instead of moving at a constant/blunt rate.
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
// A hump that's 0 at t=0 and t=1 and eases smoothly through the middle —
// the base shape for "rise then return to rest" gestures.
const smoothHump = (t) => easeInOutSine(Math.sin(Math.PI * Math.min(Math.max(t, 0), 1)));

export function useSkinReactions(viewerRef, canvasRef, { belly = true } = {}) {
  const reactionIdRef = useRef(null);
  const fallingRef = useRef(false);
  const bodyClicksRef = useRef(0);
  const lastBodyClickRef = useRef(0);
  const headClicksRef = useRef(0);
  const lastHeadClickRef = useRef(0);
  const emoteRef = useRef(null); // the emote that is playing now ({ fn, id }), if any

    // An emote that is cut short (a poke, another reaction): the parts go back to where they were before it began.
    function cancelEmote() {
      const cur = emoteRef.current;
      emoteRef.current = null;
      const viewer = viewerRef.current;
      if (cur && viewer) cur.fn.cancel(viewer.playerObject);
    }

    // Plays one of the Emotecraft emotes once (a looping one goes round twice when it is short), then eases back to rest.
    async function playEmote(name) {
      const emote = await loadEmote(name).catch(() => null);
      const viewer = viewerRef.current;
      if (!emote || !viewer || reactionIdRef.current != null || fallingRef.current) return; // something else started while the file loaded
      const anim = viewer.animation;
      const fn = makeEmoteAnimation(emote, {
        loops: emote.loop && emote.seconds < 4 ? 2 : 1,
        onDone: () => {
          anim.removeAnimation(id);
          if (reactionIdRef.current === id) reactionIdRef.current = null;
          emoteRef.current = null;
        },
      });
      const id = anim.addAnimation(fn);
      reactionIdRef.current = id;
      emoteRef.current = { fn, id };
    }

    // Plays a short one-off pose layered on top of the idle animation, then
    // eases the joints back to rest. A new click blends smoothly out of
    // whatever reaction is currently playing instead of snapping to it —
    // the first `blendIn` seconds crossfade from the interrupted pose into
    // the new one.
    function playReaction(duration, poseFn, blendIn = 0.35) {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const anim = viewer.animation;
      cancelEmote();
      const startPose = snapshotPose(viewer.playerObject);
      if (reactionIdRef.current != null) anim.removeAnimation(reactionIdRef.current);

      const id = anim.addAnimation((player, progress) => {
        const t = Math.min(progress / duration, 1);
        poseFn(player, t);
        if (blendIn > 0 && progress < blendIn) {
          const b = easeInOutSine(progress / blendIn);
          for (const [part, axis] of REACTION_JOINTS) {
            const key = `${part}.${axis}`;
            player.skin[part].rotation[axis] = lerp(startPose[key], player.skin[part].rotation[axis], b);
          }
        }
        if (progress >= duration) {
          resetReactionPose(player);
          anim.removeAnimation(id);
          reactionIdRef.current = null;
        }
      });
      reactionIdRef.current = id;
    }

    // Poking the head rattles the whole character instead of a gentle pat —
    // the harder/more often it's poked in a row, the stronger the shake.
    function shakeHead(level = 1) {
      playReaction(0.75, (player, t) => {
        const decay = (1 - t) * (1 - t);
        const a = Math.sin(t * Math.PI * 9);
        const b = Math.sin(t * Math.PI * 11 + 1);
        player.skin.head.rotation.y = 0.32 * level * a * decay;
        player.skin.head.rotation.x = 0.14 * level * b * decay;
        player.skin.head.rotation.z = 0.12 * level * Math.sin(t * Math.PI * 7 + 2) * decay;
        player.skin.body.rotation.y = 0.07 * level * a * decay;
        player.skin.leftArm.rotation.x = 0.12 * level * b * decay;
        player.skin.rightArm.rotation.x = -0.12 * level * b * decay;
      }, 0.08);
    }

    // Tenth poke in a row: the head pops off, flies out of the frame spinning,
    // the headless body panics for a moment, then a new head pops back on.
    function headOff() {
      const viewer = viewerRef.current;
      if (!viewer || fallingRef.current) return;
      const anim = viewer.animation;
      const head = viewer.playerObject.skin.head;

      cancelEmote();
      if (reactionIdRef.current != null) {
        anim.removeAnimation(reactionIdRef.current);
        reactionIdRef.current = null;
      }
      resetReactionPose(viewer.playerObject);
      fallingRef.current = true;

      const pos0 = head.position.clone();
      const rot0 = head.rotation.clone();
      const scale0 = head.scale.clone();
      const dir = Math.random() < 0.5 ? 1 : -1;
      const TOTAL = 3.5;
      const easeOutBack = (t) => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
      };

      const id = anim.addAnimation((player, s) => {
        // Head: brief jolt up, then a spinning arc off to the side.
        if (s < 0.25) {
          head.position.set(pos0.x, pos0.y + 3 * Math.sin((Math.PI * s) / 0.25), pos0.z);
        } else if (s < 1.7) {
          const t = (s - 0.25) / 1.45;
          head.visible = true;
          head.position.set(pos0.x + dir * 90 * t, pos0.y + 34 * t - 30 * t * t + 6, pos0.z);
          head.rotation.z = rot0.z + dir * 14 * t;
          head.rotation.x = rot0.x + 5 * t;
        } else if (s < 2.5) {
          head.visible = false;
        } else {
          const t = Math.min((s - 2.5) / 0.7, 1);
          head.visible = true;
          head.position.copy(pos0);
          head.rotation.copy(rot0);
          head.scale.setScalar(Math.max(easeOutBack(t), 0.001));
        }

        // Body: arms flail up and the torso jitters while the head is gone.
        const env = smoothHump((s - 0.3) / 2.1);
        player.skin.leftArm.rotation.x = -1.8 * env + 0.5 * Math.sin(s * 22) * env;
        player.skin.rightArm.rotation.x = -1.8 * env - 0.5 * Math.sin(s * 22 + 1) * env;
        player.skin.leftArm.rotation.z = 0.4 * env;
        player.skin.rightArm.rotation.z = -0.4 * env;
        player.skin.body.rotation.y = 0.15 * Math.sin(s * 16) * env;

        if (s >= TOTAL) {
          head.visible = true;
          head.position.copy(pos0);
          head.rotation.copy(rot0);
          head.scale.copy(scale0);
          resetReactionPose(player);
          anim.removeAnimation(id);
          fallingRef.current = false;
        }
      });
    }

    function punchBelly() {
      playReaction(1.2, (player, t) => {
        const bend = smoothHump(t) * 0.35;
        player.skin.body.rotation.x = bend;
        player.skin.head.rotation.x = bend * 0.5;
        // arms clench inward around the stomach, holding near the peak a beat
        // longer than the bend itself before smoothly releasing
        const clutch = Math.pow(Math.sin(Math.PI * Math.min(Math.max(t, 0), 1)), 0.6);
        player.skin.leftArm.rotation.x = -1.0 * clutch;
        player.skin.leftArm.rotation.z = -0.7 * clutch;
        player.skin.rightArm.rotation.x = -1.0 * clutch;
        player.skin.rightArm.rotation.z = 0.7 * clutch;
      });
    }

    // Periodic idle fidgets — every ~4-8s (when nothing else is playing) the
    // character absent-mindedly checks themselves over: one arm, one leg,
    // brushing dust off their clothes, looking around, or waving.
    function examineArm() {
      const left = Math.random() < 0.5;
      const arm = left ? 'leftArm' : 'rightArm';
      const sign = left ? -1 : 1;
      playReaction(2.6, (player, t) => {
        const ease = smoothHump(t);
        player.skin[arm].rotation.x = -1.3 * ease;
        player.skin[arm].rotation.z = sign * 0.25 * ease;
        player.skin.head.rotation.x = 0.35 * ease;
        player.skin.head.rotation.y = -sign * 0.3 * ease;
      });
    }

    function examineLeg() {
      const left = Math.random() < 0.5;
      const leg = left ? 'leftLeg' : 'rightLeg';
      playReaction(2.6, (player, t) => {
        const ease = smoothHump(t);
        player.skin.body.rotation.x = 0.22 * ease;
        player.skin.head.rotation.x = 0.55 * ease;
        player.skin[leg].rotation.x = -0.3 * ease;
      });
    }

    function dustOff() {
      playReaction(2.0, (player, t) => {
        const lift = smoothHump(t);
        const stroke = Math.sin(Math.min(t * 1.3, 1) * Math.PI * 2) * 0.5 + 0.5;
        player.skin.leftArm.rotation.x = -(0.9 + 0.35 * stroke) * lift;
        player.skin.rightArm.rotation.x = -(0.9 + 0.35 * stroke) * lift;
        player.skin.leftArm.rotation.z = -0.35 * lift;
        player.skin.rightArm.rotation.z = 0.35 * lift;
        player.skin.head.rotation.x = 0.2 * lift;
      });
    }

    function lookAround() {
      const dir = Math.random() < 0.5 ? 1 : -1;
      playReaction(2.4, (player, t) => {
        const env = smoothHump(t);
        player.skin.head.rotation.y = dir * 0.8 * Math.sin(Math.min(t * 1.2, 1) * Math.PI * 2) * env;
        player.skin.head.rotation.x = -0.08 * env;
      });
    }

    function wave() {
      playReaction(2.2, (player, t) => {
        const raise = smoothHump(t);
        player.skin.rightArm.rotation.x = -2.6 * raise;
        player.skin.rightArm.rotation.z = (-0.3 + 0.35 * Math.sin(Math.min(t * 1.15, 1) * Math.PI * 6)) * raise;
        player.skin.head.rotation.y = -0.15 * raise;
      });
    }

    // Poked three times in a row: the character loses their balance, falls onto
    // their side, lies there a moment, then gets back up and shakes it off.
    // Rotates the whole model around its own center (so it stays inside the
    // canvas while lying down) and lowers it so it lands on the same "floor"
    // it was standing on.
    function fallDown() {
      const viewer = viewerRef.current;
      if (!viewer || fallingRef.current) return;
      const anim = viewer.animation;
      const root = viewer.playerObject;

      cancelEmote();
      if (reactionIdRef.current != null) {
        anim.removeAnimation(reactionIdRef.current);
        reactionIdRef.current = null;
      }
      resetReactionPose(root);
      fallingRef.current = true;

      const pos0 = root.position.clone();
      const box = new Box3().setFromObject(root);
      const height = box.max.y - box.min.y;
      const halfWidth = 6; // half of the model's side-on thickness when lying down
      const center = new Vector3(pos0.x, (box.max.y + box.min.y) / 2, pos0.z);
      const zAxis = new Vector3(0, 0, 1);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const TOTAL = 4.6;

      // Body tilt in degrees over time (before choosing a side).
      const tiltAt = (s) => {
        if (s < 0.7) return 6 * Math.sin(s * 14) * Math.sin((Math.PI * s) / 0.7); // wobbling
        if (s < 1.2) { const t = (s - 0.7) / 0.5; return 90 * t * t; } // toppling, speeding up
        if (s < 1.45) return 90 - 5 * Math.sin((Math.PI * (s - 1.2)) / 0.25); // small bounce
        if (s < 2.7) return 90 + 0.8 * Math.sin((s - 1.45) * 5); // lying
        if (s < 4.1) return 90 * (1 - easeInOutSine((s - 2.7) / 1.4)); // getting up
        return 0;
      };
      const armsOutAt = (s) => {
        if (s < 0.7) return 0;
        if (s < 1.2) return easeInOutSine((s - 0.7) / 0.5);
        if (s < 2.7) return 1;
        if (s < 4.0) return 1 - easeInOutSine((s - 2.7) / 1.3);
        return 0;
      };

      const id = anim.addAnimation((player, progress) => {
        const s = progress;
        const th = (tiltAt(s) * dir * Math.PI) / 180;

        player.rotation.z = th;
        const p = center.clone().add(pos0.clone().sub(center).applyAxisAngle(zAxis, th));
        const extent = Math.abs(Math.cos(th)) * (height / 2) + Math.abs(Math.sin(th)) * halfWidth;
        p.y -= height / 2 - extent;
        player.position.copy(p);

        // Limbs: flailing while losing balance, spread out on the ground,
        // pushing off while getting up, then a head shake at the end.
        const flail = s < 0.7 ? Math.sin(Math.PI * (s / 0.7)) : 0;
        const armsOut = armsOutAt(s);
        const push = s > 2.7 && s < 4.0 ? Math.sin(Math.PI * ((s - 2.7) / 1.3)) : 0;
        player.skin.leftArm.rotation.x = Math.sin(s * 20) * 1.3 * flail - 0.9 * push;
        player.skin.rightArm.rotation.x = -Math.sin(s * 20) * 1.3 * flail - 0.9 * push;
        player.skin.leftArm.rotation.z = 0.9 * armsOut + 0.5 * flail;
        player.skin.rightArm.rotation.z = -0.9 * armsOut - 0.5 * flail;
        player.skin.leftLeg.rotation.x = 0.35 * push;
        player.skin.rightLeg.rotation.x = -0.35 * push;
        player.skin.head.rotation.y = s > 4.1 ? 0.45 * Math.sin((s - 4.1) * 22) * (1 - (s - 4.1) / 0.5) : 0;

        if (progress >= TOTAL) {
          player.rotation.z = 0;
          player.position.copy(pos0);
          resetReactionPose(player);
          anim.removeAnimation(id);
          fallingRef.current = false;
        }
      });
    }

    function handleViewerClick(e) {
      const viewer = viewerRef.current;
      const canvas = canvasRef.current;
      if (!viewer || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouse = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new Raycaster();
      raycaster.setFromCamera(mouse, viewer.camera);
      if (fallingRef.current) return;
      if (!raycaster.intersectObject(viewer.playerObject, true).length) return;

      const now = performance.now();
      const skin = viewer.playerObject.skin;

      // Head: rattles the character; ten pokes in a row (each within 2.5s of
      // the previous) and the head comes off.
      if (raycaster.intersectObject(skin.head, true).length) {
        const streak = now - lastHeadClickRef.current > 2500 ? 1 : headClicksRef.current + 1;
        lastHeadClickRef.current = now;
        if (streak >= 10) {
          headClicksRef.current = 0;
          headOff();
          return;
        }
        headClicksRef.current = streak;
        shakeHead(0.7 + streak * 0.12);
        return;
      }

      // Anything else: fifteen pokes in a row (each within 2.5s of the
      // previous) and the character topples over; the earlier ones get the
      // usual belly-punch reaction.
      const bodyStreak = now - lastBodyClickRef.current > 2500 ? 1 : bodyClicksRef.current + 1;
      lastBodyClickRef.current = now;
      if (bodyStreak >= 15) {
        bodyClicksRef.current = 0;
        fallDown();
        return;
      }
      bodyClicksRef.current = bodyStreak;
      if (belly && raycaster.intersectObject(skin.body, true).length) punchBelly();
    }

    useEffect(() => {
      let timeoutId;
      const fidgets = [examineArm, examineLeg, dustOff, lookAround, wave, ...EMOTE_NAMES.map((n) => () => playEmote(n))];
      let last = -1;
      function scheduleNext(first = false) {
        // First one shortly after opening the page, then every ~4-8s.
        const delay = first ? 2000 : 4000 + Math.random() * 4000;
        timeoutId = setTimeout(() => {
          if (reactionIdRef.current == null && !fallingRef.current) {
            // Never the same fidget twice in a row.
            let idx;
            do { idx = Math.floor(Math.random() * fidgets.length); } while (idx === last);
            last = idx;
            fidgets[idx]();
          }
          scheduleNext();
        }, delay);
      }
      scheduleNext(true);
      return () => { clearTimeout(timeoutId); cancelEmote(); };
    }, []);

  return { handleViewerClick };
}