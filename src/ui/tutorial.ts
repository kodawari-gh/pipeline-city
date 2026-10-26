// Guided tutorial, pure logic. The current step is the first step not yet done, judged from the snapshot: the sticky
// `progress` flags where there is one, else live state (an item in the inventory, the phase, a key's stage). Loading a
// save mid-way resumes at the right step, and out-of-order actions are simply skipped past. Only the welcome card
// (Start) and the last card (Got it) have buttons, plus the one-time "Next lesson: the OS" offer. No DOM, no signals.
//
// The tutorial covers the game up to the network: building the machine, the first jobs, storage and the OS. The network
// itself (level 4) is the next goal the last card points at, not a lesson.
//
// Each step is one short instruction (`text`); the explanation is part of the text, in plain words, written for someone who has never opened a computer. A step belongs
// to a chapter (`Build`, `First jobs`, `The OS`), which the card shows instead of "step 17 of 33".

import { BOARD_TIERS, getSpec } from '../sim/board/specs';
import { getOsSpec } from '../sim/os';
import type { Dragging } from '../game/interaction';
import type { Snapshot } from '../sim/game/game';
import type { Progress } from '../sim/game/save';
import { fmtMoney } from './logic';
import { levelBar } from './levelui';

export interface ReplayBase { completed: number; owned: number }
export interface TutorialState {
  welcomed: boolean;
  skipped: boolean;
  finished: boolean;
  /** Set when replaying: flags are sticky, so steps are judged from live state and deltas against this baseline. */
  replay: ReplayBase | null;
  /** The OS lesson is part of this viewer's tutorial (set when a new-style tutorial finishes, replays, or the offer is taken). */
  osLesson: boolean;
  /** The "Next lesson: the OS" offer was answered (taken or dismissed). */
  offered: boolean;
  /** Explain-only steps the player has read and answered with Got it. */
  acks: string[];
}

export const INITIAL_TUTORIAL: TutorialState = {
  welcomed: false, skipped: false, finished: false, replay: null, osLesson: false, offered: false, acks: [],
};

export type StepId =
  | 'welcome' | 'cpu' | 'cooler' | 'ram' | 'psu' | 'monitor' | 'cables' | 'wall' | 'plugKey' | 'watch' | 'money' | 'reputation' | 'level'
  | 'cycle' | 'spend' | 'fit' | 'reachLevel3' | 'buyDrive' | 'drive' | 'buyRam' | 'fitRam' | 'buyOs' | 'os' | 'bootOs' | 'osIngest' | 'osPaid'
  | 'reachLevel4' | 'buyIsp' | 'buyRouter' | 'placeRouter' | 'buyCase' | 'fitCase' | 'buyBoard' | 'fitBoard' | 'plugLan' | 'linkUp' | 'firstNetJob' | 'done';

export type Chapter = 'Build' | 'First jobs' | 'The OS' | 'The network';
export const CHAPTERS: Chapter[] = ['Build', 'First jobs', 'The OS', 'The network'];

export interface StepDef {
  id: StepId;
  chapter: Chapter | null;
  title: string;
  /** What the step is about, in plain words, ending with what to do. Typed out by the dialogue box in pages. */
  text: string;
  /** An explain-only step: it ends when the player presses Got it (`TutorialState.acks`), or when the player is already past it. */
  ack?: boolean;
  /** Progress flag that completes the step, if it has one. */
  flag: keyof Progress | null;
  /** Live completion test for steps without a flag (see `isDone`). */
  done?: (s: Snapshot, p: Progress) => boolean;
  /** World ids to pulse (renderer highlight). `drag` is what the player is dragging right now (a key: light the port instead). */
  targets: (s: Snapshot, drag?: Dragging | null) => string[];
  /** A waiting step shows a meter (the level bar's progress) instead of leaving the player wondering how long it takes. */
  meter?: (s: Snapshot) => { pct: number; label: string };
}

/** The twelve steps before storage and the OS existed. A player who finished them is not forced through the rest. */
const OLD_FLAGS: Array<keyof Progress> = [
  'cpuInstalled', 'ramInstalled', 'psuInstalled', 'monitorInstalled', 'atxConnected', 'cpuPowerConnected',
  'videoConnected', 'poweredOn', 'firstKeyPlugged', 'firstJobDone', 'firstKeyEjected', 'firstPurchase',
];

const PART_KINDS = ['cpu', 'ram', 'psu', 'cooler', 'display', 'board'];
/**
 * A bought upgrade that is still waiting to be fitted: a part in the inventory that is a higher tier than the best one
 * installed of its kind (on a one-DIMM board it swaps with the old stick, which then returns to the inventory as a lower tier).
 */
export const pendingUpgrade = (s: Snapshot, i: Snapshot['inventory'][number]): boolean => {
  if (!PART_KINDS.includes(i.kind)) return false;
  const spec = getSpec(i.spec);
  if (!spec) return false;
  const have = s.devices.filter((d) => d.kind === spec.kind && !d.burnt);
  return have.length === 0 || Math.max(...have.map((d) => getSpec(d.spec)?.tier ?? -1)) < spec.tier;
};
/** A part swap is queued behind a running job: the player has done their bit, so point at the work instead of the shelf. */
const whileSwapQueued = (targets: (s: Snapshot) => string[]) => (s: Snapshot): string[] => (s.pendingSwap ? ['monitor'] : targets(s));
/** The shop tile to buy, pulsed inside the picker (`buy:<spec id>`): the cheapest processor on offer for the spend step. */
const cpuUpgrades = (s: Snapshot) => {
  const have = Math.max(-1, ...s.devices.filter((d) => d.kind === 'cpu' && !d.burnt).map((d) => getSpec(d.spec)?.tier ?? -1));
  return s.purchases.filter((p) => p.kind === 'cpu' && !p.locked && !p.later && !p.blocked && (getSpec(p.id)?.tier ?? -1) > have);
};
const cheapestCpu = (s: Snapshot): string | null => {
  const c = cpuUpgrades(s).sort((a, b) => a.price - b.price)[0];
  return c ? c.id : null;
};
/** Nothing is lit while the player cannot pay for the thing the step asks them to buy: the grey line says how much is missing. */
const whenAffordable = (id: string | ((s: Snapshot) => string | null), targets: (s: Snapshot) => string[]) => (s: Snapshot): string[] => {
  const sid = typeof id === 'string' ? id : id(s);
  const p = sid ? s.purchases.find((x) => x.id === sid) : undefined;
  return p && !p.affordable ? [] : targets(s);
};
const BROKE = ' Short on cash? Keep delivering jobs: the tile glows once you can afford it.';
/**
 * Plugging a key: light the key until the player takes hold of it (a click plugs it by itself), then only the port it goes
 * into. Never both at once: that reads as two things to do.
 */
const plugTarget = (s: Snapshot, drag: Dragging | null | undefined, key: Snapshot['tray'][number] | undefined): string[] =>
  drag?.kind === 'key' ? ['usb'] : key ? [`key:${key.id}`] : s.plugged ? [] : ['tray'];
const SWAP_WAIT = 'Waiting for the running job to finish: your part swaps in by itself.';
const invOf = (s: Snapshot, kind: string) => s.inventory.filter((i) => i.kind === kind);
/** Inventory items of a kind plus the free slots they fit. */
const installTargets = (kind: string) => (s: Snapshot): string[] => {
  const items = invOf(s, kind);
  return [...items.map((i) => `inv:${i.id}`), ...items.flatMap((i) => i.freeSlots)];
};
/** Memory fitted now, in bytes (the OS lives in RAM while it runs, so the machine needs a minimum before it can have one). */
const ramBytes = (s: Snapshot): number =>
  s.devices.filter((d) => d.kind === 'ram' && !d.burnt).reduce((n, d) => { const sp = getSpec(d.spec); return n + (sp && 'sizeBytes' in sp ? sp.sizeBytes : 0); }, 0);
const OS_RAM_BYTES = getOsSpec('os1')?.minRamBytes ?? 32 * 1024;
const ramShort = (s: Snapshot) => !s.os && ramBytes(s) < OS_RAM_BYTES;
/** Memory is its own lesson while the OS is waiting for it, so the general "fit your new part" step leaves it alone. */
const fitsGeneralStep = (s: Snapshot, i: Snapshot['inventory'][number]) => pendingUpgrade(s, i) && !(i.kind === 'ram' && ramShort(s) && !ownsOs(s));
/** A spare memory stick big enough on its own (it replaces the small one, or fills a free slot). */
const hasBigRam = (s: Snapshot) => invOf(s, 'ram').some((i) => { const sp = getSpec(i.spec); return !!sp && 'sizeBytes' in sp && sp.sizeBytes >= OS_RAM_BYTES; });
const ownsStorage = (s: Snapshot) => s.storage.length > 0 || invOf(s, 'storage').length > 0;
const ownsOs = (s: Snapshot) => !!s.os || invOf(s, 'os').length > 0;
const ownsRouter = (s: Snapshot) => !!s.net.router || invOf(s, 'router').length > 0;
/** The machine has a network port: the board's own jack, or a network card. */
const hasJack = (s: Snapshot) => s.board.features.ethernetMbps > 0 || s.devices.some((d) => d.kind === 'nic' && !d.burnt);
const ownsJackBoard = (s: Snapshot) => hasJack(s) || invOf(s, 'board').some((i) => (BOARD_TIERS[Number(/^board(\d+)$/.exec(i.spec)?.[1])]?.features.ethernetMbps ?? 0) > 0);
/** A case big enough for the Basic board (the first one with a network port) is fitted or waiting in the inventory. */
const ownsBiggerCase = (s: Snapshot) => s.caseTier >= 1 || invOf(s, 'case').length > 0;
const OS_PHASES = ['idle-os', 'ingesting', 'running-os', 'flashing'];
const pluggedAt = (s: Snapshot, stages: string[]) => s.plugged !== null && stages.includes(s.plugged.stage);
/** The OS has copied a key into its queue (plugged). */
const ingested = (s: Snapshot) => pluggedAt(s, ['queued', 'running', 'result', 'flashing', 'done']);

/** The inventory button (bottom bar). A UI-only id: the renderer ignores it, the bar pulses the button. */
export const INVENTORY_ID = 'inventory';

const OS_RAM_KB = (getOsSpec('os1')?.minRamBytes ?? 32 * 1024) / 1024;

/** The three cables of the first build, by cable id and the progress flag that says each is in. */
const CABLES: Array<{ id: 'atx' | 'cpu' | 'video'; flag: keyof Progress; end: string }> = [
  { id: 'atx', flag: 'atxConnected', end: 'psu' },
  { id: 'cpu', flag: 'cpuPowerConnected', end: 'psu' },
  { id: 'video', flag: 'videoConnected', end: 'monitor' },
];

const levelMeter = (s: Snapshot) => { const m = levelBar(s); return { pct: m.pct, label: m.label }; };

export const STEPS: StepDef[] = [
  {
    id: 'welcome', chapter: null, title: 'Welcome', flag: null,
    text: 'Welcome to Pipeline City! This tiny workshop is yours now. Clients will bring you jobs on little USB sticks called keys. Your machine does each job and you get paid. First things first: you need a machine! Open the inventory (the box at the bottom) and drag the parts onto the board.',
    targets: () => [INVENTORY_ID],
  },
  { id: 'cpu', chapter: 'Build', title: 'Install the processor', flag: 'cpuInstalled',
    text: 'Every computer has a brain. This one is called the processor, or CPU, and it does all the thinking, one tiny step at a time. Drag it onto the big square socket on the board.',
    targets: installTargets('cpu') },
  { id: 'cooler', chapter: 'Build', title: 'Install the cooler', flag: 'coolerInstalled',
    text: 'Thinking is hot work! The CPU gets toasty while it runs, so it needs a fan to blow the heat away. Drag the cooler onto the processor.',
    targets: (s) => {
      const items = invOf(s, 'cooler');
      return [INVENTORY_ID, ...items.map((i) => `inv:${i.id}`), ...items.flatMap((i) => i.freeSlots)];
    } },
  { id: 'ram', chapter: 'Build', title: 'Install the memory', flag: 'ramInstalled',
    text: 'Now a desk to work on. Memory (RAM) is where the machine keeps a job while it works on it. Small or slow memory makes the brain sit around waiting. Drag the memory stick into a long slot next to the processor.',
    targets: installTargets('ram') },
  { id: 'psu', chapter: 'Build', title: 'Install the power supply', flag: 'psuInstalled',
    text: 'Time for some energy! The power supply is the machine\'s battery pack: it feeds electricity to every other part. Drag it into the bay below the board.',
    targets: installTargets('psu') },
  { id: 'monitor', chapter: 'Build', title: 'Install the monitor', flag: 'monitorInstalled',
    text: 'A screen lets you see what your machine is up to, from its first wake-up to the finished answer. Drag the monitor onto the display bay.',
    targets: installTargets('display') },
  { id: 'cables', chapter: 'Build', title: 'Plug in the three cables', flag: null,
    done: (_s, p) => CABLES.every((c) => p[c.flag]),
    text: 'Parts need wires to talk to each other. Main power and processor power carry energy from the power supply to the board. The video cable carries pictures from the board to the monitor. Drag the lit cable plug to its socket, three cables in all.',
    // One cable at a time, and only its two ends (plug and socket), not the whole device around it.
    targets: (s) => {
      const c = CABLES.find((x) => !s.cables.find((y) => y.id === x.id)?.connected);
      return c ? [`cable.${c.id}`] : [];
    } },
  // The two cords from the wall: the machine has no power without its cord, the screen stays dark without its own.
  { id: 'wall', chapter: 'Build', title: 'Plug in to the wall', flag: 'mainsConnected',
    text: 'One last thing: electricity! The machine and its screen each have a power cord, and both lie loose by the wall socket under the desk. Drag each plug into a hole in the socket. Tip: the lightning button shows the power lens, a map of where the power goes.',
    // the PC's cord first, then the monitor's: one plug at a time
    targets: (s) => {
      const c = ['pcmains', 'monmains'].find((id) => !s.cables.find((y) => y.id === id)?.connected);
      return c ? [`cable.${c}`, 'socket'] : [];
    } },
  { id: 'plugKey', chapter: 'First jobs', title: 'Plug in a client key', flag: 'firstKeyPlugged',
    text: 'Your first client has arrived! Jobs come on USB keys, a bit like a letter in an envelope. Plugging one in wakes the machine up: it checks itself, then reads the job off the key. Drag the key from the tray into the USB port.',
    targets: (s, drag) => plugTarget(s, drag, s.tray[0]) },
  { id: 'watch', chapter: 'First jobs', title: 'Watch it work', flag: 'firstKeyEjected',
    text: 'The machine does the job and writes the answer back onto the key. Every second it sits idle is money lost! Watch the monitor. When the job is done the key pops out, you get paid and the machine goes back to sleep.',
    targets: () => ['monitor'] },
  // ---- the three numbers at the top: explained once, with the game held, right after the first pay ----
  { id: 'money', chapter: 'First jobs', title: 'Your first pay', flag: null, ack: true,
    text: 'You just got paid! Look at the top left: that number is your money. Every delivered key adds to it. Money buys better parts, and better parts earn even more money.',
    targets: () => ['hud:money'] },
  { id: 'reputation', chapter: 'First jobs', title: 'Your reputation', flag: null, ack: true,
    text: 'The star next to it is your reputation. Clients love quick answers: serve them fast and it climbs, keep them waiting and it drops. A good reputation brings more clients, and better paid jobs.',
    targets: () => ['hud:reputation'] },
  { id: 'level', chapter: 'First jobs', title: 'Your level', flag: null, ack: true,
    text: 'At the top centre is your level. Each delivered job adds to your client base, and when the bar fills you level up: new parts and new kinds of jobs unlock. Click it any time to peek at what is coming.',
    targets: () => ['hud:level'] },
  { id: 'cycle', chapter: 'First jobs', title: 'Next job: plug the next key', flag: 'firstManualCycle',
    text: 'With no operating system, the machine only looks at the USB port when it wakes up, so every job needs a fresh start. Plug in the next key and it starts again by itself.',
    targets: (s, drag) => (!s.plugged && s.tray[0] ? plugTarget(s, drag, s.tray[0]) : []) },
  { id: 'spend', chapter: 'First jobs', title: 'Spend your first money', flag: 'firstPurchase',
    text: 'You have coins to spend! Better parts finish jobs sooner, and sooner means more money. Open the Shop and buy a processor upgrade. It lands in your inventory.' + BROKE,
    // The Shop, not the processor on the board: the cooler sits on top of it and takes the click.
    targets: whenAffordable(cheapestCpu, (s) => {
      const buy = cheapestCpu(s);
      return ['hud:shop', ...(buy ? [`buy:${buy}`] : [])];
    }) },
  // ---- storage and the OS ----
  { id: 'fit', chapter: 'First jobs', title: 'Fit your new part', flag: null,
    done: (s) => !s.inventory.some((i) => fitsGeneralStep(s, i)),
    text: `Your new part is waiting in the inventory. Drag it onto its socket and the machine swaps it in for you, waiting for a running job to finish first. Heads up: the operating system will need ${OS_RAM_KB}K of memory.`,
    targets: whileSwapQueued((s) => s.inventory
      .filter((i) => fitsGeneralStep(s, i))
      .flatMap((i) => [`inv:${i.id}`, ...i.freeSlots, ...i.swapSlots])) },
  { id: 'reachLevel3', chapter: 'The OS', title: 'Grow your client base', flag: null,
    done: (s) => s.level.level >= 3 || ownsStorage(s) || !!s.os,
    text: 'Every job you deliver adds to your client base, and your level grows with it. Higher levels bring more clients and better pay, though clients wait less. The OS opens at Level 3 and the network at Level 4. Keep delivering jobs, and hover the speed button at the top right to speed up the waiting.',
    // Waiting means serving: the next key is lit (then the port while it is dragged), so the player is never left wondering what to do.
    targets: (s, drag) => (s.plugged || !s.tray[0] ? [] : plugTarget(s, drag, s.tray[0])), meter: levelMeter },
  { id: 'buyDrive', chapter: 'The OS', title: 'Buy a drive', flag: null,
    done: (s) => ownsStorage(s),
    text: 'A computer needs somewhere to keep its software, like a bookshelf for its brain. That is a drive. An HDD is slow and cheap, an SSD is faster. Click the drive bay and buy the HDD.' + BROKE,
    targets: whenAffordable('hdd0', () => ['bay', 'buy:hdd0']) },
  { id: 'drive', chapter: 'The OS', title: 'Install the drive', flag: 'storageInstalled',
    text: 'The drive\'s speed decides how quickly the machine wakes up later. Drag the drive onto a free drive bay.',
    targets: whileSwapQueued(installTargets('storage')) },
  { id: 'buyRam', chapter: 'The OS', title: 'More memory first', flag: null,
    done: (s) => !ramShort(s) || hasBigRam(s) || ownsOs(s),
    text: `The operating system does not run from the drive alone: while it works it lives in memory, like a manager who needs a big desk. Your starter stick is too small: the OS wants ${OS_RAM_BYTES / 1024}K. Click the memory stick on the board and buy the bigger one.${BROKE}`,
    targets: whenAffordable('ram1', (s) => [...s.devices.filter((d) => d.kind === 'ram').map((d) => d.slot).slice(0, 1), 'buy:ram1']) },
  { id: 'fitRam', chapter: 'The OS', title: 'Fit the bigger memory', flag: null,
    done: (s) => !ramShort(s) || ownsOs(s),
    text: 'Drag the new memory stick onto the old one. The machine swaps it in for you, waiting for a running job to finish first.',
    targets: whileSwapQueued((s) => invOf(s, 'ram').flatMap((i) => [`inv:${i.id}`, ...i.freeSlots, ...i.swapSlots])) },
  { id: 'buyOs', chapter: 'The OS', title: 'Buy an operating system', flag: null,
    done: (s) => ownsOs(s),
    text: 'An operating system (OS) is the machine\'s manager. It keeps the computer awake and busy, so it does not need a fresh start for every job. Click the drive bay again and buy the OS.' + BROKE,
    targets: whenAffordable('os1', () => ['bay', 'buy:os1']) },
  { id: 'os', chapter: 'The OS', title: 'Install the OS on the drive', flag: 'osInstalled',
    text: 'The OS gets written onto the drive, which is where the machine wakes up from. Drag the OS onto the drive.',
    targets: whileSwapQueued(installTargets('os')) },
  { id: 'bootOs', chapter: 'The OS', title: 'Boot from the drive', flag: null,
    done: (s) => OS_PHASES.includes(s.phase) || s.progress.firstOsJob,
    text: 'Now wake the machine from its drive! The monitor shows the start-up text and what the OS is doing. A faster drive wakes up sooner. Press the power button and wait for the OS.',
    targets: () => ['power'] },
  { id: 'osIngest', chapter: 'The OS', title: 'Plug in a key', flag: null,
    done: (s, p) => ingested(s) || p.firstOsJob,
    text: 'The OS reads the job onto the drive and works on it with no restart. The key just has to stay in the port while it does. Drag a client key into the USB port and leave it there.',
    targets: (s, drag) => (s.plugged ? [`key:${s.plugged.id}`] : plugTarget(s, drag, s.tray[0])) },
  { id: 'osPaid', chapter: 'The OS', title: 'Wait for the result', flag: 'firstOsJob',
    text: 'The OS runs the job and writes the answer onto the key. It pops out by itself and you get paid. The machine stays on and takes the next key as soon as you plug it in. Watch the monitor to see what the OS is doing.',
    targets: () => ['monitor'] },
  // ---- the network (docs/NETWORK.md): an internet plan, a router, a port, a cable ----
  { id: 'reachLevel4', chapter: 'The network', title: 'Time to go online', flag: null,
    done: (s) => s.level.level >= 4 || s.progress.ispBought || ownsRouter(s),
    text: 'Clients are tired of carrying USB sticks around! From Level 4 they can send you jobs over the internet instead. Keep delivering jobs until your level reaches 4.',
    targets: (s, drag) => (s.plugged || !s.tray[0] ? [] : plugTarget(s, drag, s.tray[0])), meter: levelMeter },
  { id: 'buyIsp', chapter: 'The network', title: 'Buy an internet plan', flag: 'ispBought',
    text: 'Going online takes three things: an internet plan, a router, and a network port on your board. First the plan. It decides how fast jobs travel and how many clients can send you work at once. Open the Shop and buy the Basic DSL plan.' + BROKE,
    targets: whenAffordable('isp1', () => ['hud:shop', 'buy:isp1']) },
  { id: 'buyRouter', chapter: 'The network', title: 'Buy a router', flag: null,
    done: (s, p) => p.routerInstalled || ownsRouter(s),
    text: 'Now the router: the little box that connects your workshop to the internet. It has its own power, so it stays on even when your computer is off. Open the Shop and buy one.' + BROKE,
    targets: whenAffordable('router1', () => ['hud:shop', 'buy:router1']) },
  { id: 'placeRouter', chapter: 'The network', title: 'Place the router', flag: 'routerInstalled',
    text: 'Put the router in its spot next to the monitor. You can do this while the machine is running. Drag it from the inventory to the lit spot.',
    targets: (s) => [...invOf(s, 'router').map((i) => `inv:${i.id}`), ...invOf(s, 'router').flatMap((i) => i.freeSlots)] },
  { id: 'buyCase', chapter: 'The network', title: 'A bigger case', flag: null,
    done: (s) => ownsBiggerCase(s) || ownsJackBoard(s),
    text: 'Your starter board has no network port, like a laptop with no socket for the cable. The Basic board has one, but it is bigger than your little Mini tower, and a board has to fit its case. First a roomier case. A case can only be changed while the machine is switched off, so press the power button first, then open the Shop and buy the Micro tower.' + BROKE,
    // The machine is still running from the OS lesson: the power button first, then the Shop.
    targets: (s) => (s.powered ? ['power'] : whenAffordable('case1', () => ['hud:shop', 'buy:case1'])(s)) },
  { id: 'fitCase', chapter: 'The network', title: 'Fit the new case', flag: null,
    done: (s) => s.caseTier >= 1 || ownsJackBoard(s),
    text: 'Drag the new case onto your old one. Your board and all your parts move into it by themselves.',
    targets: whileSwapQueued((s) => invOf(s, 'case').flatMap((i) => [`inv:${i.id}`, ...i.freeSlots, ...i.swapSlots])) },
  { id: 'buyBoard', chapter: 'The network', title: 'A board with a network port', flag: null,
    done: (s) => ownsJackBoard(s),
    text: 'Now the board itself. The Basic board has a network port, and all your parts carry over to it. A board can only be bought while the machine is switched off, so keep it off, then open the Shop and buy it.' + BROKE,
    // The machine may still be running (an old save): the power button first, then the Shop.
    targets: (s) => (s.powered ? ['power'] : whenAffordable('board1', () => ['hud:shop', 'buy:board1'])(s)) },
  { id: 'fitBoard', chapter: 'The network', title: 'Fit the new board', flag: null,
    done: (s) => hasJack(s),
    text: 'Drag the new board onto the old one. The machine switches off for a moment to swap it, moves your parts over, and starts again by itself. If a job is running it waits for the job to finish first.',
    targets: whileSwapQueued((s) => invOf(s, 'board').flatMap((i) => [`inv:${i.id}`, ...i.freeSlots, ...i.swapSlots])) },
  { id: 'plugLan', chapter: 'The network', title: 'Plug in the network cable', flag: 'lanConnected',
    text: 'The ethernet cable joins the router to your machine. Drag its loose end from the router to the network port on the board. Unlike the other cables, this one can be plugged in while the machine is running.',
    targets: () => ['cable.lan'] },
  { id: 'linkUp', chapter: 'The network', title: 'Bring the link up', flag: 'linkUp',
    text: 'The operating system brings the connection up by itself once everything is in place. Give it a moment: the router lights up when the link is ready.',
    targets: (s) => (s.powered ? ['router'] : ['power']) },
  { id: 'firstNetJob', chapter: 'The network', title: 'Your first online job', flag: 'firstNetJob',
    text: 'Jobs now download in the background, the OS runs them one at a time, and the answers are sent back by themselves. You get paid on delivery. No more plugging in keys: just watch the monitor and wait for the first one.',
    targets: () => ['monitor'] },
  { id: 'done', chapter: null, title: 'Workshop open', flag: null,
    text: 'The workshop runs itself now. Clients send jobs over the internet and the results go back by themselves, so USB keys have stopped arriving. If the power drops, waiting jobs are kept safe on the drive. From here on it is up to you: faster plans, routers and network cards make the workshop quicker, and heavier jobs pay better.',
    targets: () => [] },
];

export const stepIndex = (id: StepId) => STEPS.findIndex((x) => x.id === id);

const anyFlag = (p: Progress) => Object.values(p).some(Boolean);

/**
 * Progress as seen by the tutorial. Normally the snapshot's sticky flags. When replaying, the flags are all true
 * already, so judge from live state and from changes against the baseline taken when the replay began.
 */
export function effectiveProgress(s: Snapshot, st: TutorialState): Progress {
  if (!st.replay) return s.progress;
  const b = st.replay;
  const has = (kind: string) => s.devices.some((d) => d.kind === kind && !d.burnt);
  const cable = (id: string) => s.cables.some((c) => c.id === id && c.connected);
  const ejected = s.completed > b.completed;
  const owned = s.devices.length + s.inventory.length;
  const done = ejected || !!s.plugged?.done;
  return {
    cpuInstalled: has('cpu'), coolerInstalled: has('cooler'), psuInstalled: has('psu'), ramInstalled: has('ram'), monitorInstalled: has('display'),
    atxConnected: cable('atx'), cpuPowerConnected: cable('cpu'), videoConnected: cable('video'), mainsConnected: cable('pcmains') && cable('monmains'),
    poweredOn: s.powered && s.phase !== 'off',
    storageInstalled: s.storage.length > 0, osInstalled: !!s.os, firstOsJob: s.progress.firstOsJob,
    firstKeyPlugged: !!s.plugged || done,
    firstManualCycle: s.completed >= b.completed + 2 || (ejected && !!s.plugged && s.powered && s.phase !== 'halted' && s.phase !== 'off'),
    firstJobDone: done,
    firstKeyEjected: ejected,
    firstPurchase: owned > b.owned,
    ispBought: s.progress.ispBought, routerInstalled: s.progress.routerInstalled, lanConnected: s.progress.lanConnected,
    linkUp: s.progress.linkUp, firstNetJob: s.progress.firstNetJob,
  };
}

/** Whether a step is complete: its flag, else its live test. */
export function isDone(step: StepDef, s: Snapshot, p: Progress, st?: TutorialState): boolean {
  if (step.ack) return !!st?.acks.includes(step.id) || p.firstManualCycle || p.firstPurchase;
  if (step.done) return step.done(s, p);
  return step.flag ? p[step.flag] : false;
}

export function tutorialActive(st: TutorialState): boolean {
  return !st.skipped && !st.finished;
}

/**
 * A player who finished the first tutorial before the OS lesson existed (or a migrated save with all of its flags). They
 * are not forced through the new steps: they get one offer card instead. Never true for a replay or for anyone with the lesson.
 */
export function legacyFinished(s: Snapshot, st: TutorialState): boolean {
  if (st.osLesson || st.replay) return false;
  return st.finished || (!st.welcomed && OLD_FLAGS.every((f) => s.progress[f]));
}

/** Show the "Next lesson: the OS" card once: a legacy player who has not answered it and did not skip the tutorial. */
export function offerNextLesson(s: Snapshot, st: TutorialState): boolean {
  return !s.sandbox && !st.skipped && !st.offered && legacyFinished(s, st);
}

/** The step to show now, or null when the tutorial is skipped, finished, or a legacy player is not taking the lesson. */
export function currentStep(s: Snapshot, st: TutorialState): StepDef | null {
  // The sandbox has no tutorial: its progress flags are all set, which would otherwise look like a finished campaign.
  if (s.sandbox || !tutorialActive(st) || legacyFinished(s, st)) return null;
  const p = effectiveProgress(s, st);
  const welcomed = st.welcomed || (!st.replay && anyFlag(p));
  if (!welcomed) return STEPS[0]!;
  for (const step of STEPS) {
    if (step.id === 'welcome' || step.id === 'done') continue;
    if (!isDone(step, s, p, st)) return step;
  }
  return STEPS[STEPS.length - 1]!;
}

/** Position of a step inside its chapter ("Build 3 of 7"), skipping the welcome and final cards. */
export function stepCount(step: StepDef): { n: number; total: number; chapter: Chapter | null } {
  if (!step.chapter) return { n: step.id === 'welcome' ? 0 : 0, total: 0, chapter: null };
  const mine = STEPS.filter((x) => x.chapter === step.chapter);
  return { n: mine.findIndex((x) => x.id === step.id) + 1, total: mine.length, chapter: step.chapter };
}

/** The first reason an inventory item of this kind cannot be fitted, or null. */
const itemReason = (s: Snapshot, kind: string): string | null => {
  const items = invOf(s, kind);
  if (!items.length) return null;
  return items.every((i) => !i.freeSlots.length) ? items[0]!.reason ?? null : null;
};

/**
 * A live "why is this not working" line for the current step (null when nothing is wrong). Uses the sim's own
 * reasons so the card explains refusals instead of leaving the player guessing.
 */
export function stepProblem(s: Snapshot, step: StepDef): string | null {
  switch (step.id) {
    case 'cpu': case 'ram': case 'psu': case 'monitor': {
      if (s.powered) return 'The machine is on. Press the power button to switch it off, then install parts.';
      const kind = step.id === 'monitor' ? 'display' : step.id;
      const items = invOf(s, kind);
      if (!items.length) return `No ${kind} in the inventory. Buy one from a part on the board.`;
      return itemReason(s, kind);
    }
    case 'cooler': {
      if (s.powered) return 'The machine is on. Press the power button to switch it off, then install parts.';
      if (s.phase === 'error' && s.postBlocker) return s.postBlocker;
      const items = invOf(s, 'cooler');
      if (!items.length) return 'No cooler in the inventory. Buy one from the cooler slot on the processor.';
      return itemReason(s, 'cooler');
    }
    case 'cables': {
      const open = s.cables.filter((c) => CABLES.some((x) => x.id === c.id) && !c.connected);
      const blocked = open.find((c) => c.blocked)?.blocked;
      if (blocked) return blocked;
      return s.powered ? 'The machine is on. Power it off before plugging cables.' : null;
    }
    case 'plugKey':
      if (!s.tray.length && !s.plugged) return 'No key yet. A client key will arrive in the tray soon.';
      return s.noPowerReason ?? (s.postBlocker && `The machine would not start: ${s.postBlocker}`) ?? (s.powered ? 'The machine is already on, so it will not look at a new key. Power it off first, then plug the key in.' : null);
    case 'watch':
      if (s.phase === 'error' && s.phaseReason) return `POST error: ${s.phaseReason}. Power off, fix it, power on again.`;
      if (s.keyIgnored || s.haltReason === 'no-boot-media') return 'The machine did not see the key: it only looks at boot. Power off, plug the key in, and power on again.';
      return s.phase === 'error' ? s.phaseReason : null;
    case 'cycle':
      if (!s.plugged) return s.tray.length ? 'Plug the next key into the USB port first.' : 'No key yet. A client key will arrive in the tray soon.';
      return s.powered ? 'Press the power button to switch off, then again to switch on: the machine reads the key at boot.' : null;
    case 'spend': {
      const cpus = cpuUpgrades(s);
      if (!cpus.length || cpus.some((p) => p.affordable)) return null;
      const cheapest = Math.min(...cpus.map((p) => p.price));
      return `Need ${fmtMoney(cheapest - s.money)} more. Finish another job to earn it.`;
    }
    case 'fit':
      return s.pendingSwap ? SWAP_WAIT : null;
    case 'fitRam':
      return s.pendingSwap ? SWAP_WAIT : itemReason(s, 'ram');
    case 'fitBoard': return s.pendingSwap ? SWAP_WAIT : itemReason(s, 'board');
    case 'fitCase': return s.pendingSwap ? SWAP_WAIT : itemReason(s, 'case');
    case 'placeRouter': return itemReason(s, 'router');
    case 'plugLan': return s.cables.find((c) => c.id === 'lan')?.blocked ?? null;
    case 'linkUp': if (!s.powered) return 'The machine is off: press the power button, the OS brings the link up once it is running.'; return s.net.state === 'link-up' || s.net.state === 'saturated' ? null : `Waiting for the link: ${s.net.reason}`;
    case 'firstNetJob': return s.net.offers.length || s.net.spooled.length ? null : 'Waiting for a client to send a job. It can take a minute or two.';
    case 'buyDrive': case 'buyRam': case 'buyOs': case 'buyIsp': case 'buyRouter': case 'buyCase': case 'buyBoard': {
      if (step.id === 'buyBoard' && s.powered && !s.purchases.find((x) => x.id === 'board1')?.locked) return 'The machine is on: press the power button to switch it off, then buy the board.';
      if (step.id === 'buyCase' && s.powered && !s.purchases.find((x) => x.id === 'case1')?.locked) return 'The machine is on: press the power button to switch it off, then buy the case.';
      const id = ({ buyDrive: 'hdd0', buyRam: 'ram1', buyOs: 'os1', buyIsp: 'isp1', buyRouter: 'router1', buyCase: 'case1', buyBoard: 'board1' } as Record<string, string>)[step.id]!;
      const p = s.purchases.find((x) => x.id === id);
      if (!p) return null;
      if (p.locked) return `Needs Level ${p.locked.level} (${p.locked.name}). Keep serving clients.`;
      if (p.blocked) return p.blocked;
      return p.affordable ? null : `Need ${fmtMoney(p.price - s.money)} more.`;
    }
    case 'drive':
      return s.pendingSwap ? SWAP_WAIT : (invOf(s, 'storage').length ? itemReason(s, 'storage') : 'No drive in the inventory. Buy one first.');
    case 'os':
      return s.pendingSwap ? SWAP_WAIT : (invOf(s, 'os').length ? itemReason(s, 'os') : 'No operating system in the inventory. Buy one first.');
    case 'bootOs':
      if (!s.powered) return 'The machine is off. Press the power button to boot from the drive.';
      return s.phase === 'error' ? s.phaseReason : s.noPowerReason ?? s.postBlocker;
    case 'osIngest':
      if (!s.powered) return 'The machine is off. Press the power button first.';
      if (s.phase === 'booting-os' || s.phase === 'posting') return 'The OS is still starting. A key plugged in meanwhile is picked up when it is idle.';
      return s.tray.length || s.plugged ? null : 'No key yet. A client key will arrive in the tray soon.';
    case 'osPaid':
      return s.phase === 'error' ? s.phaseReason : null;
    default:
      return null;
  }
}

/** Milestones added with the OS and network lessons: any of them set means the player took those lessons. */
const LESSON_FLAGS: Array<keyof Progress> = ['storageInstalled', 'osInstalled', 'firstOsJob', 'ispBought', 'routerInstalled', 'lanConnected', 'linkUp', 'firstNetJob'];

/**
 * The tutorial state for a loaded save: the one saved with it, else (an older save) derived from its flags. A save with
 * every first-lesson flag and none of the later ones is a legacy finish: not welcomed, so it gets the OS offer.
 */
export function tutorialForSave(raw: unknown, p: Progress): TutorialState {
  if (raw && typeof raw === 'object') return resumeState(raw);
  const osLesson = LESSON_FLAGS.some((f) => p[f]);
  const legacy = !osLesson && OLD_FLAGS.every((f) => p[f]);
  return { ...INITIAL_TUTORIAL, welcomed: anyFlag(p) && !legacy, osLesson, offered: osLesson };
}

export function resumeState(raw: unknown): TutorialState {
  const o = (raw ?? {}) as Partial<TutorialState>;
  const r = o.replay;
  return {
    welcomed: o.welcomed === true,
    skipped: o.skipped === true,
    finished: o.finished === true,
    replay: r && typeof r.completed === 'number' && typeof r.owned === 'number' ? { completed: r.completed, owned: r.owned } : null,
    osLesson: o.osLesson === true,
    offered: o.offered === true,
    acks: Array.isArray(o.acks) ? o.acks.filter((x): x is string => typeof x === 'string') : [],
  };
}
