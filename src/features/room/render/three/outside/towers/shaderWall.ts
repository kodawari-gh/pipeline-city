// The facade shader's colour for a wall (`facade.ts`, after three's color_fragment): its windows and the rooms behind them, its make, its
// light by day and by night, and what its glass mirrors. The other kinds follow it (`shaderKinds.ts`), the `if`'s other branches.

/** The colour chunk's start: its outputs, the vertex's kind, the sky's light down a wall, then a facade's or a home's wall. */
export const FRAG_WALL = `#include <color_fragment>
float fRough = 0.85, fMetal = 0.0, fVis = 1.0, fSpec = 1.0;
vec3 fGlow = vec3(0.0), fTilt = vec3(0.0);
int fKind = int(vAux.y + 0.5);
// the sky's light falls off down a wall: at the street's level the blocks across hide most of it
float fAo = 0.4 + 0.6 * smoothstep(0.0, 26.0, vFW.y);
if (fKind == 0 || fKind == 6) {
  vec2 g = vFuv / vLook.xy, id = floor(g), f = fract(g), fw = fwidth(g);
  float home = fKind == 6 ? 1.0 : 0.0, seed = vAux.x, refl = vAux.z;
  float h = fHash(id + seed), h2 = fHash(id * 1.37 + seed + 7.1), h3 = fHash(id * 2.71 + seed * 0.13 + 3.3);
  // how much of each scale a pixel covers: a bay across, a floor up; the detail in a window (its room, its blind's edge) goes first. Each
  // pattern fades to its average where its scale is under the pixel, so the far city does not shimmer
  float cx = smoothstep(0.1, 0.35, fw.x), cy = smoothstep(0.1, 0.35, fw.y), cf = max(cx, cy);
  float fine = smoothstep(0.05, 0.18, max(fw.x, fw.y));
  // the window; the ground floor's shop windows are wider and down to the pavement, a fascia over them, and more of them lit
  float shop = 1.0 - step(0.5, id.y);
  vec2 win = mix(vLook.zw, vec2(0.94, 0.66), shop);
  vec2 lo = vec2(0.5 - 0.5 * win.x, mix((1.0 - win.y) * 0.6, 0.05, shop)), hi = lo + win;
  vec2 e = mix(smoothstep(lo - fw, lo + fw, f) - smoothstep(hi - fw, hi + fw, f), win, vec2(cx, cy));
  float m = e.x * e.y;
  vec2 o = clamp((f - lo) / win, 0.0, 1.0), ow = fw / win;
  // a wide window's lites on slim dark mullions, a metre or so apart
  float wm = win.x * vLook.x, lite = wm / max(1.0, floor(wm / 1.2 + 0.5)), mpx = fw.x * vLook.x;
  float mull = smoothstep(0.035 + mpx, 0.035 - mpx, (0.5 - abs(fract(o.x * wm / lite) - 0.5)) * lite);
  mull = mix(mull, 0.07 / lite, smoothstep(0.1, 0.35, mpx / lite)) * m;
  m -= mull;
  // who is in. Each building has its share of lit rooms and its own habit: an office lit in whole floors, in zones of a few bays, desk by
  // desk, or in stacks a few floors high; a home room by room. The rooms in use gather in patches up and along a wall. A zone now and then
  // turns its lights on or off, each on its own slow clock. Far off a zone's ends soften into its neighbours
  float habit = fHash(vec2(floor(seed) * 0.37, 21.7));
  float share = 0.06 + 0.42 * fHash(vec2(seed * 0.731, 5.3));
  float zw = home > 0.5 ? 1.0 + step(0.55, fHash(vec2(seed, 8.7))) : habit < 0.2 ? 7.0 + floor(8.0 * fHash(vec2(seed, 8.1))) : habit < 0.55 ? 2.0 + floor(4.0 * fHash(vec2(seed, 8.1))) : habit < 0.8 ? 1.0 : 2.0 + floor(2.0 * fHash(vec2(seed, 8.1)));
  float zh = home < 0.5 && habit >= 0.8 ? 3.0 + floor(6.0 * fHash(vec2(seed, 19.3))) : 1.0;
  float zone = floor(id.x / zw), fl = floor(id.y / zh), cz = smoothstep(0.08, 0.25, fw.x / zw), cv = smoothstep(0.1, 0.35, fw.y / zh), cr = max(cz, cv);
  float gather = fGather(vFuv, seed), gatherZ = fGather(vec2(zone * zw * vLook.x, fl * zh * vLook.y), seed);
  float rf = fHash(vec2(fl * 0.37 + seed, 2.9)), zlit, zt = fract(vFuv.x / (vLook.x * zw)), zs = 0.5 * smoothstep(0.04, 0.16, fw.x / zw);
  float occ = home > 0.5 ? share * gatherZ : min(1.0, share * 2.6 * rf * rf * gatherZ);
  float swN = floor(fTime / (70.0 + 170.0 * fHash(vec2(zone + seed, fl + 1.7))) + fHash(vec2(fl + seed, zone + 2.3)));
  zlit = abs(step(fHash(vec2(zone * 1.91 + seed, fl * 0.83 + 4.7)), occ) - step(0.94, fHash(vec2(zone * 3.1 + seed + swN * 0.77, fl * 1.3 + 6.1))));
  if (zs > 0.0) zlit = mix(zlit, 0.5 * (zlit + step(fHash(vec2((zt < 0.5 ? zone - 1.0 : zone + 1.0) * 1.91 + seed, fl * 0.83 + 4.7)), occ)), smoothstep(zs, 0.0, min(zt, 1.0 - zt)));
  float lit = mix(mix(zlit, occ, cz), share * gather * mix(0.86, 1.0, home), cv);
  lit *= mix(mix(step(h3, 0.9), 0.9, cx), 1.0, home);
  // a dark room still shows a little: a corridor's light, an exit sign, a standby lamp
  lit = max(lit, 0.05);
  // a shop, a few bays wide: open or shut as one, in its own light, most of them warm, some the city's neon
  float sw = 1.0 + floor(3.0 * fHash(vec2(seed, 13.7))), sid = floor(id.x / sw), hs = fHash(vec2(sid + seed * 2.3, 11.3)), sOpen = step(fHash(vec2(sid + seed, 17.1)), 0.8);
  vec3 sCol = hs < 0.5 ? vec3(1.0, 0.8, 0.58) : hs < 0.64 ? vec3(0.3, 0.8, 1.0) : hs < 0.78 ? vec3(1.0, 0.58, 0.2) : hs < 0.92 ? vec3(1.0, 0.32, 0.2) : vec3(1.0, 0.26, 0.64);
  sCol = mix(sCol, vec3(1.0, 0.7, 0.5), cx);
  lit = mix(lit, mix(sOpen, 0.8, cx), shop);
  // the light: each building has its own warmth, an office's from cold to neutral, a home's from neutral to a warm bulb, each zone a little off
  // it and at its own brightness; a few a fluorescent green or a screen's blue. A curtain wall's glass tints it. Far off, the building's own
  float hc = fHash(vec2(zone + seed * 3.1, fl + 9.2)), bt = fHash(vec2(floor(seed) * 0.61, 33.1));
  float kz = mix(0.55 + 0.7 * fHash(vec2(hc, 3.7)), 1.0, cr) * (0.72 + 0.56 * fHash(vec2(floor(seed) * 0.43, 41.9)));
  vec3 lamp = fLampCol(mix(0.68 * bt, 0.55 + 0.45 * bt, home) + (hc - 0.5) * 0.55 * (1.0 - cr));
  lamp = mix(lamp, mix(vec3(0.7, 1.0, 0.82), vec3(0.42, 0.56, 1.0), home), step(0.95, hc) * (1.0 - cr));
  lamp = mix(lamp, sCol, shop) * mix(vec3(1.0), vTint / max(max(vTint.r, vTint.g), max(vTint.b, 1e-3)), refl * 0.5 * (1.0 - shop));
  // the room behind the pane in depth (interior mapping): the eye's ray goes on into a box the room's size (its bays wide, a storey high, a
  // few metres deep) and meets its back wall, a side wall, the floor or the ceiling, an office's desks, a home's sofa or its lamp's shade.
  // Its colour by day (dark, lit from the window), its light at night (where the room's lamps put it); far off, their averages
  float rw = zw * vLook.x, rc = hi.y * vLook.y + 0.12, hr = fHash(vec2(zone + seed, id.y + 0.5));
  float dep = home > 0.5 ? 3.4 + 1.8 * fHash(vec2(seed, 1.9)) : 7.0 + 5.0 * fHash(vec2(seed, 1.9));
  vec3 inDay = vec3(0.035);
  float inLit = mix(0.36, 0.4, home);
  if (fine < 0.999 && m > 0.0) {
    vec3 V = normalize(vFW - cameraPosition), rd = vec3(dot(V, vec3(vFN.z, 0.0, -vFN.x)), V.y, max(-dot(V, vFN), 0.02));
    rd.x = abs(rd.x) < 1e-4 ? 1e-4 : rd.x;
    rd.y = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
    vec3 p = vec3(clamp(vFuv.x - zone * rw, 0.0, rw), clamp(f.y * vLook.y, 0.01, rc - 0.01), 0.0);
    vec3 tt = (vec3(rd.x > 0.0 ? rw : 0.0, rd.y > 0.0 ? rc : 0.0, dep) - p) / rd;
    float t = min(min(tt.x, tt.y), tt.z), level = step(tt.y, min(tt.x, tt.z)), alb, L;
    vec3 q = p + rd * t;
    if (home < 0.5) {
      // an office: carpet that dims away from the window's row of lamps, pale walls darker below the desks' line, a ceiling of light panels.
      // A panel's edge softens with the pixel, more along the depth a low view squeezes
      float s = 0.04 + fw.x * vLook.x, sz = s + fw.y * vLook.y * rd.z / abs(rd.y);
      if (level > 0.5 && rd.y > 0.0) {
        float pnl = smoothstep(0.3 + s, 0.3 - s, abs(fract(q.x / 2.4) - 0.5) * 2.4) * smoothstep(0.6 + sz, 0.6 - sz, abs(fract(q.z / 2.4 + 0.25) - 0.5) * 2.4);
        alb = 0.7; L = 0.2 + 2.8 * pnl;
      } else if (level > 0.5) { alb = 0.3; L = 0.75 * (0.55 + 0.45 * exp(-q.z / 5.0)); }
      else { alb = 0.6; L = 0.55 * (1.0 - 0.45 * smoothstep(1.1, 0.9, q.y)); }
    } else {
      // a home: a wooden floor, painted walls, the lamp's shade hanging in the middle, a sofa along the back wall, a picture over it
      vec3 lp = vec3(rw * (0.3 + 0.4 * hr), rc - 0.55, dep * 0.55), oc = p - lp;
      float tf = rd.y < 0.0 ? (0.48 - p.y) / rd.y : 1e9;
      vec3 qd = p + rd * tf;
      if (tf < t && qd.z > dep - 0.95 && qd.x > rw * 0.2 && qd.x < rw * 0.8) { q = qd; alb = 0.14; }
      else if (level > 0.5) alb = rd.y > 0.0 ? 0.7 : 0.32;
      else alb = (0.5 + 0.25 * hr) * (tt.z <= tt.x && abs(q.x - rw * 0.5) < rw * 0.12 && abs(q.y - 1.6) < 0.3 ? 0.4 : 1.0);
      L = 0.14 + 0.8 / (1.0 + dot(q - lp, q - lp) * 0.3);
      float b = dot(oc, rd), c = dot(oc, oc) - 0.05;
      if (b < 0.0 && b * b > c) { alb = 1.0; L = 3.0; }
    }
    inDay = mix(inDay, vec3(alb * (0.15 + 0.85 * exp(-q.z / 2.5)) * 0.12), 1.0 - fine);
    inLit = mix(inLit, alb * L, 1.0 - fine);
  }
  // a blind part way down an office's pane; a home's curtains drawn to the sides, a few closed. Fabric: pale by day, glowing with the
  // room's light at night
  float drop = step(0.55, h2) * fract(h2 * 13.7), cw = 0.06 + 0.22 * fract(h2 * 7.3), sheer = step(0.84, h2);
  float cov = home > 0.5
    ? max(sheer, max(smoothstep(cw + ow.x, cw - ow.x, o.x), smoothstep(1.0 - cw - ow.x, 1.0 - cw + ow.x, o.x)))
    : step(0.01, drop) * smoothstep(1.0 - drop - ow.y, 1.0 - drop + ow.y, o.y);
  cov = mix(cov, mix(0.22, 0.44, home), cf) * (1.0 - shop);
  float fold = mix(home > 0.5 ? 0.82 + 0.18 * sin(o.x * win.x * vLook.x * 22.0) : 0.86 + 0.14 * o.y, 1.0, fine);
  vec3 room = mix(inDay, mix(vec3(0.42, 0.43, 0.44), vec3(0.62, 0.57, 0.5), home) * fold, cov);
  float through = mix(inLit, mix(0.3, 0.4, home) * fold, cov);
  float deep = 1.0 - smoothstep(0.5, 0.8, refl);
  // a punched window sits back in the wall: its reveal's shadow along the head and down one side
  float reveal = max(smoothstep(hi.y - 0.14 * win.y - fw.y, hi.y - 0.14 * win.y + fw.y, f.y), 1.0 - smoothstep(lo.x + 0.07 * win.x - fw.x, lo.x + 0.07 * win.x + fw.x, f.x));
  vec3 glass = mix(room, vTint, refl) * (1.0 - mix(reveal, 0.1, cf) * 0.6 * deep);
  // the frame: each floor a touch different, rain streaks down it, a little grime toward the street
  vec3 fr = vColor.rgb * (0.92 + 0.14 * mix(fHash(vec2(id.y, seed)), 0.5, cy)) * (0.84 + 0.16 * smoothstep(0.0, 20.0, vFuv.y));
  fr *= 0.86 + 0.22 * fNoise(vec2(vFuv.x * 0.45, vFuv.y * 0.03 + seed));
  // a wall's own make, anything but a curtain wall's: panels a bay wide and a storey high, each a little off, their joints; a stone
  // office's piers paler than its spandrels; a tiled front's courses; a slab's edge at each floor, the stain under each sill. Each goes where a
  // pixel covers it
  float solid = 1.0 - smoothstep(0.6, 0.8, refl), trim = 1.0 - step(0.2, refl), stone = fBand(0.3, 0.4, refl, 0.001), pxm = max(fw.x * vLook.x, fw.y * vLook.y);
  float fade = smoothstep(0.08, 0.3, pxm), tiled = trim * (1.0 - smoothstep(0.04, 0.12, pxm));
  float grain = fNoise(vFuv * vec2(1.7, 3.1) + seed);
  float joint = mix(smoothstep(0.03 + mpx, 0.03 - mpx, min(f.x, 1.0 - f.x) * vLook.x), 0.06 / vLook.x, cx);
  float pier = mix(1.0 - fBand(lo.x, hi.x, f.x, fw.x), 1.0 - win.x, cx);
  vec2 tq = vec2(vFuv.x / 0.42 + 0.5 * mod(floor(vFuv.y / 0.21), 2.0), vFuv.y / 0.21), tf = abs(fract(tq) - 0.5);
  float drip = fBand(lo.x, hi.x, f.x, fw.x) * (1.0 - step(lo.y, f.y)) * smoothstep(0.0, lo.y, f.y) * fNoise(vec2(vFuv.x * 4.3 + seed, id.y * 3.1));
  fr *= 1.0 + (grain - 0.5) * 0.14 * (1.0 - fade) + solid * (1.0 - trim) * (mix(h, 0.5, cf) - 0.5) * 0.14;
  fr *= 1.0 - solid * joint * 0.3 * (1.0 - trim);
  fr *= 1.0 + stone * (pier * 0.18 - 0.08);
  fr *= mix(1.0, (0.88 + 0.24 * fHash(floor(tq) + seed)) * (1.0 - 0.3 * max(smoothstep(0.42, 0.5, tf.x), smoothstep(0.38, 0.5, tf.y))), tiled);
  fr *= 1.0 - solid * mix(drip * 0.42, 0.04, cf);
  fr *= 1.0 + solid * 0.16 * mix(fBand(-0.01, 0.045, f.y, fw.y), 0.045, cy);
  // the sun's shadow under a slab's edge, as deep as the sun is high against this wall
  float under = 0.16 * max(fSun.y, 0.0) / max(dot(fSun, vFN), 0.08) / vLook.y;
  fVis = 1.0 - solid * mix(fBand(1.0 - min(under, 0.5), 1.1, f.y, fw.y), min(under, 0.5), cy);
  // a tiled front's stone sills and lintels
  float sill = fBand(lo.x - 0.04, hi.x + 0.04, f.x, fw.x) * (fBand(lo.y - 0.07, lo.y, f.y, fw.y) + fBand(hi.y, hi.y + 0.08, f.y, fw.y));
  fr = mix(fr, vec3(0.62, 0.58, 0.51) * (0.9 + 0.2 * mix(h, 0.5, cf)), mix(sill, 0.08, cf) * trim * (1.0 - shop));
  diffuseColor.rgb = mix(mix(fr, vec3(0.03, 0.033, 0.036), mull / max(1.0 - m, 1e-3)), glass, m);
  // a shop's fascia over its window, the whole of its width: painted in its colour, lit when it is open
  float fasc = shop * mix(fBand(hi.y + 0.03, 0.9, f.y, fw.y), 0.17, cy) * mix(fBand(0.04 / sw, 1.0 - 0.04 / sw, (mod(id.x, sw) + f.x) / sw, fw.x / sw), 1.0, cx);
  diffuseColor.rgb = mix(diffuseColor.rgb, sCol * 0.3 + 0.015, fasc);
  fRough = mix(0.8, 0.05 + 0.12 * mix(h, 0.5, max(cf, fNight)) * refl + 0.12 * (1.0 - refl), m);
  fMetal = mix(0.0, refl * 0.9, m);
  // by day a curtain wall's panes each a little out of true, so the sky they mirror breaks up pane by pane; at night they lie flat, or the
  // street lamps' glints would scatter over them in specks
  fTilt = (vec3(h, h2, h3) - 0.5) * 0.09 * m * refl * (1.0 - cf) * (1.0 - fNight);
  // the night: the lit rooms' light through their glass (a mirror glass lets less through), the frame round a lit window catching a
  // little of it, the street lamps' warm light washing the lowest floors' walls. A building's rooms come on at its own time as the night
  // comes (its place in the ramp: one early, one late), a shop with the street. In the room's units (a unit is about 700 cd/m2): a lit
  // room's window about 150 cd/m2, a shop's about 300, so the city's windows do not outshine the room's lamps
  float bNight = mix(smoothstep(0.0, 0.2, fNight - 0.8 * fHash(vec2(floor(seed) * 0.29, 51.3))), fNight, shop);
  fGlow = lamp * kz * lit * through * m * (1.0 - 0.5 * refl * (1.0 - shop)) * (bNight * mix(0.6, 1.2, shop) + 0.02);
  fGlow += sCol * fasc * mix(sOpen, 0.8, cx) * 0.7 * fNight;
  fGlow += fr * lamp * lit * 0.06 * bNight * (1.0 - m);
  fGlow += fr * vec3(1.0, 0.72, 0.45) * 0.45 * exp(-vFuv.y / 6.0) * fNight * (1.0 - m);
  // a tall tower's head in its floodlights: brightest under its crown, fading down the wall, the walls taking more of it than the glass
  if (vWashY.y > 0.0) {
    float washK = clamp((vFW.y - vWashY.x) / (vWashY.y - vWashY.x), 0.0, 1.0);
    fGlow += vWash * washK * washK * mix(1.0, 0.4, m) * fNight;
  }
  // what the pane mirrors under the sky, where the sky's cube knows nothing: the eye's ray goes on, turned by the glass, to the far side of the
  // street, to a roof line that wanders along it. Under that line it meets the walls across (in shade or in the sun, as they face), their
  // windows, lit at night, or the road. Each pane is a little out of true, so the picture breaks at its edges
  vec3 fV = normalize(vFW - cameraPosition), fR = reflect(fV, vFN);
  float rn = max(dot(fR, vFN), 0.1);
  vec2 rs = vec2(dot(fR, vec3(vFN.z, 0.0, -vFN.x)), fR.y) / rn + (vec2(h, h2) - 0.5) * (0.01 + 0.025 * refl) * (1.0 - cf);
  vec2 rp = vec2(vFuv.x, vFW.y) + rs * (abs(vFN.x) > 0.5 ? 32.0 : 24.0), rg = rp / vec2(3.0, 3.4), rc2 = fract(rg);
  float rtop = 13.0 + 32.0 * fNoise(vec2(rp.x / 34.0, seed * 0.37)), hit = 1.0 - smoothstep(rtop - 0.7, rtop + 0.7, rp.y);
  float road = 1.0 - smoothstep(-0.4, 0.4, rp.y), pane = mix(fBand(0.18, 0.82, rc2.x, 0.1) * fBand(0.22, 0.78, rc2.y, 0.1), 0.34, cf);
  vec3 across = (fHor * 0.3 + fSunCol * max(dot(fSun, -vFN), 0.0) * 0.26) * (1.0 - 0.3 * pane);
  across += vec3(1.0, 0.76, 0.5) * pane * mix(step(0.74, fHash(floor(rg) + seed)), 0.26, cf) * 0.55 * fNight;
  vec3 mirrorK = mix(mix(vec3(0.1 + 0.09 * h), vTint * 1.7, refl * 0.9), vec3(1.0), pow(1.0 - clamp(-dot(fV, vFN), 0.0, 1.0), 5.0));
  fGlow += mirrorK * hit * mix(across, fHor * 0.09, road) * m;
  // over that line, the rest of the city, and only then the sky: a coated pane's sky bright by day, dim at night, under the lights it mirrors
  vec4 cityIn = fCityMirrored(normalize(fR + fTilt * 2.0), max(length(fwidth(fR)), 0.0012));
  fGlow += mirrorK * (1.0 - hit) * cityIn.a * cityIn.rgb * m;
  fSpec = (1.0 - max(hit, cityIn.a) * m) * mix(1.0, mix(2.0, 0.7, fNight), refl * m);
  // the sun on the glass: panes bow a little, so its image spreads to a wide glare over a wall turned toward it, broken pane by pane; one pane
  // in twenty-five, opened or set out of true, glints in turn as the eye or the sun moves: short, in the sun's colour, at most 0.6 over the
  // pane, so it stays under the bloom's threshold (1.2) and never reads as a white pane
  float sunFace = smoothstep(0.0, 0.15, dot(vFN, fSun));
  if (sunFace > 0.0 && refl > 0.2) {
    float gS = max(dot(reflect(fV, normalize(vFN + (vec3(h, h2, h3) - 0.5) * 0.16 * (1.0 - cf))), fSun), 0.0);
    float flash = step(0.96, h3) * step(0.6, refl) * pow(abs(fract(h2 * 17.0 + (cameraPosition.x + cameraPosition.y) * 0.013) * 2.0 - 1.0), 40.0);
    fGlow += fSunCol * m * sunFace * (refl * (0.16 * pow(gS, 10.0) + 1.2 * pow(gS, 90.0)) + (1.0 - cf) * 0.6 * flash * (0.25 + 0.75 * o.y * o.y));
  }`;
