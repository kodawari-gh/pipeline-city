// The 3D world's mount (docs/GRAPHICS_3D_OVERHAUL.md): behind the flag (`VITE_3D_GRAPHICS=1` or `?3d` in the address, `app/main.tsx`) it replaces the
// Pixi board. It builds the room and the machine from the snapshot, drives the orbit camera, picks with rays and writes the same hover / selected
// signals as the 2D renderer, so the HUD's tooltips and cards work unchanged. The dies run as in 2D (`Chips3D`). Parts, cables and keys drag (`drag3d.ts`).
// The die's blocks hover and click (`Chips3D.hitAt`), the lenses lie over the view (`Lens3D`, keys P and A). The room's materials take its probe
// at every height (`RoomEnv`), and so does the machine: it reads at night by the room's lamps alone, at every zoom (`src/features/room/light.md`).
import { effect } from '@preact/signals';
import { Box3, Vector3, type Object3D, type WebGLCubeRenderTarget } from 'three';
import { snapshot, speed, powerButton, plugKey, ejectKey, zoomSlowOn, zoomSlowdown } from '@/app/store';
import { worldPace, zoomSlow } from '@/core/render/lod/lod';
import { CYCLES_PER_SEC } from '@/features/cpu/render/die/diemotion';
import { airflowLens, hover, powerLens, selected, viewInset, INERT_REGIONS } from '@/app/hover';
import { cameraRev, highlight } from '@/app/interaction';
import type { FlyOpts } from '@/core/render/camera';
import { setWorldAnchors, type Anchor } from '../board';
import { deviceOfPart } from '@/core/render/interact';
import { readTheme, onThemeChange } from '@/core/render/theme';
import { autoStep, awayHeld, effective, FrameGate, FrameMeter, graphics, loopLimit, nextStep, SlowWatch, stepTier, TierWatch, tierRecord, type Graphics, watchFps } from '@/app/graphics';
import { BASE_EXPOSURE, createRenderContext } from '@/core/render/three/init';
import {
  applyView, clampTilt, clampView, distanceOf, fitRect, heightAt, keepInside, nearness, orbitBy, panBy, retarget, settled, stepView, tiltRange, zoomAt, zoomOn, type Box, type OrbitView, type Room,
} from '@/core/render/three/camera';
import { DrawGate, STILL_PX, ViewWatch } from '@/core/render/three/ondemand';
import { NO_PULL, holdOn, keeps, over, pullOn, railUnder, type Pull, type Rail } from '@/core/render/three/rails';
import { anisotropy, disposeTree, refilter } from '@/core/render/three/geometry';
import { ShadowCache } from '@/core/render/three/shadows';
import { findById, idOf, ownerOf, pick, pickPoint } from '@/core/render/three/pick';
import { HIGH_C, MID } from '@/core/render/three/localeye';
import { Post, roomness } from '@/core/render/three/post';
import { Probe } from '@/core/render/three/probe';
import { linked, startPrograms, type Program } from '@/core/render/three/compile';
import { bootDone, bootStage, saveStill } from '@/app/boot';
import { PROBE_K, Room3D, prepareCity, preloadRoomBake } from '@/features/room/render/three/room3d';
import { BOARD_Z, CASE_D, CASE_Z, DESK_TOP, START_HOUR_3D, VIEW_TOP, WINDOW, daylight, eyeBlocks, eyeRoom } from '@/features/room/render/three/roomplan';
import { DAY_S, START_HOUR, hourAt, roomClick, roomDebug, roomState } from '@/features/room/render/shell/room';
import { CASE, CASE_IN, DIE, LAYOUT_CASE, LAYOUT_TIER, ROUTER_SPOT, TRAY, setLayoutTier } from '../layout/layout';
import { Chips3D, LIVE_LEVELS } from './chips3d';
import { Machine3D, machineKey } from './machine3d';
import { RAM_LEAN } from './ram3d';
import { BakeQueue } from '@/core/render/three/artlod';
import { cardOrigin } from '@/core/render/accelart';
import { gpuPlan, moveRect } from '@/features/gpu/render/gpulayout';
import { getSpec } from '@/features/board/sim/specs';
import { startBaker } from './bake';
import { Drag3D, deviceOf } from './drag3d';
import { PlugHand } from './plughand3d';
import { Lens3D } from './lens3d';
import { BoardLive3D } from './boardlive3d';
import { Cues3D } from './cues3d';
import { Particles3D } from './particles3d';
import { setPartDragHandler } from '@/core/ui/worldDrag';
import { buildOpen, galleryOpen } from '@/core/ui/state';
import type { DeviceSnap } from '@/worker/game/types';

const ROOM_ANGLE = { yaw: 0, pitch: 0.09, fov: 26 };
const FLAT = { yaw: 0, pitch: 0, fov: 14 };
/**
 * The overview's target depth (in the case, in front of the board). The room's look reads how near the eye is by the height a view shows there
 * (`roomness`), whatever its target: the target follows the surface the player zooms to, and the look must not change with it.
 */
const LOOK_Z = 5000;
/** A target may lie this far back (behind the back wall: the view out of the window). */
const TARGET_Z0 = -3000;
/** The machine's ids that are reached from outside the case (a tutorial target among them leaves the side panel shut). */
const OUTSIDE = new Set(['case', 'case.side', 'power', 'usb', 'io', 'cable.video', 'cable.lan', 'cable.pcmains', 'cable.monmains']);
/** The art's density at each level of the graphics settings, as a share of what the screen needs (`ArtSurface.update`); level 2 is the tuned look. */
const TEXTURE_LEVELS = [0.5, 0.75, 1, 1.5];
/** The share of the particles at each level of the graphics settings. */
const PARTICLE_LEVELS = [0, 0.5, 1];
/** The room's probe is captured again at most this often (ms) while its light changes (the sun moves a step every few seconds). */
const PROBE_MS = 1500;
/**
 * The eye adapts, as a camera's exposure does (`src/features/room/light.md`); the light itself does not change. In the room's views the
 * exposure is set: by night `NIGHT_EYE` times the day's (the room has only its lamps). From the board view in it is metered (`Post.meter`):
 * the exposure that shows the scene's mean luminance at `EYE_KEY`, within `EYE_RANGE` of the base. The case's dark inside, lit by the room's
 * lamps alone, then reads, and a die's bright art does not burn out.
 */
const NIGHT_EYE = 1.4, EYE_KEY = 0.04, EYE_RANGE = [0.3, 14] as const;
/**
 * The local eye's key in the room's views (`LocalEye.key`; it fades out toward the board view, `Post.setReach`): the light it adapts each part
 * of the picture toward. By day middle grey (`MID`): the walls by the bright glass read. At night lower: the room stays low-key, its pools of
 * lamp light and the dark between them. At night it also keeps more of the bright (`LocalEye.high`): the pools stand out (a wall in one
 * reads L .05 or more, `light.md` "Targets"), where by day it holds back the glass.
 */
const NIGHT_KEY = 0.03, NIGHT_HIGH = 0.8;
/** Before a game (the title over the live room): the overview turns this far (rad) each side of its own, slowly, round its target, once in `MENU_S` × 2π s. */
const MENU_SWAY = 0.07, MENU_S = 9;
/** The boot screen goes at the latest this long (ms) after the programs have linked, if the room's light has not settled by then. */
const REVEAL_MS = 4000;
/** An anchor smaller than this on screen (px) is not comfortably visible: a plug that small is hard to grab. */
const MIN_TARGET_PX = 10;

/** After the page's next paint: the boot screen shows its stage before the work that holds the page. */
const nextPaint = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));

/**
 * Mounts the 3D world behind the boot screen (docs/render/load.md): it builds the room and the machine, waits for the room's light bake, links
 * every program on the driver's threads while the page still draws, lets the room's light settle, then ends the boot screen.
 */
export async function mountBoard3d(host: HTMLElement): Promise<void> {
  bootStage('Starting the renderer', 0.1);
  preloadRoomBake();
  await nextPaint();
  let T = readTheme();
  const ctx = createRenderContext(host, T.bg);
  const { scene, camera, renderer, canvas } = ctx;
  let W = host.clientWidth, H = Math.max(1, host.clientHeight);
  const post = new Post(renderer, scene, camera, W, H);
  // the shadow maps: a still picture per light, and only what moves drawn again (shadows.ts)
  const shadows = new ShadowCache(renderer);
  // the 2D art baked into textures for the 3D faces (machine3d.ts, bake.ts)
  const bakes = new BakeQueue();
  startBaker();
  // the title's room is drawn on demand (docs/render/load.md "Draw on demand"): a frame when its picture changes, none while it stands
  const demand = new DrawGate(), shift = new ViewWatch();
  // the studio's light: the scene's only until the room's probe is ready (the first frames)
  const studio = scene.environment!;
  // the room's own light, the window's and the lamps' as they bounce off its walls (probe.ts): captured again when that light changes, and
  // a few times over for a new room, as each capture holds the bounce of the one before; prefiltered, it is the scene's light at every zoom
  const probe = new Probe(200, 400000), { pmrem } = ctx;
  let roomEnv: WebGLCubeRenderTarget | null = null;
  let probeKey = '', probeAt = -Infinity, bounces = 0, probed = false;
  // the metered eye: the meter's last reading, the exposure's factor it asks for, and where the eye stands on its way to it
  let reading = 0, metered = 1, seen = 1;

  // the dies alive: the 2D die views, kept across rebuilds (chips3d.ts)
  const chips = new Chips3D();
  const lens = new Lens3D(scene);
  const boardLive = new BoardLive3D(scene);
  const fx = new Particles3D(scene);
  let room: Room3D | null = null, machine: Machine3D | null = null;
  let roomKey = '', machKey = '';
  /** A new machine whose programs still link (`compile.ts`): the old one shows meanwhile, and the frame swaps them once they have linked. */
  let next: { m: Machine3D; programs: Program[] } | null = null;
  /**
   * The programs of a new picture (the first, a new room, new graphics settings), started on its first frame (`warmed`): until they have
   * linked the frame draws nothing, and the canvas keeps its last picture.
   */
  let linking: Program[] | null = null, warmed = false;
  /** The furniture the eye keeps out of (`eyeBlocks`), for the room as built. */
  let blocks: Room[] = [];
  /** Dev only (`__board.previewCase`): show this board and case tier, empty, whatever the game holds. */
  let preview: { board: number; case: number } | null = null;
  /** The rail that holds the view (`rails.ts`) and how far a pan pulls past its part's edge; the rail the player last pulled off (it does not take the view again until the view leaves its part). */
  let rail: { r: Rail; pull: Pull } | null = null, skip: string | null = null;
  /** Puts `m` in the scene in the machine's place. */
  const install = (m: Machine3D) => {
    if (machine) { scene.remove(machine.root); machine.dispose(); }
    machine = m;
    scene.add(m.root);
    demand.ask();
    // the rail that holds the view stays if its part is still there
    const held = rail && m.rails.find((x) => x.id === rail!.r.id);
    rail = held ? { r: held, pull: NO_PULL } : null;
  };
  const rebuild = () => {
    const live = snapshot.peek();
    const s = preview && live ? { ...live, boardTier: preview.board, caseTier: preview.case, devices: [], cables: [], plugged: null } : live;
    const tier = s?.boardTier ?? 0, caseTier = Math.max(tier, s?.caseTier ?? tier);
    const rk = `${tier}|${caseTier}`;
    if (rk !== roomKey || !room) {
      roomKey = rk;
      setLayoutTier(tier, caseTier);
      if (room) { scene.remove(room.root); room.dispose(); disposeTree(room.root); }
      room = new Room3D(studio);
      blocks = eyeBlocks(room.geo);
      probe.at(...room.probeAt);
      bounces = 3; probed = false;
      room.setShadows(effective.peek().shadows);
      room.setLights(effective.peek().lights, effective.peek().lightShadows > 0);
      shadows.reset();
      scene.add(room.root);
      machKey = '';
      // (the frame links the new room's programs before it draws it)
      warmed = false;
    }
    const mk = machineKey(s);
    if (mk !== machKey || !machine) {
      machKey = mk;
      // a machine that still links is out of date
      next?.m.dispose();
      next = null;
      const m = new Machine3D(s, room.geo, bakes, chips);
      if (!machine || !warmed) install(m);
      else {
        // its programs link while the old machine shows (hidden meanwhile, the old one's lights do not count twice)
        machine.root.visible = false;
        const programs = startPrograms(renderer, m.root, camera, { scene, fades: m.fades });
        machine.root.visible = true;
        if (linked(programs)) install(m); else next = { m, programs };
      }
    } else if (s) (next?.m ?? machine).syncCables(s, room.geo); // a plug in or out: only its cable hangs again

    chips.update(s);
    room.setKeys(s?.tray ?? []);
    demand.ask(); // (a save loaded, a part fitted, a plug in or out)
  };
  // the city in the window first: its programs link on the driver's threads while the room is built (no paint between: it would wait for them)
  bootStage('Building the world', 0.14);
  await nextPaint();
  prepareCity(renderer, effective.peek().shadows);
  rebuild();

  // ---- camera ----
  const aspect = () => W / H;
  // the reference's framing: front on, a little from above, from the glass west of the desk to the drawers, from the old window head to the desk's drawers
  const roomRect = (): Box => {
    const g = room!.geo, x0 = Math.max(WINDOW.x, g.desk.x0 - 12500) - 1200, y0 = Math.min(TRAY.y, ROUTER_SPOT.y, g.clock.y, VIEW_TOP) - 1200;
    return { x: x0, y: y0, w: Math.max(g.desk.x1, CASE.x + CASE.w) + 1200 - x0, h: g.ys + 7000 - y0 };
  };
  /**
   * A view with its eye in the room (the walls hide all outside it) and out of the furniture: a goal may narrow its fov back (`restore`), the
   * eased view only widens.
   */
  const inRoom = (v: OrbitView, restore = true): OrbitView => keepInside(v, eyeRoom(), { targetZ0: TARGET_Z0, fovBase: ROOM_ANGLE.fov, restore, blocks });
  /** A pan that would push the eye through a wall or into the furniture slides along it (one axis), or stops. */
  const panIn = (v: OrbitView, dx: number, dy: number): OrbitView => {
    for (const [a, b] of [[dx, dy], [dx, 0], [0, dy]] as const) {
      const p = panBy(v, a, b), k = inRoom(p);
      if (Math.abs(k.height - p.height) < 1 && Math.hypot(k.x - p.x, k.y - p.y, k.z - p.z) < 1) return k;
    }
    return v;
  };
  /** `fitRect` for the part of the screen the HUD leaves free (`viewInset`): the rect centres in it, and fills it by the margin. */
  const inFree = (r: Box, z: number, from: Pick<OrbitView, 'yaw' | 'pitch' | 'fov'>, margin: number): OrbitView => {
    const i = viewInset.peek(), fw = Math.max(50, W - i.left - i.right), fh = Math.max(50, H - i.top - i.bottom);
    const v = fitRect(r, z, fw / fh, from, margin), height = (v.height * H) / fh, k = height / H;
    return panBy({ ...v, height }, (-(i.left - i.right) / 2) * k, ((i.top - i.bottom) / 2) * k);
  };
  const overview = (): OrbitView => inRoom(inFree(roomRect(), LOOK_Z, ROOM_ANGLE, 0.9));
  /** Before a game (the title over the live room): the overview, turning slowly a little way each side round its target. */
  const sway = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : MENU_SWAY;
  const menuView = (t: number): OrbitView => { const o = overview(); return inRoom({ ...o, yaw: o.yaw + sway * Math.sin(t / MENU_S) }); };
  const boardView = (): OrbitView => inFree(CASE_IN, BOARD_Z, FLAT, 0.95);
  // close enough that the cooler and the lid have faded (`DEVICE_LOD.die.fade`) and the die's names read
  const cpuView = (): OrbitView => inFree(DIE, BOARD_Z + 200, FLAT, 0.95);
  /** The title shows (no game yet): the view turns over the room (`menuView`); the game's start flies it to the overview. */
  let menu = !snapshot.peek();
  canvas.style.pointerEvents = menu ? 'none' : ''; // (the main menu's room is a picture: no hover, no click, no zoom)
  let view = menu ? menuView(performance.now() / 1000) : overview(), goal = view;
  /** How far into the case a view is (`nearness`), by the height it shows on the board's plane: 0 from twice the board view's out, 1 from the board view in. */
  const inCase = (v: OrbitView): number => { const b = boardView().height; return nearness(heightAt(v, BOARD_Z), b, 2 * b); };
  /** The angles the goal may take now: none past head on on a rail, else by `inCase`; `held`: while the player turns it. */
  const tilt = (v: OrbitView, held: boolean) => clampTilt(v, tiltRange(rail ? 1 : inCase(v), held));
  /**
   * After the player moves the goal (a zoom, the end of a pan or a turn, a key): a rail lets go as the zoom falls past it, a part with a detailed
   * view under the centre takes the goal onto its rail (`rails.ts`), and in the case the goal turns back toward head on.
   */
  const settle = () => {
    const rails = machine?.rails ?? [], a = aspect();
    if (rail && !keeps(goal, rail.r, H, a)) rail = null;
    const was = skip && rails.find((x) => x.id === skip);
    if (!was || !over(goal, was) || !keeps(goal, was, H, a)) skip = null;
    const r = rail?.r ?? railUnder(goal, rails, H, a, skip);
    // (a pull past the edge springs back)
    rail = r ? { r, pull: NO_PULL } : null;
    goal = tilt(goal, false);
    if (r) {
      goal = holdOn(goal, r, a);
      // (the same picture with its target on the part: the view eases onto the goal without a wobble)
      view = retarget(view, r.z);
    }
    goal = inRoom(goal);
  };
  /** The flight the tutorial asked for (`flyToId`): told whether the view arrived, or was cut short by the player or another flight. */
  let pending: ((arrived: boolean) => void) | null = null;
  const cancelFlight = () => { const p = pending; pending = null; p?.(false); };
  /** The view is the overview the player has not moved off: it fits itself again when the HUD's inset changes. */
  let atOverview = false;
  const flyTo = (v: OrbitView) => { cancelFlight(); atOverview = false; goal = inRoom(clampView(v)); settle(); };
  /** Dev only (the shot tool): show this view at once, as it is (no rail takes it, its angles stay until the player moves it). */
  const jump = (v: OrbitView) => { view = goal = inRoom(v); rail = null; };
  const flyToRoom = () => { flyTo(overview()); atOverview = true; };
  const flyToBoard = () => flyTo(boardView());
  const flyToCpu = () => flyTo(cpuView());
  /** The first graphics card's die, framed close enough that the shroud has faded (`DEVICE_LOD.gpu.fade`) and the blocks read. */
  const flyToGpu = () => {
    const d = snapshot.peek()?.devices.find((x) => x.kind === 'gpu');
    const visual = d ? (getSpec(d.spec) as { visual?: string } | undefined)?.visual : undefined;
    if (!d || !visual) return;
    const b = moveRect(gpuPlan(visual).body, cardOrigin(Number(/\d+$/.exec(d.slot)?.[0] ?? 0), visual));
    // a long card's die is a row of SMs: frame its height, at its first third
    const h = b.h + 160, w = Math.min(b.w + 160, h * aspect());
    flyTo(fitRect({ x: b.x - 80, y: b.y - 80, w, h }, BOARD_Z + 300, aspect(), FLAT, 0.95));
  };

  // ---- pointer: drag pans, right drag (or shift) orbits, the wheel zooms at the pointer, a click picks ----
  const ndc = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { nx: ((e.clientX - r.left) / r.width) * 2 - 1, ny: -(((e.clientY - r.top) / r.height) * 2 - 1) };
  };
  const roots = (): Object3D[] => {
    const out: Object3D[] = [];
    if (room) out.push(room.root);
    if (machine) out.push(machine.root);
    return out;
  };
  /** The surface under a client point (world), if a target may lie there (not on a wall or the floor, not out of the window): a zoom and a pan go at its depth. */
  const anchor = (e: { clientX: number; clientY: number }) => {
    const { nx, ny } = ndc(e), p = pickPoint(roots(), camera, nx, ny), r = eyeRoom();
    return p && p.z >= TARGET_Z0 && p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1 ? p : null;
  };
  /** The id under a client point; `raw`: the backdrops too (the board, the case), which hover nothing but take a dropped plug. */
  const idAt = (e: { clientX: number; clientY: number }, raw = false, grab = false): string | null => {
    const { nx, ny } = ndc(e), id = chips.hitAt(camera, H, nx, ny) ?? idOf(pick(roots(), camera, nx, ny));
    // a loose plug is small and lies among parts: one within a thumb's reach of the pointer is the one meant (not for a drop's raw id)
    // on a cable hit the nearest seat still wins: fan headers lie 11 px apart, the ray may hit the neighbour
    if (grab && !raw) { const p = looseNear(e.clientX, e.clientY, id?.startsWith('cable.') ? SEATED_PX : GRAB_PX); if (p) return p; }
    return id && (raw || !INERT_REGIONS.has(id)) ? id : null;
  };
  /** The loose plugs' screen centres, measured again after a moment (they fall and the camera moves). */
  let plugs = { at: -Infinity, key: '', list: [] as { id: string; x: number; y: number; reach?: number }[] };
  const GRAB_PX = 22, SEATED_PX = 12;
  const looseNear = (x: number, y: number, maxPx = GRAB_PX): string | null => {
    const now = performance.now();
    if (now - plugs.at > 120 || plugs.key !== revKey) {
      const loose = (snapshot.peek()?.cables ?? []).filter((c) => !c.connected);
      plugs = { at: now, key: revKey, list: loose.flatMap((c) => { const a = anchorsOf('cable.' + c.id)[0]; return a ? [{ id: 'cable.' + c.id, x: a.x + a.w / 2, y: a.y + a.h / 2 }] : []; }) };
      // a seated plug is as small (a fan's header plug is a few pixels): its seat is a handle too, a shorter reach
      const r = canvas.getBoundingClientRect();
      for (const c of (snapshot.peek()?.cables ?? []).filter((c) => c.connected)) {
        const rig = machine?.rig(c.id);
        if (!rig) continue;
        const q = new Vector3(...rig.seat.at).project(camera);
        if (q.z < 1 && Math.abs(q.x) < 1 && Math.abs(q.y) < 1) plugs.list.push({ id: 'cable.' + c.id, x: r.left + ((q.x + 1) / 2) * r.width, y: r.top + ((1 - q.y) / 2) * r.height, reach: SEATED_PX });
      }
    }
    let best: string | null = null, d = maxPx;
    for (const p of plugs.list) { const k = Math.hypot(p.x - x, p.y - y); if (k <= Math.min(d, p.reach ?? GRAB_PX)) { d = k; best = p.id; } }
    return best;
  };
  // a cable's plug held in the scene (plughand3d.ts), and the parts dragged in from the inventory or lifted off the board (drag3d.ts)
  const hand = new PlugHand({ machine: () => machine, snapshot: () => snapshot.peek(), toast: (t, x, y) => lift.toast(t, x, y) }, canvas);
  scene.add(hand.root);
  const lift = new Drag3D((cx, cy, raw) => idAt({ clientX: cx, clientY: cy }, raw), canvas, (id) => !!machine && (!!findById(machine.root, id) || (id.includes('.') && !id.startsWith('cable.'))), hand, (cx, cy) => { const a = anchorsOf('usb')[0]; return !!a && Math.hypot(cx - (a.x + a.w / 2), cy - (a.y + a.h / 2)) <= Math.max(36, Math.max(a.w, a.h) / 2 + 16); }, (id) => anchorsOf(id)[0] ?? null); // (a die's block is `cpu.fetch`: not an object of its own)
  setPartDragHandler((invId, e) => lift.beginPart(invId, e));
  /** A press: where, how far it has moved, whether it turns; the part, cable or key it lifts; for a pan, the depth of the surface it grabbed. */
  let drag: { x: number; y: number; moved: number; orbit: boolean; dev?: DeviceSnap; grab?: string; depth?: number } | null = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // touch: the browser leaves the canvas its fingers (no scroll, no page zoom); two fingers pinch (a zoom toward their middle, below)
  canvas.style.touchAction = 'none';
  const fingers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number } | null = null;
  const span = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1; };
  const mid = () => { const [a, b] = [...fingers.values()]; return { clientX: (a!.x + b!.x) / 2, clientY: (a!.y + b!.y) / 2 }; };
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a pointer that is already gone (a synthetic one in a test) */ }
    cancelFlight();
    atOverview = false;
    if (e.pointerType === 'touch') {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2) { drag = null; pinch = { d: span() }; return; }
    }
    const orbit = e.button === 2 || e.shiftKey, id = !orbit && e.button === 0 ? idAt(e, false, true) : null;
    // a press on an installed part, a cable or a key lifts it once the pointer moves; on anything else it pans
    // a plug seated in its socket is the socket to the ray: pulling on the socket pulls its cable
    const seated = id === 'atx' ? 'atx' : id === 'cpw' ? 'cpu' : null, plugged = seated && snapshot.peek()?.cables.some((c) => c.id === seated && c.connected);
    // (on a rail the view reads a part up close: a press on a part pans over it, and the parts lift from further out)
    const grab = id && (id.startsWith('cable.') || id.startsWith('key:')) ? id : plugged ? 'cable.' + seated : undefined, dev = id && !grab && !rail ? deviceOf(id, snapshot.peek()) : null;
    const at = !orbit && !dev && !grab ? anchor(e) : null;
    drag = { x: e.clientX, y: e.clientY, moved: 0, orbit, ...(dev ? { dev } : {}), ...(grab ? { grab } : {}), ...(at ? { depth: at.z } : {}) };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (lift.busy) return;
    if (fingers.has(e.pointerId)) {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && fingers.size === 2) {
        const d = span();
        zoomToward(mid(), pinch.d / d);
        pinch.d = d;
        return;
      }
    }
    if (drag) {
      // a press on an installed part that moves lifts the part instead of panning
      if (drag.dev || drag.grab) {
        const far = Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6;
        if (far) {
          const { dev, grab } = drag;
          drag = null;
          canvas.releasePointerCapture(e.pointerId);
          if (dev) lift.beginDevice(dev, e);
          else if (grab!.startsWith('key:')) lift.beginKey(Number(grab!.slice(4)), e);
          else lift.beginCable(grab!.slice(6), e);
        }
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      // in the case a turn goes only a little way from head on (`tilt`; let go, it eases back)
      if (drag.orbit) goal = inRoom(tilt({ ...goal, yaw: goal.yaw - dx * 0.004, pitch: goal.pitch + dy * 0.004 }, true));
      else {
        // the grabbed surface follows the pointer: the pan goes at its depth
        const k = (drag.depth === undefined ? view.height : heightAt(view, drag.depth)) / H, was = goal;
        if (rail) {
          // on a rail the view keeps to the part; a pull past its edge gives, then lets go
          const p = pullOn(goal, rail.r, aspect(), rail.pull, -dx * k, dy * k);
          if (p.free) { skip = rail.r.id; rail = null; } else rail.pull = p.pull;
          goal = inRoom(p.view);
        } else goal = panIn(goal, -dx * k, dy * k);
        view = { ...view, x: view.x + goal.x - was.x, y: view.y + goal.y - was.y, z: view.z + goal.z - was.z };
        // a part with a detailed view that comes under the centre takes the view onto its rail
        if (!rail) settle();
      }
      return;
    }
    const id = idAt(e, false, true);
    hover.value = id ? { id, x: e.clientX, y: e.clientY } : null;
    canvas.style.cursor = id ? (id.startsWith('cable.') || id.startsWith('key:') ? 'grab' : 'pointer') : '';
  });
  const lift_ = (e: PointerEvent) => { fingers.delete(e.pointerId); if (fingers.size < 2) pinch = null; };
  canvas.addEventListener('pointercancel', lift_);
  canvas.addEventListener('pointerup', (e) => {
    const wasPinch = pinch !== null;
    lift_(e);
    const d = drag;
    drag = null;
    // (a finger lifted off a pinch ends it: the other finger does not click or pan on)
    if (!d || wasPinch) { if (wasPinch) settle(); return; }
    // the end of a pan or a turn: a pull past a part's edge springs back, a turn in the case eases back toward head on
    if (d.moved > 5) { settle(); return; }
    click(idAt(e));
  });
  canvas.addEventListener('pointerleave', () => { if (!drag) hover.value = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    // (a line or a page of a wheel that counts them is about 40 or 800 pixels)
    const dy = Math.max(-300, Math.min(300, e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1)));
    zoomToward(e, Math.exp(dy * 0.0012));
  }, { passive: false });
  /** Zoom by the factor `k` (above 1 out) toward the point `e` (a wheel notch, or the middle of a pinch). */
  function zoomToward(e: { clientX: number; clientY: number }, k: number): void {
    cancelFlight();
    atOverview = false;
    const { nx, ny } = ndc(e), a = aspect();
    // the zoom goes toward the surface under the pointer, which stays under it (`zoomOn`): each notch takes the same share of the way to it
    const p = anchor(e), base = p ? retarget(goal, p.z) : goal, by = (f: number) => (p ? zoomOn(base, p, f) : zoomAt(base, f, nx, ny, a));
    // out against the walls the zoom stops, and in against the furniture: then the point under the pointer moves only as far as the zoom that
    // was allowed (not at all if no closer look was)
    const z = by(k), c = inRoom(z);
    const cut = Math.abs(c.height - z.height) >= 1 && (c.height < z.height || z.height < base.height);
    goal = !cut ? c : c.height < z.height || c.height < base.height ? inRoom(by(c.height / base.height)) : goal;
    settle();
  }

  /** The same quick actions as the 2D renderer's click (`Interact.click`): the room's props, the power button, a key; anything else opens its card. */
  const click = (id: string | null) => {
    if (!id) { selected.value = null; return; }
    if (roomClick(id)) { selected.value = null; return; }
    // the shut side panel: a click opens the case
    if (id === 'case.side') { machine?.toggleDoor(); selected.value = null; return; }
    const s = snapshot.peek();
    // a part of a graphics card (`pcie1.lane3`) hovers on its own, a click opens the card
    if (s) id = deviceOfPart(id, s.devices);
    // an empty drive bay opens the drive shop, as the 2D bay's region does; any other empty socket is only a place to drop on
    if (/^sata\d+$/.test(id) && s?.slots.some((x) => x.id === id && !x.deviceId)) { selected.value = 'bay'; return; }
    if (s?.slots.some((x) => x.id === id && !x.deviceId)) { selected.value = null; return; }
    if (id === 'power') { if (!(s?.power.tripped || s?.phase === 'error')) { selected.value = null; powerButton(); return; } }
    if (id.startsWith('key:') && s) {
      const keyId = Number(id.slice(4));
      selected.value = null;
      if (s.plugged?.id === keyId) ejectKey(); else if (!s.plugged) plugKey(keyId);
      return;
    }
    selected.value = id;
  };

  // ---- anchors and flights for the tutorial and the cards (the same contract as the 2D renderer: `anchorOf`, `flyTo` in board.ts) ----
  /** Ids the tutorial and the shop use that stand for another object here (the monitor and the supply stand for their sockets; the bay for its first free mouth). */
  const ALIAS: Record<string, string[]> = { display0: ['monitor'], atx0: ['psu'], 'atx-plus0': ['psu'], bay: Array.from({ length: 8 }, (_, i) => `sata${i}`) };
  const objOf = (id: string): Object3D | null => { for (const r of roots()) { const o = findById(r, id); if (o) return o; } return null; };
  /** The scene id an id stands for: an alias, or the device that fills a slot (the 2D scene answers to both). */
  const real = (id: string): string => {
    const a = ALIAS[id]?.find((x) => objOf(x));
    if (a) return a;
    if (!objOf(id)) { const d = snapshot.peek()?.devices.find((x) => x.slot === id); if (d && objOf(d.id)) return d.id; }
    return id;
  };
  const plugOf = (o: Object3D): Object3D => { let p: Object3D | null = null; o.traverse((c) => { if (!p && c.userData.plug) p = c; }); return p ?? o; };
  /** The world boxes an id stands for: an object's; a cable's plug, then (loose) the socket that takes it. */
  const boxesOf = (id: string): Box3[] => {
    const o = objOf(real(id));
    if (!o) return [];
    if (!id.startsWith('cable.')) return [new Box3().setFromObject(o)];
    const kind = id.slice(6), out = [new Box3().setFromObject(plugOf(o))], rig = machine?.rig(kind);
    if (rig?.canSeat && !snapshot.peek()?.cables.find((c) => c.id === kind)?.connected) {
      const [x, y, z] = rig.seat.at;
      out.push(new Box3(new Vector3(x - 100, y - 100, z - 100), new Vector3(x + 100, y + 100, z + 100)));
    }
    return out;
  };
  const freeRect = () => { const i = viewInset.peek(), r = canvas.getBoundingClientRect(); return { x: r.left + i.left, y: r.top + i.top, w: Math.max(50, r.width - i.left - i.right), h: Math.max(50, r.height - i.top - i.bottom) }; };
  /** A world box as a client rectangle; null behind the eye. `visible`: it meets the part of the screen the HUD leaves free. */
  const screenBox = (b: Box3): Anchor | null => {
    if (b.isEmpty()) return null;
    const r = canvas.getBoundingClientRect(), f = freeRect(), p = new Vector3();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      p.set(x, y, z).project(camera);
      if (p.z >= 1) return null;
      const px = r.left + ((p.x + 1) / 2) * r.width, py = r.top + ((1 - p.y) / 2) * r.height;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    // (a target too small to hit counts as not seen: the tutorial then flies in to it)
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, visible: x0 < f.x + f.w && x1 > f.x && y0 < f.y + f.h && y1 > f.y && Math.max(x1 - x0, y1 - y0) >= MIN_TARGET_PX };
  };
  const anchorsOf = (id: string): Anchor[] => boxesOf(id).map(screenBox).filter((a): a is Anchor => !!a);
  const cues = new Cues3D(anchorsOf);
  const flyToId = (id: string, o: FlyOpts): boolean => {
    const box = new Box3();
    // a key shows with its port
    for (const i of id.startsWith('key:') ? [id, 'usb'] : [id]) for (const b of boxesOf(i)) box.union(b);
    if (box.isEmpty()) { o.onDone?.(false); return false; }
    const inCaseId = !!machine && !!findById(machine.root, real(id)) && !OUTSIDE.has(id), pad = id.startsWith('key:') ? 600 : 0;
    const f = freeRect(), bw = box.max.x - box.min.x, bh = box.max.y - box.min.y, cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
    // the 2D window: at least 9500 wide with room round the target, as tall as the free area's shape asks
    // (a plug or a key is small: its window hugs it and what it goes to, so it reads at a size the pointer can grab)
    const small = id.startsWith('cable.') || id.startsWith('key:'), ext = Math.max(bw, bh);
    const minW = small ? Math.min(9500, Math.max(2500, ext * 2.5 + 800)) : 9500, margin = small ? Math.max(800, ext * 0.6) : 1800;
    let cw = Math.max(minW, bw + (small ? 2 * margin : 2200) + 2 * pad), ch = (cw * f.h) / f.w;
    if (ch < bh + margin + 2 * pad) { ch = bh + margin + 2 * pad; cw = (ch * f.w) / f.h; }
    // under the desk (the wall socket, the mains plugs) the desk's top hides the floor from above: look along it, from low down
    const underDesk = !inCaseId && !!room && box.max.y < -(room.geo.ys + DESK_TOP);
    let v = inFree({ x: cx - cw / 2, y: -cy - ch / 2, w: cw, h: ch }, box.max.z, inCaseId ? FLAT : underDesk ? { ...ROOM_ANGLE, pitch: -0.07 } : ROOM_ANGLE, 1);
    v = { ...v, height: Math.min(v.height, overview().height) };
    if (o.zoom) v = { ...v, height: H / o.zoom };
    flyTo(v);
    if (o.smooth === false) view = goal;
    pending = o.onDone ?? (() => {});
    return true;
  };
  setWorldAnchors({ anchorsOf, flyTo: flyToId });
  /** What the cards and the pointer line place themselves by: they measure again when this changes (`cameraRev`). */
  let revKey = '';

  const onKey = (e: KeyboardEvent) => {
    if (menu) return; // the main menu's room is a picture: no keys, no pointer
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    cancelFlight();
    atOverview = false;
    const k = e.key.toLowerCase();
    if (k === 'f') flyToCpu(); else if (k === 'g') flyToGpu(); else if (k === 'b') flyToBoard(); else if (k === 'r' || k === 'home') flyToRoom(); else if (k === 'p') powerLens.value = !powerLens.value; else if (k === 'a') airflowLens.value = !airflowLens.value; else if (k === 'o') machine?.toggleDoor();
  };
  window.addEventListener('keydown', onKey);

  // ---- snapshot, theme, size ----
  effect(() => { snapshot.value; rebuild(); });
  onThemeChange(() => { T = readTheme(); (scene.background as { set(c: string): void }).set(T.bg); demand.ask(); });
  new ResizeObserver(() => {
    W = host.clientWidth; H = Math.max(1, host.clientHeight);
    renderer.setSize(W, H); post.setSize(W, H);
    demand.ask(); // (a new size clears the canvas)
  }).observe(host);
  canvas.addEventListener('webglcontextrestored', () => demand.ask());

  // ---- the graphics settings (app/graphics.ts) ----
  const applyGraphics = (g: Graphics) => {
    post.apply(g, renderer, W, H);
    room?.setShadows(g.shadows);
    room?.setLights(g.lights, g.lightShadows > 0);
    // (a shadow map more or less makes every lit program again: the frame links them before it draws)
    warmed = false;
    shadows.reset();
    chips.live = LIVE_LEVELS[g.live] ?? LIVE_LEVELS[2];
    fx.density = PARTICLE_LEVELS[g.particles] ?? 1;
    if (g.filtering !== anisotropy) refilter(scene, g.filtering);
    demand.ask();
  };
  effect(() => applyGraphics(effective.value));
  const gate = new FrameGate(), meter = new FrameMeter(), watch = new SlowWatch(), tierWatch = new TierWatch();
  const resetWatches = (now: number) => { watch.reset(now); tierWatch.reset(now); };
  // a new choice of the player's starts the watch over, as a new picture bakes and compiles its way in
  effect(() => { graphics.value; resetWatches(performance.now()); });

  // ---- the frame ----
  let gt = (((START_HOUR_3D - START_HOUR + 24) % 24) / 24) * DAY_S * 1000, last = performance.now(), wasTier = `${LAYOUT_TIER}|${LAYOUT_CASE}`, lean = 0;
  /** The boot screen has gone (`onShown` ends the mount's wait); when the last programs linked. */
  let revealed = false, linkedAt = 0, stillAt = 0, onShown = () => {};
  const STILL_MS = 30000;
  const shown = new Promise<void>((done) => { onShown = done; });
  /** The new picture's programs have linked: it draws from this frame on. */
  const drawn = (now: number) => {
    linking = null;
    linkedAt = now;
    resetWatches(now);
    demand.ask();
    if (!revealed) bootStage('Lighting the room', 0.92);
  };
  /**
   * Gallery or Build my PC (the main menu's, `Hud.tsx`) covers the whole screen with an opaque stage that draws in its own context: the room
   * is not drawn behind it. The canvas keeps its last picture and the room's time stands still, so it is the same on return. A new picture's
   * programs still link meanwhile (`warmed`, `linking`): a graphics change made there is ready on return.
   */
  const covered = () => revealed && warmed && !linking && !snapshot.peek() && (galleryOpen.peek() || buildOpen.peek());
  /** The stage covered the room on the last tick (the first tick back draws); the outline's parts as last drawn. */
  let wasCovered = false, outlineKey = '';
  const frame = (now: number) => {
    const t0 = performance.now(); // the frame work time (CPU in this callback) for `TierWatch`
    const g = effective.peek(), fps = loopLimit(g.fps, document.hasFocus());
    if (!gate.ready(now, fps)) { requestAnimationFrame(frame); return; }
    // (the frame rate the graphics settings show stays live: the page's, which the stage's draw sets)
    if (covered()) { wasCovered = true; last = now; meter.tick(now, canvas.width, canvas.height); requestAnimationFrame(frame); return; }
    if (wasCovered) { wasCovered = false; demand.ask(); }
    // a new picture's programs still link: nothing is drawn (the canvas keeps its last picture; the boot screen covers the first)
    if (linking) {
      if (!linked(linking)) {
        if (!revealed) bootStage('Preparing the shaders', 0.38 + (0.52 * linking.filter((p) => p.isReady()).length) / linking.length);
        last = now;
        requestAnimationFrame(frame);
        return;
      }
      drawn(now);
    }
    // a weak GPU: when the frames stay slow, auto-adjust takes the next step down and stays there (`lowered`)
    if (graphics.peek().auto && document.visibilityState === 'visible' && watch.tick((now - last) / 1000, now, watchFps(g, fps))) {
      const step = nextStep(graphics.peek(), autoStep.peek());
      if (step !== null) autoStep.value = step;
    }
    const rawDt = Math.max(0, (now - last) / 1000), dt = Math.min(0.1, rawDt), ratio = renderer.getPixelRatio();
    last = now;
    gt += dt * 1000 * speed.value;
    // a new machine whose programs have linked takes the old one's place
    if (next && linked(next.programs)) { install(next.m); next = null; }
    const s = snapshot.peek();
    if (!s) goal = menuView(now / 1000); else if (menu) flyToRoom();
    if (menu !== !s) { menu = !s; canvas.style.pointerEvents = menu ? 'none' : ''; }
    if (menu && hover.peek()) hover.value = null;
    view = inRoom(stepView(view, goal, dt), false);
    if (pending && settled(view, goal)) { const p = pending; pending = null; p(true); }
    // over a part that stands edge-on to the glass (the RAM sticks), the camera leans to see its face, round a pivot lifted to its middle
    lean += ((machine?.lean(view.x, -view.y, H / view.height) ?? 0) - lean) * (1 - Math.pow(0.02, dt));
    applyView(camera, Math.abs(lean) < 1e-4 ? view : { ...view, yaw: view.yaw + lean, z: view.z + 170 * (lean / RAM_LEAN) }, aspect());
    // the HUD's inset changed while the overview shows: fit it again to what is left free
    const ins = viewInset.peek(), insKey = `${ins.left}|${ins.right}|${ins.top}|${ins.bottom}`;
    const rk = `${view.x.toFixed(1)}|${view.y.toFixed(1)}|${view.z.toFixed(1)}|${view.height.toFixed(1)}|${view.yaw.toFixed(3)}|${view.pitch.toFixed(3)}|${lean.toFixed(3)}|${W}|${H}|${insKey}|${machKey}|${snapshot.peek()?.cables.map((c) => +c.connected).join('') ?? ''}`;
    if (atOverview && !revKey.includes(insKey)) goal = overview();
    if (rk !== revKey) { revKey = rk; cameraRev.value += 1; }
    machine?.lod(camera, H, ratio * (TEXTURE_LEVELS[g.textures] ?? 1));
    // the dies' replay: at the game's pace, slower as the camera comes in so a block can be followed (as board.ts); the HUD says so
    const scale = worldPace(speed.peek()), pace = zoomSlowOn.peek() ? zoomSlow(H / view.height, CYCLES_PER_SEC, scale) : scale, note = scale > 0 ? Math.round((pace / scale) * 100) / 100 : 1;
    if (zoomSlowdown.peek() !== note) zoomSlowdown.value = note;
    chips.frame(camera, H, dt * pace, speed.peek() <= 0, ratio);
    fx.frame(s, dt * worldPace(speed.peek()));
    if (room) lens.frame(camera, H, s, room.geo, dt * worldPace(speed.peek()), ratio);
    boardLive.frame(camera, H, s, gt, dt * pace, speed.peek() <= 0, ratio, !!machine);
    room?.setScreenImage(boardLive.screen);
    cues.frame(menu ? null : s);
    bakes.run(6);
    const display = !!s?.devices.some((d) => d.kind === 'display'), hour = roomDebug.hour ?? hourAt(gt);
    room?.frame({ hour, lamp: roomState.lamp, blind: roomState.blind, screen: { installed: display, powered: !!s?.monitorPowered, live: !!s?.monitorLive && !!s.monitorPowered && !!s.powered && !!s.display, text: s?.display ?? '' }, router: s ? Number(/\d+$/.exec(s.net?.router?.id ?? '')?.[0] ?? 0) : 1, isp: Number(/\d+$/.exec(s?.net?.isp?.id ?? '')?.[0] ?? 0), ispName: s?.net?.isp?.name ?? '', mail: !!s?.net && (s.net.uploadsWaiting > 0 || s.net.transfers.some((t) => t.dir === 'up')), t: gt / 1000 }, dt);
    // a drag into the case, or a tutorial target inside it, opens its side panel from any distance (a key, a desk cable or the outside do not)
    // (a plug the hand still slides in or lets fall keeps it open too)
    const handIn = !!hand.kind && !OUTSIDE.has('cable.' + hand.kind);
    if (machine) { const m = machine; m.setOpen(lift.intoCase || handIn || highlight.peek().some((id) => !OUTSIDE.has(id) && !id.startsWith('key:') && !!findById(m.root, id)), lift.busy || handIn); }
    machine?.frame(s, dt);
    hand.frame(dt, camera);
    // the outline: the hovered part, the selected one and the tutorial's targets
    const ids = new Set([hover.peek()?.id, selected.peek(), ...highlight.peek(), ...lift.targets()].filter((x): x is string => !!x));
    const picked: Object3D[] = [];
    for (const id of ids) for (const r of roots()) { const o = findById(r, real(id)); if (o) { picked.push(ownerOf(o)!); break; } }
    post.setOutlined(picked);
    const ok = [...ids].join('|');
    if (ok !== outlineKey) { outlineKey = ok; demand.ask(); }
    // (how near the eye is, by the height shown at `LOOK_Z`: the same picture reads the same whatever its target)
    const seenH = heightAt(view, LOOK_Z);
    post.setReach(seenH);
    // (the set eye and the metered one blend in log over the zoom; the metered one eases toward its reading over about half a second)
    const near = 1 - roomness(seenH);
    const day = daylight(hour);
    post.setEye((NIGHT_EYE ** (1 - day)) ** (1 - near) * seen ** near, MID ** day * NIGHT_KEY ** (1 - day), HIGH_C + (NIGHT_HIGH - HIGH_C) * (1 - day));
    // the first frame of a new picture: its programs start to link, its lights as they stand now (`compile.ts`)
    if (!warmed) {
      warmed = true;
      linking = [...startPrograms(renderer, scene, camera, { fades: machine?.fades ?? [] }), ...(room?.startPrograms(renderer, scene) ?? []), ...post.startPrograms(renderer)];
      if (!linked(linking)) { requestAnimationFrame(frame); return; }
      drawn(now);
    }
    // a still of the room for the next boot screen: always from the overview's fixed angle, whatever the player looks at. A draw of its own, before
    // the frame's (which paints over it), in the same task: the buffer is not kept, so it is copied right after the draw.
    if (revealed && s && now - stillAt > STILL_MS) {
      stillAt = now;
      const ov = overview(), h = heightAt(ov, LOOK_Z), nr = 1 - roomness(h);
      applyView(camera, ov, aspect());
      post.setReach(h);
      post.setEye((NIGHT_EYE ** (1 - day)) ** (1 - nr) * seen ** nr, MID ** day * NIGHT_KEY ** (1 - day), HIGH_C + (NIGHT_HIGH - HIGH_C) * (1 - day));
      room?.drawOutside(renderer, scene, camera, g.msaa);
      post.render();
      saveStill(canvas);
      applyView(camera, Math.abs(lean) < 1e-4 ? view : { ...view, yaw: view.yaw + lean, z: view.z + 170 * (lean / RAM_LEAN) }, aspect());
      post.setReach(seenH);
      post.setEye((NIGHT_EYE ** (1 - day)) ** (1 - near) * seen ** near, MID ** day * NIGHT_KEY ** (1 - day), HIGH_C + (NIGHT_HIGH - HIGH_C) * (1 - day));
    }
    // drawn on demand (docs/render/load.md "Draw on demand"): the game draws every frame. The title's room draws when its picture changes: the
    // sway moves it `STILL_PX` or more at the room's depths, the city's beat comes (its cars, the cup's steam, the hour's light), the machine
    // moves, the probe works, the eye is on its way, or something asked (a new size, setting, theme, picture, part, tile or shadow)
    const D = distanceOf(view);
    // the city's beat is one frame, not a motion: it asks, so it draws no trailing frame after it
    if (room?.ambientDue) demand.ask();
    const busy = !menu || !revealed || !!machine?.moving || probe.busy || bounces > 0
      || (near > 0 && Math.abs(Math.log(metered / seen)) > 1e-3) || shift.shift(camera, canvas.width, canvas.height, D / 2, D * 1.5) >= STILL_PX;
    const draw = demand.want(now, busy);
    if (draw) {
      room?.drawOutside(renderer, scene, camera, g.msaa);
      post.render();
      shift.mark(camera, canvas.width, canvas.height);
    }
    const lum = draw && near > 0 ? post.meter() : null;
    if (lum !== null) { reading = lum; metered = Math.min(EYE_RANGE[1], Math.max(EYE_RANGE[0], EYE_KEY / (BASE_EXPOSURE * lum))); }
    seen *= (metered / seen) ** (1 - Math.pow(0.01, dt));
    // the probe takes a face a frame, between the draw and the shadows' scan, so it uses no shadow redraw of the next frame's
    if (room && draw) {
      const key = `${room.lightKey}|${!!s?.powered}`;
      if (!probe.busy && (bounces > 0 || (key !== probeKey && now - probeAt > PROBE_MS))) { probe.request(); probeKey = key; probeAt = now; bounces = Math.max(0, bounces - 1); }
      // one light for all: the machine and the dies' art take the room's probe as the room's own materials do (`RoomEnv`), at every zoom
      if (probe.step(renderer, scene)) {
        roomEnv = pmrem.fromCubemap(probe.texture, roomEnv);
        scene.environment = roomEnv.texture; scene.environmentIntensity = PROBE_K;
        if (!probed) { room.setProbe(roomEnv.texture); probed = true; }
        demand.ask();
      }
    }
    // the shadow maps of the next frame: the draw has just set every world matrix, so what the scan sees is this frame's
    if (draw) {
      const cast = shadows.scan(scene, now);
      room?.redrawShadows(cast, now);
      if (cast || shadows.pending) demand.ask();
    }
    meter.tick(now, canvas.width, canvas.height);
    // auto tier: one decision from the first seconds of frames; manual mode never steps
    // (only frames the renderer drew count: an idle frame is cheap on any device; so is a frame the away limit holds down)
    if (draw && tierRecord.peek().mode === 'auto' && document.visibilityState === 'visible' && !awayHeld(fps, g.fps)) {
      const dir = tierWatch.tick(rawDt, performance.now() - t0, now, watchFps(g, g.fps));
      if (dir) stepTier(dir);
    }
    // a new case is a new room: frame it again
    const tierNow = `${LAYOUT_TIER}|${LAYOUT_CASE}`;
    if (tierNow !== wasTier) { wasTier = tierNow; flyToRoom(); }
    // the boot screen goes once the room's light has settled (the probe's bounces), or at the latest `REVEAL_MS` after the link
    if (!revealed && ((probed && bounces === 0 && !probe.busy) || now - linkedAt > REVEAL_MS)) { revealed = true; resetWatches(now); onShown(); }
    requestAnimationFrame(frame);
  };
  // the light bake's lightmap changes the room's programs: they link after it
  bootStage('Loading the light', 0.36);
  await (room as Room3D | null)?.ready;
  bootStage('Preparing the shaders', 0.38);
  requestAnimationFrame(frame);
  await shown;
  bootDone();

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__board = {
    three: true, scene, renderer, chips, quality: () => autoStep.peek(),
    // the frame's parts as they stand (tools/bench3d.mjs times them)
    parts: () => ({ post, machine, room, chips, fx, lens, bakes, shadows, hand, probe }),
    // the metered eye (the meter's reading, the exposure's factor it asks for, and where it stands now)
    eye: () => ({ reading, metered, seen }),
    idAt: (x: number, y: number, raw = false) => idAt({ clientX: x, clientY: y }, raw),
    // the client point of a world point (tests drive the pointer there: a socket that is no object of its own)
    project: (x: number, y: number, z: number) => {
      const r = canvas.getBoundingClientRect(), p = new Vector3(x, y, z).project(camera);
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
    // the client point of an object's middle (tests drive the pointer there)
    screenOf: (id: string) => {
      const o = roots().map((r) => findById(r, id)).find(Boolean);
      if (!o) return null;
      const r = canvas.getBoundingClientRect(), b = new Box3().setFromObject(o), mid = b.getCenter(new Vector3()).project(camera);
      const at = (nx: number, ny: number) => ({ x: r.left + ((nx + 1) / 2) * r.width, y: r.top + ((1 - ny) / 2) * r.height });
      // the middle if the object is there, else a point on it found by a grid of rays over its box
      const hit = (nx: number, ny: number) => { const p = at(nx, ny), got = idAt({ clientX: p.x, clientY: p.y }); return got === id || (got ?? '').startsWith(id); };
      if (hit(mid.x, mid.y)) return at(mid.x, mid.y);
      const lo = new Vector3(b.min.x, b.min.y, b.max.z).project(camera), hi = new Vector3(b.max.x, b.max.y, b.max.z).project(camera);
      for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
        const nx = Math.min(lo.x, hi.x) + (Math.abs(hi.x - lo.x) * i) / 24, ny = Math.min(lo.y, hi.y) + (Math.abs(hi.y - lo.y) * j) / 24;
        if (nx > -1 && nx < 1 && ny > -1 && ny < 1 && hit(nx, ny)) return at(nx, ny);
      }
      return at(mid.x, mid.y);
    }, flyToCpu, flyToGpu, flyToBoard, flyToRoom, view: () => view, goal: () => goal, bakes: () => bakes.size,
    // the rail that holds the view (its part's id), and the parts' rails
    rail: () => rail?.r.id ?? null, rails: () => machine?.rails ?? [],
    orbit: (yaw: number, pitch: number) => { goal = inRoom(orbitBy(goal, yaw, pitch)); },
    // the case of tier `c` (board tier `b`, default the same), empty; null goes back to the game's
    previewCase: (c: number | null, b = c ?? 0) => { preview = c === null ? null : { board: b, case: c }; rebuild(); wasTier = `${LAYOUT_TIER}|${LAYOUT_CASE}`; },
    // a close look at a layout point (x, y) at depth z, `height` world units tall, turned by `yaw`, from `pitch` above (no rail holds it)
    lookAt: (x: number, y: number, z: number, yaw: number, pitch: number, height: number) => jump(clampView({ x, y: -y, z, yaw, pitch, fov: 26, height })),
    toggleDoor: () => machine?.toggleDoor(),
    // the whole case from the side, turned by `yaw` and seen from `pitch` above
    caseView: (yaw = 0, pitch = 0.09, margin = 0.85) => jump(fitRect(CASE, CASE_Z + CASE_D / 2, aspect(), { yaw, pitch, fov: 26 }, margin)),
    // the shot tool's `--view x,y,z`: a layout point and a zoom in screen pixels per unit, seen flat
    camera: { set: (v: { x: number; y: number; z: number }) => jump(clampView({ ...FLAT, x: v.x, y: -v.y, z: BOARD_Z, height: H / v.z })) },
  };
}
