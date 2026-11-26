// What the player does on each tutorial step, for tutorial.e2e.mjs: one round of play on the step the card shows.
/// <reference path="../browser.d.ts" />
import { center } from './player.mjs';

/**
 * @typedef {import('./steps.mjs').Player} Player
 * @typedef {(pl: Player, s: GameSnapshot, id: string) => Promise<unknown>} Act
 */

/**
 * @param {GameSnapshot} s
 * @param {string} kind
 */
const inv = (s, kind) => s.inventory.find((x) => x.kind === kind);

/** @param {Player} pl */
const idle = async (pl) => pl.p.waitForTimeout(800);

/**
 * Drag the inventory item of `kind` to the first slot it fits, free or to swap; else wait.
 * @param {Player} pl
 * @param {GameSnapshot} s
 * @param {string} kind
 */
async function fitOrWait(pl, s, kind) {
  const it = inv(s, kind);
  await (it && it.freeSlots.length + it.swapSlots.length > 0
    ? pl.dragPart(it.id, it.freeSlots[0] ?? it.swapSlots[0])
    : idle(pl));
}

/** @type {Act} cpu, cooler, ram, psu, monitor: drag the part to its free slot */
async function fitPart(pl, s, id) {
  const it = inv(s, id === 'monitor' ? 'display' : id);
  const slot = it?.freeSlots[0];
  if (it && slot !== undefined && slot !== '') {
    await pl.dragPart(it.id, slot);
  }
}

/** @type {Act} the heatsink's own fan spots (the card highlights them); another free fan slot, on the case, is not the step's */
async function fitFan(pl, s) {
  const it = inv(s, 'fan');
  const hl = await pl.p.evaluate(async () => {
    const m = await import('/src/app/interaction.ts');
    return m.highlight.value;
  });
  const slot = it?.freeSlots.find((x) => hl.includes(x));
  await (it && slot !== undefined && slot !== '' ? pl.dragPart(it.id, slot) : idle(pl));
}

/**
 * Plug the first of `kinds` whose cable is not connected.
 * @param {Player} pl
 * @param {GameSnapshot} s
 * @param {string[]} kinds
 */
async function plugFirst(pl, s, kinds) {
  const next = kinds.find((k) => s.cables.find((c) => c.id === k)?.connected !== true);
  if (next !== undefined) {
    await pl.dragCable(next);
  }
}

/** @type {Act} plugKey, cycle, osIngest: plug the first key of the tray */
async function plugKey(pl, s) {
  const k = s.tray.at(0);
  if (!s.plugged && k) {
    const a = await pl.anchor(`key:${k.id}`);
    const u = await pl.anchor('usb');
    if (a && u) {
      await pl.dragTo(center(a), center(u));
    }
  } else {
    await idle(pl);
  }
}

/** @type {Act} fit: any part of the machine's kinds that fits a slot */
async function fitAny(pl, s) {
  const it = s.inventory.find(
    (x) => x.freeSlots.length + x.swapSlots.length > 0 && ['cpu', 'ram', 'psu', 'cooler', 'display'].includes(x.kind),
  );
  await (it ? pl.dragPart(it.id, it.freeSlots[0] ?? it.swapSlots[0]) : idle(pl));
}

/** @type {Act} bootOs, linkUp: power the machine on */
async function powerOn(pl, s) {
  await (s.powered ? idle(pl) : pl.clickAnchor('power'));
}

/** @type {Act} buyCase, buyBoard: a case, like a board, can only be bought with the machine off */
async function buyOff(pl, s) {
  if (s.powered) {
    await pl.clickAnchor('power');
    await pl.p.waitForTimeout(1500);
  } else {
    await pl.buyInShop();
  }
}

/** @type {Act} placeRouter */
async function placeRouter(pl, s) {
  const it = inv(s, 'router');
  if (it) {
    await pl.dragPart(it.id, it.freeSlots[0] ?? 'router');
  }
}

/** @type {Act} reachLevel4: the client base grows by delivering, with the OS the keys stay in: plug the next one */
async function reachLevel4(pl, s) {
  if (!s.powered) {
    await pl.clickAnchor('power');
  } else if (!(await pl.serve(s))) {
    await idle(pl);
  }
}

/** @type {Act} reachLevel3: the client base grows by delivering: a player keeps the keys coming */
async function reachLevel3(pl, s) {
  if (!(await pl.serve(s))) {
    await idle(pl);
  }
}

/** @type {Act} the Shop, then the glowing tile in it (the picker shows no ladder now: parts are bought in the Shop) */
const shop = async (pl) => pl.buyInShop();
/** @type {Act} */
const dialogue = async (pl) => pl.finishDialogue();

/** The inventory kind each fitting step drags. */
const FIT_KIND = { drive: 'storage', os: 'os', fitRam: 'ram', fitCase: 'case', fitBoard: 'board' };

/** @type {Map<string, Act>} */
const ACTS = new Map();
/**
 * @param {string[]} ids
 * @param {Act} a
 */
const on = (ids, a) => {
  for (const k of ids) {
    ACTS.set(k, a);
  }
};
on(['cpu', 'cooler', 'ram', 'psu', 'monitor'], fitPart);
on(['fan'], fitFan);
on(['cables'], async (pl, s) => plugFirst(pl, s, ['atx', 'cpu', 'cpufan', 'video']));
on(['wall'], async (pl, s) => plugFirst(pl, s, ['pcmains', 'monmains']));
on(['plugKey', 'cycle', 'osIngest'], plugKey);
on(['money', 'reputation', 'level'], dialogue);
on(['spend', 'buyIsp', 'buyRouter', 'buyDrive', 'buyOs', 'buyRam'], shop);
on(['fit'], fitAny);
for (const [k, kind] of Object.entries(FIT_KIND)) {
  on([k], async (pl, s) => fitOrWait(pl, s, kind));
}
on(['bootOs', 'linkUp'], powerOn);
on(['placeRouter'], placeRouter);
on(['buyCase', 'buyBoard'], buyOff);
on(['plugLan'], async (pl) => pl.dragCable('lan'));
on(['reachLevel4'], reachLevel4);
on(['reachLevel3'], reachLevel3);

/**
 * One round of play on step `id`. Other steps (watch, osPaid): the game does the work (plugging the next key now would skip a lesson).
 * @type {Act}
 */
export const act = async (pl, s, id) => (ACTS.get(id) ?? idle)(pl, s, id);
