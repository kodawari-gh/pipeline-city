// The floorplan of a DRAM chip's die (src/features/memory/RAM.md "Look"): what a memory chip shows once the camera is close. The banks of the stick's generation
// (`RamSpec.banks`, in `bankGroups` groups) lie in two halves either side of a centre spine; the spine holds the bond pads, the command and address decoder, the DLL, the
// refresh counter and the data I/O. A DDR5 die has two sub-channels, side by side. Each bank is a cell array with its row decoder on one side and its sense amplifiers
// under it. The live memory map (`rammap3d.ts`) lies in the banks: a bank shows the pages that the controller puts in it, one cell a page. The plan is pure data
// (`ramDiePlan`); `ramDieArt` draws it. Tested in ramdie.test.ts.
import { Container, Graphics } from 'pixi.js';
import { label, mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';

/** The plan's size in units: a DRAM package's side face in the 3D stick (`ram3d.ts`), less its edge. */
export const RAM_DIE = { w: 220, h: 170 } as const;

export interface DieRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a die's plan needs of a stick: its banks, the bank groups they sit in, its sub-channels (a DDR5 stick has two). */
export interface RamDieSpec {
  banks: number;
  bankGroups: number;
  subChannels?: number;
}

export interface RamBank {
  index: number;
  group: number;
  rect: DieRect;
}

export interface RamDiePlan {
  w: number;
  h: number;
  /** The silicon, and the spine across its middle (the pads and the logic). */
  die: DieRect;
  spine: DieRect;
  banks: RamBank[];
  /** The blocks of the spine, left to right (a DDR5 die: both sub-channels'). */
  logic: { id: string; label: string; rect: DieRect }[];
  /** The x of the line between two sub-channels, or null (one channel). */
  divide: number | null;
  subChannels: number;
  bankGroups: number;
}

const M = 6,
  SPINE = 22,
  GAP = 3;

/** The plan of a die with the banks of `spec`: half of them above the spine, half under, `cols` across (at most four), a bank group the next `banks / bankGroups` in turn. */
export function ramDiePlan(spec: RamDieSpec): RamDiePlan {
  const w = RAM_DIE.w,
    h = RAM_DIE.h,
    banks = Math.max(2, spec.banks),
    groups = Math.max(1, Math.min(spec.bankGroups, banks)),
    sub = spec.subChannels && spec.subChannels > 1 ? 2 : 1;
  const die = { x: M, y: M, w: w - 2 * M, h: h - 2 * M };
  const spine = { x: die.x, y: die.y + (die.h - SPINE) / 2, w: die.w, h: SPINE };
  const half = banks / 2,
    cols = Math.min(4, half),
    rows = Math.ceil(half / cols);
  const top = { x: die.x + GAP, y: die.y + GAP, w: die.w - 2 * GAP, h: spine.y - die.y - 2 * GAP },
    bottom = { x: top.x, y: spine.y + SPINE + GAP, w: top.w, h: top.h };
  const bw = (top.w - (cols - 1) * GAP) / cols,
    bh = (top.h - (rows - 1) * GAP) / rows,
    per = banks / groups,
    out: RamBank[] = [];
  for (let i = 0; i < banks; i++) {
    const inHalf = i % half,
      c = inHalf % cols,
      r = Math.floor(inHalf / cols),
      area = i < half ? top : bottom;
    out.push({
      index: i,
      group: Math.floor(i / per),
      rect: { x: area.x + c * (bw + GAP), y: area.y + r * (bh + GAP), w: bw, h: bh },
    });
  }
  // the spine's blocks: command and address, the clock's DLL, the refresh counter, the data I/O (twice over, on a die with two sub-channels)
  const names = ['CMD / ADDR', 'DLL', 'REFRESH', 'DATA I/O'],
    share = [0.3, 0.16, 0.2, 0.34],
    logic: RamDiePlan['logic'] = [];
  const side = (x0: number, w0: number, tag: string) => {
    let x = x0 + 3;
    names.forEach((n, i) => {
      const bwid = (w0 - 6) * share[i]! - 2;
      logic.push({ id: `${tag}${i}`, label: n, rect: { x, y: spine.y + 3, w: bwid, h: SPINE - 6 } });
      x += bwid + 2;
    });
  };
  if (sub === 2) {
    side(die.x, die.w / 2, 'a');
    side(die.x + die.w / 2, die.w / 2, 'b');
  } else side(die.x, die.w, 'a');
  return {
    w,
    h,
    die,
    spine,
    banks: out,
    logic,
    divide: sub === 2 ? die.x + die.w / 2 : null,
    subChannels: sub,
    bankGroups: groups,
  };
}

/** The pages of a chip's window, a bank holds `perBank` of them: the cell (bank, k-th page of it) of page `q` of the window with `channels` controller channels over `banks` banks (a page lands in bank `(q / channels) % banks`). */
export function pageSlot(q: number, channels: number, banks: number): { bank: number; k: number } {
  const ch = Math.max(1, channels),
    b = Math.max(1, banks);
  return { bank: Math.floor(q / ch) % b, k: Math.floor(q / (ch * b)) * ch + (q % ch) };
}

/** The cell of the k-th page among `n` in a bank (a column of cells, one a page), inside the bank's own rect less its row decoder (left) and sense amplifiers (bottom). */
export function bankCell(bank: DieRect, k: number, n: number): DieRect {
  const x = bank.x + 5,
    y = bank.y + 1.5,
    w = bank.w - 7,
    h = bank.h - 6;
  const ch = h / Math.max(1, n);
  return { x, y: y + k * ch, w, h: Math.max(0.8, ch) };
}

/** The die's art, in the plan's units: the silicon with its rim and bond pads, the banks in their groups, the spine's logic, the names. */
export function ramDieArt(T: Theme, plan: RamDiePlan): Container {
  const root = new Container(),
    g = new Graphics(),
    t = new Container(),
    accent = T.ld;
  root.addChild(g, t);
  const d = plan.die;
  g.roundRect(0, 0, plan.w, plan.h, 5).fill({ color: mix(T.die, '#000000', 0.45) });
  g.roundRect(d.x, d.y, d.w, d.h, 4)
    .fill({ color: mix(T.die, '#000000', 0.2) })
    .stroke({ width: 1.2, color: mix(T.line, accent, 0.6) });
  // the pads down the middle of the spine, as on a real chip's centre row
  const pad = 2.2;
  for (let x = d.x + 6; x + pad < d.x + d.w - 4; x += pad * 2.4)
    g.rect(x, plan.spine.y + plan.spine.h / 2 - pad / 2, pad, pad);
  g.fill({ color: T.pin, alpha: 0.7 });
  g.poly([d.x + 1, d.y + 1, d.x + 12, d.y + 1, d.x + 1, d.y + 12]).fill({ color: accent, alpha: 0.9 });
  // the banks, a bank group in one tint, the next in another
  const tints = [T.ld, T.mul, T.st, T.alu];
  for (const b of plan.banks) {
    const c = tints[b.group % tints.length]!,
      r = b.rect;
    g.roundRect(r.x, r.y, r.w, r.h, 1.5)
      .fill({ color: mix(T.die, c, 0.12) })
      .stroke({ width: 0.9, color: c, alpha: 0.85 });
    // the cell array's word lines, the row decoder on its west side, the sense amplifiers along its foot
    for (let y = r.y + 3; y < r.y + r.h - 5; y += 2.6) g.moveTo(r.x + 5, y).lineTo(r.x + r.w - 1.5, y);
    g.stroke({ width: 0.35, color: c, alpha: 0.32 });
    g.rect(r.x + 0.8, r.y + 0.8, 3.4, r.h - 1.6).fill({ color: c, alpha: 0.4 });
    g.rect(r.x + 5, r.y + r.h - 4, r.w - 6.5, 3).fill({ color: c, alpha: 0.55 });
    if (r.w >= 30 && r.h >= 15)
      t.addChild(label(`B${b.index}`, r.x + 7, r.y + 5.5, 5.5, T.ink, { weight: '700', a: 0.85 }));
  }
  // the spine's logic
  const lc = [T.br, T.mute, T.ld, T.alu];
  for (const [i, l] of plan.logic.entries()) {
    const c = lc[i % 4]!,
      r = l.rect;
    g.roundRect(r.x, r.y, r.w, r.h, 1.5)
      .fill({ color: mix(T.die, c, 0.16) })
      .stroke({ width: 0.8, color: c, alpha: 0.85 });
    if (r.w >= 24)
      t.addChild(
        label(l.label, r.x + 2.5, r.y + 4, Math.min(5.2, (r.w - 4) / (l.label.length * 0.62)), T.ink, {
          weight: '700',
          a: 0.9,
        }),
      );
  }
  // (two sub-channels: a line down the middle, each side with a spine of its own)
  if (plan.divide !== null)
    g.moveTo(plan.divide, d.y + 1)
      .lineTo(plan.divide, d.y + d.h - 1)
      .stroke({ width: 0.9, color: accent, alpha: 0.75 });
  return root;
}
