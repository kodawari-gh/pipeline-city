// The brand design sheets (docs/brands/<id>.png and roster.png), drawn from the brand modules themselves so a sheet cannot drift from the
// code. `npm run brands` opens this page per brand (tools/brandsheet.mjs) and saves the canvas. `?id=<brand>` one sheet, `?id=roster` all.
import * as brands from '../../src/core/render/brands';
import { setType } from '../../src/core/render/brands/type';

const UI = 'Bahnschrift, "Segoe UI", Arial, sans-serif';
const VOID = '#04060f',
  INK = '#e2eaff',
  MUTE = '#a6b4da',
  LINE = '#2a366a';

const cv = document.querySelector('#c');
if (!(cv instanceof HTMLCanvasElement)) {
  throw new TypeError('the sheet page has no canvas #c');
}
const ctx = cv.getContext('2d');
if (ctx === null) {
  throw new Error('the sheet canvas has no 2D context');
}
const c = ctx;

/** Where and how a line of text goes: its baseline's start (`x`, `y`), its size (`px`), colour, weight and alignment. */
interface TextAt {
  x: number;
  y: number;
  px: number;
  color?: string;
  weight?: number;
  align?: CanvasTextAlign;
}

/** A box: its top left corner and its size. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A lockup's place: its centre (`cx`, `cy`) and the box it fits in (`w` wide, the mark at most `h` tall), in `ink`. */
interface FitAt {
  cx: number;
  cy: number;
  w: number;
  h: number;
  ink: string;
  o?: brands.LockupOpts;
}

function lum(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

function text(s: string, { x, y, px, color = MUTE, weight = 400, align = 'left' }: TextAt) {
  c.font = `${weight} ${px}px ${UI}`;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.fillText(s, x, y);
}
function panel({ x, y, w, h }: Box, fill: string, label?: string) {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
  c.strokeStyle = LINE;
  c.lineWidth = 1;
  c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (label !== undefined && label !== '') {
    text(label, { x: x + 14, y: y + h - 12, px: 13, color: lum(fill) > 0.5 ? '#2a2d32' : MUTE });
  }
}
/** A lockup fitted into a box: the mark at most `h` tall and the whole at most `w` wide, centred. */
function fit(id: brands.BrandId, { cx, cy, w, h, ink, o = {} }: FitAt) {
  const m = Math.min(h, (h * w) / brands.lockupWidth(id, h, o));
  brands.drawLockup(c, id, cx, cy, m, ink, { ...o, align: 'center' });
}

/** The title (the name in its own type, what it makes and what its mark means), the primary lockup on its plate, the mark on a construction grid. */
function primary(id: brands.BrandId, W: number) {
  const b = brands.BRANDS[id],
    k = b.colors;
  brands.drawWord(c, id, 40, 52, 34, INK);
  text(`${b.makes}  ·  ${b.idea}`, { x: 40, y: 104, px: 18 });
  text(`brands/${id}.ts`, { x: W - 40, y: 60, px: 15, align: 'right' });
  panel({ x: 40, y: 130, w: 1000, h: 380 }, k.plate, 'Primary lockup, on its plate');
  fit(id, { cx: 540, cy: 310, w: 860, h: 170, ink: k.light });
  panel({ x: 1060, y: 130, w: 500, h: 380 }, k.plate, 'Mark, on its unit grid');
  const mh = 250,
    mw = mh * b.aspect,
    mx = 1310 - mw / 2,
    my = 320 - mh / 2;
  c.strokeStyle = 'rgba(166,180,218,0.22)';
  c.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    c.beginPath();
    c.moveTo(mx, my + (mh * i) / 4);
    c.lineTo(mx + mw, my + (mh * i) / 4);
    c.stroke();
  }
  for (let i = 0; i <= Math.round(b.aspect * 4); i++) {
    const x = mx + Math.min(mw, (mh * i) / 4);
    c.beginPath();
    c.moveTo(x, my);
    c.lineTo(x, my + mh);
    c.stroke();
  }
  brands.drawMark(c, id, mx, my, mh, k.light);
}

/** The scheme: each colour's swatch, its name, its hex and its use. */
function scheme(id: brands.BrandId) {
  const k = brands.BRANDS[id].colors;
  const sw: [string, string, string][] = [
    ['accent', k.accent, 'its one neon: the mark, lit letters, LEDs'],
    ['light', k.light, 'ink on dark'],
    ['dark', k.dark, 'ink on light'],
    ['plate', k.plate, 'badges, stickers'],
    ['body', k.body, "its parts' finish"],
    ['trim', k.trim, 'its metal'],
  ];
  for (const [i, [name, hex, use]] of sw.entries()) {
    const x = 40 + i * 255,
      y = 530;
    c.fillStyle = hex;
    c.fillRect(x, y, 240, 90);
    c.strokeStyle = LINE;
    c.strokeRect(x + 0.5, y + 0.5, 239, 89);
    text(name, { x, y: y + 116, px: 17, color: INK, weight: 600 });
    text(hex, { x: x + 240, y: y + 116, px: 17, align: 'right' });
    text(use, { x, y: y + 138, px: 13 });
  }
}

/** The prints: one-tone etch on its body, a white sticker, a deboss in charcoal, small sizes. */
function prints(id: brands.BrandId) {
  const b = brands.BRANDS[id],
    k = b.colors;
  const y = 690,
    h = 210;
  panel({ x: 40, y, w: 370, h }, k.body, 'Etch on its body (one tone)');
  const etch = lum(k.body) > 0.35 ? '#2a2d32' : '#959aa3';
  fit(id, { cx: 225, cy: y + h / 2 - 12, w: 300, h: 80, ink: etch, o: { acc: null } });
  panel({ x: 425, y, w: 370, h }, '#e9ebee', 'Sticker (dark ink, lit mark)');
  fit(id, { cx: 610, cy: y + h / 2 - 12, w: 300, h: 80, ink: k.dark });
  panel({ x: 810, y, w: 370, h }, '#2a2d32', 'Deboss in charcoal');
  fit(id, { cx: 995, cy: y + h / 2 - 10, w: 300, h: 80, ink: '#4e5360', o: { acc: null } });
  fit(id, { cx: 995, cy: y + h / 2 - 12, w: 300, h: 80, ink: '#050608', o: { acc: null } });
  panel({ x: 1195, y, w: 365, h }, k.plate, 'Small: 48, 24, 12 px; 20 px lockup');
  let x = 1215;
  for (const s of [48, 24, 12]) {
    brands.drawMark(c, id, x, y + 30 + (48 - s) / 2, s, k.light);
    x += s * b.aspect + 22;
  }
  brands.drawLockup(c, id, 1215, y + 128, 20, k.light);
}

/** The type: the brand's cut of the family. */
function typeCut(id: brands.BrandId) {
  const b = brands.BRANDS[id],
    xh = b.type.xh ?? 0;
  panel({ x: 40, y: 920, w: 1520, h: 240 }, VOID);
  text(
    `Type: weight ${b.type.s}, round ${b.type.round}, width ${b.type.wide}, lean ${b.type.slant}, tracking ${b.type.track}${b.type.ends === 'soft' ? ', soft ends' : ''}${xh === 0 ? '' : `, x-height ${xh}`}  (specimen tracking at most 0.12)`,
    { x: 54, y: 944, px: 13 },
  );
  const lower = b.word !== b.word.toUpperCase(),
    st = { ...b.type, track: Math.min(b.type.track, 0.12) };
  setType(c, lower ? 'abcdefghijklmnopqrstuvwxyz' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', st, 70, 1000, 44, INK);
  setType(
    c,
    lower ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '0123456789 -/.+×',
    st,
    70,
    lower ? 1074 : 1090,
    lower ? 30 : 44,
    MUTE,
  );
  if (lower) {
    setType(c, '0123456789 -/.+×', st, 70, 1124, 30, MUTE);
  }
}

function sheet(id: brands.BrandId) {
  const W = 1600,
    H = 1180;
  cv.width = W;
  cv.height = H;
  c.fillStyle = VOID;
  c.fillRect(0, 0, W, H);
  primary(id, W);
  scheme(id);
  prints(id);
  typeCut(id);
}

function roster() {
  const W = 1600,
    cols = 2,
    cw = 760,
    ch = 170,
    H = 40 + Math.ceil(brands.BRAND_IDS.length / cols) * (ch + 20) + 20;
  cv.width = W;
  cv.height = H;
  c.fillStyle = VOID;
  c.fillRect(0, 0, W, H);
  for (const [i, id] of brands.BRAND_IDS.entries()) {
    const b = brands.BRANDS[id],
      x = 40 + (i % cols) * (cw + 40),
      y = 40 + Math.floor(i / cols) * (ch + 20);
    panel({ x, y, w: cw, h: ch }, b.colors.plate);
    fit(id, { cx: x + cw * 0.42, cy: y + ch / 2, w: cw * 0.66, h: 80, ink: b.colors.light });
    text(id, { x: x + cw - 16, y: y + 30, px: 15, color: INK, weight: 600, align: 'right' });
    text(b.makes, { x: x + cw - 16, y: y + 52, px: 13, align: 'right' });
    c.fillStyle = b.colors.accent;
    c.fillRect(x + cw - 46, y + ch - 46, 30, 30);
  }
}

const id = new URLSearchParams(location.search).get('id') ?? 'roster';
await document.fonts.ready;
if (id === 'roster') {
  roster();
} else {
  const brand = brands.BRAND_IDS.find((b) => b === id);
  if (brand === undefined) {
    throw new Error(`no brand ${id}`);
  }
  sheet(brand);
}
document.body.dataset['done'] = '1';
