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

Flicker, measured (night, still camera, High, share of window pixels whose luminance moves more than 24/255 in 1.5 s): 1.42% before, 1.33% after; with cars hidden 0.79% to 0.72%; with the sky and facade clocks frozen 0.35% (the floor). The rest is car motion and cloud drift, which are motion, not flicker. Not measured: shimmer of small lights while the camera moves.

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
| Slat wall, desk, shelves | Warm wood. On hold (ASR8). | `shell/wall.ts`, `palette.ts` |
| Board colours | About 490 hard-coded hex values, no palette module (ASR9). | `src/features/board/render/three` |
