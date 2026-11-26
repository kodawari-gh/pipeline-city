// The facade shader's colour for each other kind (`facade.ts`, after `shaderWall.ts`'s wall): an LED band, a spire in its floodlights, a
// roof, a solar panel, plain metal, a beacon, a lit lantern, a sign.

/** The colour chunk's other branches, to its end. */
export const FRAG_KINDS = `} else if (fKind == 5) {
  // a lit band of LEDs: a thin dark line by day, a bright one at night. On a spire's metal (vAux.z) it is that metal by day
  diffuseColor.rgb = mix(vec3(0.04), vec3(0.55, 0.58, 0.6), vAux.z);
  fRough = 0.3;
  fGlow = vColor.rgb * (0.12 + fNight * 2.1) * pow(vWide, 0.6);
} else if (fKind == 9) {
  // a spire in its floodlights: pale metal, bright at its foot where they stand, fading up. vLook: from where, how high
  diffuseColor.rgb = vec3(0.55, 0.58, 0.6);
  fRough = 0.5;
  fGlow = vColor.rgb * (0.12 + 1.5 * exp(-3.0 * clamp((vFW.y - vLook.y) / max(vLook.z, 1.0), 0.0, 1.0))) * fNight;
} else if (fKind == 1) {
  // a roof, each of its own make: a pale membrane in lapped sheets, gravel, a sedum garden inside a gravel margin, or dark bitumen with its
  // pavers. Water marks over them all, grime and the sky's shade along the parapet. Vlook: the roof's rect
  vec2 g = vFuv, gw = fwidth(g);
  float px = max(gw.x, gw.y), seed = vAux.x, make = fHash(vec2(seed, 3.3)), rr = fHash(vec2(seed, 6.1));
  float edge = min(min(g.x - vLook.x, vLook.y - g.x), min(g.y - vLook.z, vLook.w - g.y));
  float sheetF = 1.0 - smoothstep(0.25, 0.8, px), grainF = 1.0 - smoothstep(0.1, 0.4, px);
  float big = mix(fNoise(g * 0.09 + seed), 0.5, smoothstep(2.0, 8.0, px)), mid = mix(fNoise(g * 0.41 + seed * 1.7), 0.5, smoothstep(0.5, 2.0, px));
  float grit = mix(fNoise(g * 3.7 + seed) * 0.6 + fNoise(g * 11.0) * 0.4, 0.5, grainF < 0.01 ? 1.0 : 1.0 - grainF);
  vec3 c;
  if (make < 0.42) {
    // sheets two metres wide, each row's ends lapped where the rolls ran out; a welded seam is a dark line with its lip's bright edge beside it
    vec2 s = rr < 0.5 ? g : g.yx;
    float q = s.x / 2.0, l = fract(q), row = floor(q), roll = 7.0 + 5.0 * fHash(vec2(row, seed * 1.3)), e = fract(s.y / roll + fHash(vec2(row, seed + 2.7)));
    float sd = min(min(l, 1.0 - l) * 2.0, min(e, 1.0 - e) * roll);
    float lap = mix(smoothstep(0.08 + px * 0.5, 0.0, sd), 0.05, 1.0 - sheetF), lip = mix(smoothstep(0.05 + px * 0.5, 0.0, abs(sd - 0.12)), 0.0, 1.0 - sheetF);
    c = mix(vec3(0.27, 0.285, 0.29), vec3(0.42, 0.42, 0.405), rr) * (0.96 + 0.12 * mix(fHash(vec2(row, seed)), 0.5, 1.0 - sheetF)) * (1.0 - 0.42 * lap + 0.12 * lip);
    c *= 0.66 + 0.52 * smoothstep(0.25, 0.7, big * 0.6 + mid * 0.4);
  } else if (make < 0.74) {
    c = vColor.rgb * (0.66 + 0.6 * big) * (0.74 + 0.52 * grit);
  } else if (make < 0.9) {
    float bloom = smoothstep(0.34, 0.66, mid * 0.6 + big * 0.4);
    c = mix(vec3(0.06, 0.082, 0.035), vec3(0.135, 0.115, 0.05), bloom) * (0.65 + 0.7 * grit);
    c = mix(vColor.rgb * (0.74 + 0.52 * grit), c, smoothstep(0.85, 1.15, edge));
  } else {
    vec2 pv = g / vec2(1.2, 0.8), pf = abs(fract(pv) - 0.5);
    float slab = mix(smoothstep(0.5, 0.44, max(pf.x, pf.y)), 0.8, 1.0 - sheetF);
    c = mix(vec3(0.05), vec3(0.19, 0.185, 0.17) * (0.88 + 0.24 * mix(fHash(floor(pv) + seed), 0.5, 1.0 - sheetF)), slab * step(make, 0.95));
    c *= 0.8 + 0.4 * big;
  }
  // where the rain lies after a storm: a pond a little darker, its tide line darker still; streaks of grime run from it
  float pond = fNoise(g * 0.13 + seed * 2.9), pw = fwidth(pond);
  float tide = mix(smoothstep(0.012 + pw, 0.0, abs(pond - 0.63)), 0.0, 1.0 - sheetF), wet = smoothstep(0.62, 0.64, pond);
  float grime = mix(smoothstep(0.55, 0.8, fNoise(vec2(g.x * 1.6, g.y * 0.09) + seed * 4.3)), 0.25, 1.0 - sheetF) * smoothstep(0.45, 0.6, pond);
  c *= (1.0 - 0.14 * wet) * (1.0 - 0.3 * tide) * (1.0 - 0.18 * grime);
  diffuseColor.rgb = c * (0.78 + 0.22 * smoothstep(0.0, 3.0, edge));
  fRough = 0.94;
  fAo = 0.45 + 0.55 * smoothstep(0.0, 1.5, edge);
} else if (fKind == 7) {
  // a solar panel: dark blue cells on fine silver lines, smooth enough to mirror the sky
  vec2 g = vFuv * 2.0, gw = fwidth(g), d = abs(fract(g) - 0.5);
  float l = mix(max(smoothstep(0.44 - gw.x, 0.44 + gw.x, d.x), smoothstep(0.44 - gw.y, 0.44 + gw.y, d.y)), 0.2, smoothstep(0.2, 0.6, max(gw.x, gw.y)));
  diffuseColor.rgb = mix(vec3(0.012, 0.022, 0.06), vec3(0.3, 0.32, 0.34), l * 0.6);
  fRough = 0.16 + 0.3 * l;
  fMetal = 0.3 * (1.0 - l);
  fAo = 1.0;
} else if (fKind == 2) {
  // plain metal and cement, weathered a little
  diffuseColor.rgb *= 0.88 + 0.24 * fNoise(vFW.xz * 0.4 + vFW.y * 0.7);
  fAo = max(fAo, 0.72);
} else if (fKind == 3) {
  diffuseColor.rgb = vColor.rgb;
  // a roof's warning beacon: a slow smooth pulse (3.5 s) on its own phase, never a hard on or off
  fGlow = vec3(1.0, 0.06, 0.03) * 9.0 * vWide * mix(0.55, 1.0, 0.5 + 0.5 * sin(6.2831853 * (fTime / 3.5 + vAux.x))) * fNight;
} else if (fKind == 4) {
  // a lit lantern: panes on slim ribs, brightest at the foot where its lamps stand, fading up
  vec2 g = vec2(vFuv.x / vLook.x, (vFuv.y - vLook.y) / 3.0), w = fwidth(g), d = abs(fract(g) - 0.5);
  float pane = mix(smoothstep(0.42 + w.x, 0.42 - w.x, d.x) * smoothstep(0.46 + w.y, 0.46 - w.y, d.y), 0.75, smoothstep(0.15, 0.4, max(w.x, w.y)));
  diffuseColor.rgb = vec3(0.32, 0.34, 0.36);
  fRough = 0.15; fMetal = 0.6;
  fGlow = vColor.rgb * pane * (1.0 + vLook.w) * (0.2 + 0.9 * exp(-3.0 * clamp((vFuv.y - vLook.y) / max(vLook.z, 1.0), 0.0, 1.0))) * fNight;
} else if (fKind == 8) {
  // a sign: its glyphs in a stack or a row, neon tubes on a dark board (a white core, a halo on the board), or dark on a lit box. A few
  // are dead; none stutter (a still eye sees no change). By day they are paint. Far off, their average. vLook: its size, its foot, lit or not (under 0: its case)
  diffuseColor.rgb = vec3(0.022, 0.024, 0.027);
  fRough = 0.45;
  if (vLook.w > -0.5) {
    vec2 sz = vLook.xy, p = vec2(vFuv.x, vFuv.y - vLook.z), pw = fwidth(p);
    float seed = vAux.x, cell = min(sz.x, sz.y), box = vLook.w;
    vec2 cnt = floor(sz / cell + 0.001), q = (p - (sz - cnt * cell) * 0.5) / cell, gid = clamp(floor(q), vec2(0.0), cnt - 1.0), c = (q - gid - 0.15) / 0.7;
    float px = max(pw.x, pw.y) / (cell * 0.7), far = smoothstep(0.12, 0.45, px), d = fGlyph(c, fHash(gid + seed * 1.31));
    float dead = step(0.94, fHash(gid * 3.7 + seed));
    float th = mix(0.05, 0.085, box), tube = mix(smoothstep(th + px, th - px, d), 0.3, far), halo = mix(exp(-d * d * 30.0), 0.55, far) * (1.0 - tube);
    float edge = min(min(p.x, sz.x - p.x), min(p.y, sz.y - p.y)), rim = smoothstep(0.05 - pw.x, 0.05 + pw.x, edge);
    vec3 col = vColor.rgb, neon = (col * 1.75 + vec3(0.22)) * tube * (1.0 - dead) + col * 0.3 * halo * (1.0 - dead);
    vec3 boxed = col * 0.72 * (1.0 - tube) * (0.72 + 0.28 * smoothstep(0.0, cell * 0.5, edge));
    diffuseColor.rgb = mix(mix(diffuseColor.rgb, col * 0.5, tube * (1.0 - dead)), mix(col * 0.62 + 0.1, vec3(0.03), tube), box) * mix(0.3, 1.0, rim);
    fGlow = mix(neon, boxed, box) * rim * fNight;
    fRough = mix(0.5, 0.3, box);
  }
}`;
