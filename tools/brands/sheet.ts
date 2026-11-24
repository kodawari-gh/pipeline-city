// The brand design sheets (docs/brands/<id>.png and roster.png), drawn from the brand modules themselves so a sheet cannot drift from the
// code. `npm run brands` opens this page per brand (tools/brandsheet.mjs) and saves the canvas. `?id=<brand>` one sheet, `?id=roster` all.
import {
  BRANDS,
  BRAND_IDS,
  drawLockup,
  drawMark,
  drawWord,
  lockupWidth,
  type BrandId,
} from '../../src/core/render/brands';
import { setType } from '../../src/core/render/brands/type';

const UI = 'Bahnschrift, "Segoe UI", Arial, sans-serif';
const VOID = '#04060f',
  INK = '#e2eaff',
  MUTE = '#a6b4da',
  LINE = '#2a366a';

const cv = document.getElementById('c') as HTMLCanvasElement,
  c = cv.getContext('2d')!;

function text(
  s: string,
  x: number,
  y: number,
  px: number,
  color = MUTE,
  weight = 400,
  align: CanvasTextAlign = 'left',
) {
  c.font = `${weight} ${px}px ${UI}`;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.fillText(s, x, y);
}
function panel(x: number, y: number, w: number, h: number, fill: string, label?: string) {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
  c.strokeStyle = LINE;
  c.lineWidth = 1;
  c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (label) text(label, x + 14, y + h - 12, 13, lum(fill) > 0.5 ? '#2a2d32' : MUTE);
}
/** A lockup fitted into a box: the mark at most `h` tall and the whole at most `w` wide, centred. */
function fit(
  id: BrandId,
  cx: number,
  cy: number,
  w: number,
  h: number,
  ink: string,
  o: Parameters<typeof drawLockup>[6] = {},
) {
  const m = Math.min(h, (h * w) / lockupWidth(id, h, o));
  drawLockup(c, id, cx, cy, m, ink, { ...o, align: 'center' });
}

function sheet(id: BrandId) {
  const b = BRANDS[id],
    k = b.colors,
    W = 1600,
    H = 1180;
  cv.width = W;
  cv.height = H;
  c.fillStyle = VOID;
  c.fillRect(0, 0, W, H);

  // the title: the name in its own type, what it makes and what its mark means
  drawWord(c, id, 40, 52, 34, INK);
  text(`${b.makes}  ·  ${b.idea}`, 40, 104, 18, MUTE);
  text(`brands/${id}.ts`, W - 40, 60, 15, MUTE, 400, 'right');

  // the primary lockup on its plate, the mark on a construction grid
  panel(40, 130, 1000, 380, k.plate, 'Primary lockup, on its plate');
  fit(id, 540, 310, 860, 170, k.light);
  panel(1060, 130, 500, 380, k.plate, 'Mark, on its unit grid');
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
  drawMark(c, id, mx, my, mh, k.light);

  // the scheme
  const sw: [string, string, string][] = [
    ['accent', k.accent, 'its one neon: the mark, lit letters, LEDs'],
    ['light', k.light, 'ink on dark'],
    ['dark', k.dark, 'ink on light'],
    ['plate', k.plate, 'badges, stickers'],
    ['body', k.body, "its parts' finish"],
    ['trim', k.trim, 'its metal'],
  ];
  sw.forEach(([name, hex, use], i) => {
    const x = 40 + i * 255,
      y = 530;
    c.fillStyle = hex;
    c.fillRect(x, y, 240, 90);
    c.strokeStyle = LINE;
    c.strokeRect(x + 0.5, y + 0.5, 239, 89);
    text(name, x, y + 116, 17, INK, 600);
    text(hex, x + 240, y + 116, 17, MUTE, 400, 'right');
    text(use, x, y + 138, 13, MUTE);
  });

  // the prints: one-tone etch on its body, a white sticker, a deboss in charcoal, small sizes
  const y = 690,
    h = 210;
  panel(40, y, 370, h, k.body, 'Etch on its body (one tone)');
  const etch = lum(k.body) > 0.35 ? '#2a2d32' : '#959aa3';
  fit(id, 225, y + h / 2 - 12, 300, 80, etch, { acc: null });
  panel(425, y, 370, h, '#e9ebee', 'Sticker (dark ink, lit mark)');
  fit(id, 610, y + h / 2 - 12, 300, 80, k.dark);
  panel(810, y, 370, h, '#2a2d32', 'Deboss in charcoal');
  fit(id, 995, y + h / 2 - 10, 300, 80, '#4e5360', { acc: null });
  fit(id, 995, y + h / 2 - 12, 300, 80, '#050608', { acc: null });
  panel(1195, y, 365, h, k.plate, 'Small: 48, 24, 12 px; 20 px lockup');
  let x = 1215;
  for (const s of [48, 24, 12]) {
    drawMark(c, id, x, y + 30 + (48 - s) / 2, s, k.light);
    x += s * b.aspect + 22;
  }
  drawLockup(c, id, 1215, y + 128, 20, k.light);

  // the type: the brand's cut of the family
  panel(40, 920, 1520, 240, VOID);
  text(
    `Type: weight ${b.type.s}, round ${b.type.round}, width ${b.type.wide}, lean ${b.type.slant}, tracking ${b.type.track}${b.type.ends === 'soft' ? ', soft ends' : ''}${b.type.xh ? `, x-height ${b.type.xh}` : ''}  (specimen tracking at most 0.12)`,
    54,
    944,
    13,
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
  if (lower) setType(c, '0123456789 -/.+×', st, 70, 1124, 30, MUTE);
}

function roster() {
  const W = 1600,
    cols = 2,
    cw = 760,
    ch = 170,
    H = 40 + Math.ceil(BRAND_IDS.length / cols) * (ch + 20) + 20;
  cv.width = W;
  cv.height = H;
  c.fillStyle = VOID;
  c.fillRect(0, 0, W, H);
  BRAND_IDS.forEach((id, i) => {
    const b = BRANDS[id],
      x = 40 + (i % cols) * (cw + 40),
      y = 40 + Math.floor(i / cols) * (ch + 20);
    panel(x, y, cw, ch, b.colors.plate);
    fit(id, x + cw * 0.42, y + ch / 2, cw * 0.66, 80, b.colors.light);
    text(id, x + cw - 16, y + 30, 15, INK, 600, 'right');
    text(b.makes, x + cw - 16, y + 52, 13, MUTE, 400, 'right');
    c.fillStyle = b.colors.accent;
    c.fillRect(x + cw - 46, y + ch - 46, 30, 30);
  });
}

function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

const id = new URLSearchParams(location.search).get('id') ?? 'roster';
await document.fonts.ready;
if (id === 'roster') roster();
else sheet(id as BrandId);
document.body.dataset.done = '1';
