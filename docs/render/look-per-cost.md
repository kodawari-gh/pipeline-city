# Look per cost

An evaluation of 2026-11-14: where the picture loses quality for no saving, and which assets do not fit `docs/art-style.md` (v3). Branch `gfx/look-per-cost`. Costs are classes, not measurements, unless a number is given.

## Rule

Spend at build time or at a rare event, not per frame. The room is static and the camera is often still, so most of the look can be baked, cached or captured once.

## Done on this branch

| Item | Change | Frame cost |
|---|---|---|
| Selection outline | Cyan `#3be3ff`, about 1 px, strength 1.5, drawn after the bloom (it no longer blooms). Was yellow, strength 4. | Same |
| Bloom | Strength 0.12 / 0.2 (was 0.3 / 0.5), threshold 1.6 (was 1.2), radius 0.3, high-pass cap 4 (was 32). Only real emitters bloom. | Same |
| City night lights | Roof beacons pulse slowly (3.5 s) in place of a hard blink; the 9 Hz sign stutter and the star twinkle are gone; aircraft strobes ramp over 150 ms. | Same |
| Full tower | Dark monolith: straight charcoal body, one large smoked glass side, flat plinth, one violet inner strip. No pillars, lit outlines, name plates or bright silver. | Fewer draws and lights |
| Mid tower | One violet strip in place of the six-colour bar; plain plate; flat feet. | Fewer lights |
| Bloom | Strength 0.5 to 0.2 (step 4c). Halos tighter; neon and lamps read as sources. Whole-frame mean unchanged at night. | Free |

Flicker, measured (night, still camera, High, share of window pixels whose luminance moves more than 24/255 in 1.5 s): 1.42% before, 1.33% after; with cars hidden 0.79% to 0.72%; with the sky and facade clocks frozen 0.35% (the floor). The rest is car motion and cloud drift, which are motion, not flicker. Not measured: shimmer of small lights while the camera moves.

Measure: `npm run flicker -- --preset High` (or `Low`, `Medium`; `--frames N`). It starts the dev server on port 5231, opens the assembled sandbox at night (hour 23) and prints two lines. Still camera: the share of pixels whose luma moves more than 24/255 over 30 frames (full frame, no top bar). Pan at 2 px per frame: the window and the rest, apart. Pan numbers include motion, so they are an upper bound. Results on an RTX 5080 (ANGLE D3D11): High still 0.64%, pan window 9.42%, rest 46.35%; Low still 5.94%, pan window 8.78%, rest 35.91%.

Correction (2026-11-14, `--map range.png` and `--settle ms` added): the Low still figure of 5.94% was a settle artefact. The tool waited 3 s after the preset change; at Low the night lamps still ramped and the frame still changed size, so every edge in the picture read as flicker. With a 15 s settle (now the default) Low still reads 0.28% and High 0.44%. The range map of the settled still frame shows intended motion only, in this order of area: the traffic on the avenue (head lamps and their bloom), the tower beacons and the windows that switch (High), then the plane's lights and the drifting clouds. No surface of the room or the machine flickers with a still camera. The pan numbers still include the motion itself.

Shimmer under the pan (third line of the tool, `--turns N`, default 8): the share of pixels whose luma turns (up by more than 24, then down by more than 24, or the reverse) 8 times or more in the 30 frames. A passing edge turns a pixel once, so plain motion does not count; a striped pattern finer than 15 px still does, and that is the moiré the eye reads as flicker. Results: High window 0.18%, rest 2.08%; Low window 0.17%, rest 0.52%. So the city is not the source under a pan; the room is, and more at High than at Low. The map (`--map x.png` also writes `x-pan.png`) shows, by eye, these worst sources at High: (1) the fine detail inside the case behind the glass (fins, RAM spreaders, drive trays), (2) the avenue's traffic with its bloom, (3) the keyboard's key rows and the ribs of the two paper lamps. The wall clock and the monitor's picture also read white, but they are animated on purpose. Next step for (1): a lower LOD for the machine at the overview (LPC4), which removes its sub-pixel detail. The overview stand-ins (LPC5) cut the draws but hold the same triangles, so they do not change the shimmer.

## Ranked gains (best look per cost first)

1. **Real room in reflections.** Already present: `probe.ts` captures the room per light change and `RoomEnvironment` is only the fallback before the first capture. One fix on this branch: the case no longer reflects itself (2739357).
2. **Dither at output.** Static triangular noise of 1/255 in the finish pass. Removes banding in the dark room. Cost: a few instructions.
3. **Half-resolution GTAO**, depth-aware upsample, then AO at Medium. Cost: about a quarter of the present AO.
4. **Baked occlusion for the machine.** Per-vertex AO at build time for static parts. Low gets depth in the case with no pass.
5. **Light count (PERF17).** Lamps that never move live in the lightmaps only; at most 4 real-time lights at Low, 8 above. Every lit shader gets cheaper.
6. **Shadow maps on demand.** Already present (`shadows.ts`, PERF18): a still room draws no shadow map. Left: spend the saving on softer filtering at High.
7. **Grade LUT.** One 3D-LUT lookup in the finish pass in place of the hand tint. Needs an authored grade from the owner first.
8. **Still-camera refinement.** Jitter and accumulate frames while nothing moves: super-sampled edges at Low with no MSAA. Experiment; stop if moving parts ghost.
9. **KTX2 lightmaps (PERF25, KTX1).** Less memory; the saving can buy lightmap resolution.
10. **Far city as cards (LODD3).** Also removes most sub-pixel lights.

The open items are tasks LPC1–LPC11 in `docs/TODO.md` ("Look per cost"), with the order and the reasons.

## Assets against art-style v3

| Asset | Problem | Where |
|---|---|---|
| Mini tower | Cream; a named anti-reference. On hold by the owner. | `case3d.ts` `LOOKS.oem` |
| Case tray, drive cages | Brass and tan read as cardboard through the new glass. | `casetray3d.ts`, `drivecage3d.ts` |
| City signs | Saturated `#ff3f9e`, `#ff5a3c`. | `outside/towers.ts` `SIGNS` |
| City fields, cars | Olive greens; yellow and red cars. | `outside/city.ts`, `outside/plan.ts` |
| Gold and copper | Four golds, two coppers; the palette has one each. | `ram3d`, `nic3d`, `psu3d`, `gpu3d` |
| Fan accents | Violet `0x7a5cc8`, `0x8b5cff`, not `#a68bff`. | `fans3d.ts` |
| Desk props | Green monitor LED `0x4cff8a`; terracotta keycaps. | `props3d.ts` |
| East wall panel | Emissive on a part that is not a light source. | `furniture3d.ts` |
| Slat wall, desk, shelves | Warm wood. On hold (ASR8). | `palette.ts` |
| Board colours | About 490 hard-coded hex values, no palette module (ASR9). | `src/features/board/render/three` |

## Low city beacons (2026-11-15)

Same night view at Low and High (`--hour 23`, `citycuts=1`). The beacon shader matches High: same colour, width, 3.5 s pulse and night scale. The crown code is shared. The Low skyline has more visible red dots. Measured over the skyline top band (260,120,600,110): Low sRGB 45,36,37, High 42,36,36. Overall brightness of the band is equal. Gap is small (about 3 red units). No change made.
