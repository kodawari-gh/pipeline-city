# Rendering: the power lens (3D power)

Part of the renderer docs; the hub is [`RENDER.md`](../RENDER.md). Code: `src/features/board/render/three/power/`, and the power scale in `src/core/render/three/powerscale.ts`. The airflow lens ([`air.md`](air.md)) is the sister view: it shares the veil, the words and the way it is hosted.

The lens shows the machine's power as light in the machine's own 3D space. It does not lay a map over the picture. Everything that is not electrical goes nearly black: the case, the board and the heatsinks. The real cables glow along their real strands. The board's copper glows along its own traces. A pulse runs along each line from the source to the part, closer and faster the more watts it carries. A part glows by what it draws. A cable that is out shows a red ring and red words at its socket. One switch turns it on: the bolt button, or the **P** key (`powerLens` in `src/app/hover.ts`). It excludes the airflow lens (`airflowLens`).

The colour says the **role** of a thing, the brightness says how much it draws:

| Role | Colour | What it is |
|---|---|---|
| source | white | where power comes in: the wall socket and the mains cord |
| hub | cyan | takes power in and hands it on: the supply, the two regulators (VRM), the fan hub |
| use | amber | turns power into work and heat: the processor, the memory, a card, a drive, a fan, the TPM |

A legend of the three roles sits under the scale pill.

## Cost: what is made once, what runs each frame

The cables, the parts and the board do not move while the machine stands. So the lines are made once, and a frame moves nothing on the CPU.

| When | What | Cost |
|---|---|---|
| a cable is built again (`Machine3D.cablesRev`), or a part or a cable is added or removed (the key in `PowerView3D.frame`) | the shape (`powerShape`): the lines from the real cables and the board's buses, the stubs, the rings; the strips' buffers (`strips`) | about 700 strips, once |
| each snapshot | `powerLedger` (the watts by cable and by part), `powerDraw` (each line's place on the scale and state, the words, the parts' levels), one write of the strips' state, the parts' glow | tiny |
| each frame | two uniforms a layer (time, pixel size), the words' projection | 0.04 to 0.07 ms (`PowerView3D.cost`) |

The pulses are found in the shader from each strip's arc length and the time: nothing is moved. A frame of the lens is six draws (the veil, the dim plates through everything, the plates, the lines with the depth test, the hidden runs, the rings). The words are DOM.

## Files (`board/render/three/power/`)

| File | Role |
|---|---|
| `ledger.ts` | pure: `powerLedger(snapshot)`, where the draw goes, cable by cable and part by part; `FlowState`; `wattsText` |
| `runs.ts` | pure: `CableRun` (what `Machine3D.cableRuns` gives of each cable), `RigPower` (what a draggable cable tells the lens), `inFlowOrder`, `reversed` |
| `net.ts` | pure: `powerShape` (the machine as built: lines, rings, plates), `powerDraw` (one snapshot on the shape: levels, states, words, roles, glow) |
| `flows.ts` | Three: `PowerFlows`: the lines as instanced strips with a shader that finds the pulses, the rings, and the plates (`Nodes`); `strips`, `seedOf` (pure) |
| `view.ts` | `PowerView3D`: owns the above and the words and the veil, rebuilds the shape when the machine changes, writes each snapshot, makes the parts glow. `Lens3D` (`lens3d.ts`) hosts it |
| `core/render/three/powerscale.ts` | pure: the power scale (`POWER`, `HUB`, `SOURCE` stops, `Role`, `ROLE_HEX`, `ROLE_WORD`, `levelOf`, `wattsAt`, `powerHex`, `hubHex`, `sourceHex`, `powerGradient`, `powerGlsl`, `WARN`, `POWER_VEIL`, `POWER_LIFT`). The pulses' shader, the parts' glow (`PartSkin.electric`) and the legend bar all read it |
| `air/airtags.ts` | the words as DOM pills pinned to 3D points (`AirTags3D`): the tone `watts`, the role chip, the scale pill in watts (`unit: 'W'`) and the legend of the roles |

`Machine3D` gives the lens four things (`machine3d.ts`): `cableRuns()` (each cable's strands, as the sleeves are made from them, in the order the power goes), `cablesRev` (moves when a cable is built again), `heldCables()` (the cables a hand holds) and `partBox(id)` (a part's box); and `powerGlow(levels, warn, roles)` puts the glow on the parts.

## The ledger

`powerLedger` ports the model of the old 2D lens (the flows add up, tested in `ledger.test.ts`). The machine draws now when `powered` and the supply is not `off`. Directions are source to sink.

- The PC's cord carries `power.totalW` less the monitor (0 when off). The monitor's cord carries the monitor's own draw.
- The 8-pin carries the CPU. Each PCIe lead carries a card's draw in equal shares between the slot and its leads. A SATA drive's lead (`<device id>:power`) carries the drive. A heatsink's, a sink's and the pump's fans ride their header's cord (`cpufan`, `vrmfan`, `ramfan`); a case fan has its own cord (`fan:<mount>`) and the hub's cord (`sysfan`) carries them all.
- The 24-pin carries the rest: memory, the cards' slot shares, the M.2 drives, the headers, the regulators' losses.
- A cable that the sim lists as not connected carries 0 and is `missing`. A cable that carries nothing is `idle`. The rest are `on`.
- `refW` is the draw at the top of the scale: the machine's own draw, never under 60 W, so the busiest line reads hottest.
- The supply's glow is what it hands the machine. The words show it as `SUPPLY x W / y W`.

## The net

Lines are in the order the power goes. A line is one of three kinds.

- **Cable**: a real strand of a real cable, the settled points the sleeve is made from (`Machine3D.cableRuns`: each rig registers its strands when it is built, `inFlowOrder`). A lead from the supply is made from its plug back to its grommet, so the strands are turned round (`RigPower.out`); a cord from the wall goes on past its end to its device (`beyond`); the fan hub's lead goes on in a second piece (`more`). When a plug is out, the strands hang from their grommet to the plug where it lies, and the lens follows them. A cable's light is lifted out of its sleeve (`r + 14`) and as wide as the sleeve (at least 17 units).
- **Trace**: the board's copper, from `buildBuses()` (`wiring/routes.ts`): the 8-pin onto `pwrcpu` and down `vcore` into the package, the memory's 12 V (`pwr12`) and `vdimm` with a tap to each stick, `pwrpcie` to each slot and M.2 socket. A part with no trace of its own rides a strip beside the 24-pin. Traces lie on the board's face and are lifted toward the eye in the shader.
- **Ghost**: a lead from the supply comes in behind the tray, a run the machine does not model. Each strand goes on past its first point for a short stub (`STUB`, 1,500 units), the way it was heading, fading away from the cable (`fade`). It is drawn dim and through the parts. Drawn on to the supply it would cross the case in straight lines that are nobody's cable.

A **ring** sits on the socket of every power cable. It shows only while that cable is out.

A **plate** (`PowerNode`) is a rounded rectangle that lies where a hub or a source is, for the things that have no cable of their own. There are four: `node.wall` (source, round the wall socket the mains cords plug into), `node.vrm` (the CPU regulator, `GEO.vrm`), `node.dvrm` (the memory regulator, `GEO.dvrm`) and `node.hub` (the fan hub, `FAN_HUB`, at `hubZ`). A plate shows what goes through the hub: its level is what it hands on, its state is `missing` when its feed is out. Each line carries a `tone` (its role): the mains cords are `source`, the leads and traces from a hub are `hub` where they leave it, the rest are `use`.

On the Build my PC stage the source plate is the studio wall's real mains plate (`studiowall3d.ts`). `ShapeIn.outlet` (`padX`, `padY`, `lift`) gives it the plate's outline (`WallPlan.pad`) and lays it 14 units over the plate's face, in front of the plugs' seat. The room's loose socket keeps the default (760 by 470, behind the seat). The wall's words start beside the plate (`PowerShape.wallWords`), not over the plugs. The wall's router, jacks and plates carry no power: the veil darkens them.

## The drawing (`flows.ts`)

One mesh of instanced strips for the lines with the depth test (a cable goes behind the parts in front of it), one for the ghosts (no depth test), one of rings (no depth test), and one of plates (a signed-distance rounded rectangle in the fragment shader). The plates have a second, dim copy that draws through everything (`HIDDEN_PLATE`, 0.22 of the strength), so a hub that stands behind a drive cage or a card still shows where it is, as the hidden runs do. A strip is a straight stretch of a line. The vertex shader turns it to face the camera. A strip is never thinner than two pixels each side, so a thread from far is still a line, and from close it is the cable's own size. It reaches a little past its ends so that two strips meet at a bend. Blending is additive and tone mapping is off, so overlapping strands add up and the glow stays a glow.

The fragment shader reads the strip's level (0 to 1 on the power scale) and state:

| State | Look |
|---|---|
| on | a steady body glow, and **pulses**: a comet with a hot head and a tail, running toward the part. The speed goes from 1,500 to 5,200 units a second and the gap from 1,500 to 800 units from the foot to the top of the scale. The head is paler than the body, toward white at the top. Each line starts at its own place in the gap (`seedOf`), so the strands of one cable do not pulse as one |
| idle | a dim thread: the machine is off, or the run carries nothing |
| missing | red, pulsing, still: its cable is out |
| held | hidden (a hand holds the plug: the hand draws its own cable) |

Pulses run on game time: they stop with the pause. The red pulse and the rings run on the real clock, so what is wrong keeps pulsing while the game is paused.

### The dark

The lens is for the electrical parts alone, so the room is multiplied by a very dark veil (`makeVeil`, `POWER_VEIL` `[0.07, 0.075, 0.105]`: a dark with a little blue). The case, the board and the heatsinks stay readable as shapes, nothing more. A part that is in the lens has its own colour and glow lifted by `POWER_LIFT` (about 1.9) so it keeps the look it had under the first, lighter veil.

The eye would undo this. The metered eye (`Eye`) and the local eye (`LocalEye`, run by `Post.setReach`) lift a dark picture back toward a middle grey. While the lens draws (`Lens3D.dark`):

- `Eye.hold(true)` keeps the metered eye where it was. `read()` drops each reading while it is held and the first `EYE_SKIP` (2) after it is released, so the picture does not jump back.
- `Post.setDark(true)` sets the local eye's strength to 0.
- The board's view (`board3d.ts`) does the same with its own metering (`heldReads`).
- The boot-time adaptation is skipped while the lens is on, so there is no dark flash.

### The cut-away

The basement's shroud (`SHROUD`, `basement3d.ts`) hides the supply and the fan hub from above. `Machine3D.powerGlow` hides it while the lens shows and puts it back when the lens ends. The fans' rings of light (a decoration, no power) drop to 0.1 of their level in the lens (`RING_IN_LENS`).

## The parts

`Machine3D.powerGlow(levels, warn, roles)` calls `PartSkin.electric(level, warn, role)` on each part's skin. The part's own colour goes to 0.6 (times `POWER_LIFT`), and the part glows in the colour of its role on the scale: amber for a use, cyan for a hub (the supply), white for a source. A part that has no role (a passive heatsink, a radiator, a dead part) keeps its own look. A part that draws nothing has no glow. The supply, when it trips, glows red (`warn`). A wide face (a card's shroud) glows softer (`LensView.soft`). The skins of a cooler's heatsink, a sink and the hoses follow the thermal view only (`follows` false), so the power lens does not light them.

The fans and the TPM have no skin in the other views, so the power lens makes **power skins** for them (`Machine3D.powerSkins`, `powerSkin(id, root)`): a case fan, a fan on a cooler, the sink fans and the TPM. A power skin shows only in this lens, one fan at a time (the fans share no material in it). A fan glows by its own draw, the TPM by its own.

## The scale (`core/render/three/powerscale.ts`)

One palette for every draw the lens shows: a dark amber is a trickle, a bright amber a working part, a pale hot gold the most the supply can give. A hub has its own palette (a deep teal to a pale ice) and a source has a warm white one. `levelOf(w, ref)` is `min(1, sqrt(w / ref) * 1.15)`: a square root, so a part that takes a few watts still shows beside one that takes a hundred. Red (`WARN`) is not on the scale: it says "wrong" (a cable that is out, a supply over its budget). The pulses' shader (`powerGlsl`), the parts' glow and the legend bar (`powerGradient`) are made from the same stops, so a colour means one draw everywhere.

## The words

`powerDraw` makes the tags; `AirTags3D` pins each as a light DOM pill. Text is sharp at any zoom.

- `WALL 54 W` over the wall socket (source), `SUPPLY 54 W / 250 W` over the supply (hub; red when it tripped), `MONITOR 3.0 W`.
- `CPU VRM 4.7 W (1.0 W lost)` and `RAM VRM 1.2 W (0.3 W lost)` over the two regulator plates (hubs; the loss shows when it is 0.05 W or more).
- One pill for each kind of part: `CPU`, `RAM` (all sticks), `GPU`, `NPU`, `NIC`, `TPM`, `DRIVE` (one for each drive: they stand far apart), and `FAN HUB` at the fan hub (a hub).
- Each pill starts with a chip of its role: a circle (source, white), a diamond (hub, cyan) or a triangle (use, amber), so the roles read without the colour too.
- A legend under the scale pill: the three chips with their words, `source`, `hands on`, `uses`.
- Warnings, at the open socket of each cable that is out: `PLUG THE PC IN`, `PLUG THE MONITOR IN`, `NO MAIN POWER`, `NO CPU POWER`, `NO CARD POWER`, `NO FAN POWER`; and `NO POWER SUPPLY` when there is none.
- A scale pill under the first words: a bar of the palette from `0 W` to the draw at the top of the scale.
- The words of each part's draw, the regulators and the `FAN HUB` words are details (`minor`). They show only while the case takes more than about half of the view's height: from `BIG` (0.52) up, until it falls under `SMALL` (0.45; the two differ so a view that rests between them does not flicker). In the room's view the machine is small, and the main words (`WALL`, `SUPPLY`, `MONITOR`, the warnings and the scale) are enough. `PowerView3D` measures the share by projecting the corners of the case's box, `share`.

## Tools

- `window.__power` (dev build): `shapeNow`, `drawNow`, `flowsNow`, `wordsNow` (the words pinned now), `cost` (ms a frame). Set `seen = null` to make it write the snapshot again after a change to the snapshot in the console.
- `npm run powercheck` (`tools/powercheck.mjs`): the lens on each case:board pair of Build my PC, with a basic machine (a card, a SATA drive and an M.2 drive where the board takes them) switched on. It checks that the shape is built, that every point is a number, that every power cable and every drive's lead has a line and a ring, that nothing is missing while every cable is in, that the words and the scale are there, that the parts glow, and that a frame costs under 1 ms. Then it switches the machine off and pulls the 24-pin, the 8-pin and the card's lead: each must have its ring open, its lines missing and its warning words. `--shots <dir>` saves two pictures of each pair. It needs a real GPU (software GL stops it). About 1 minute for ten pairs.
- A picture of the real game: `node tools/shot.mjs <out.png> --view board --keys p --wait 5000 --eval "(await import('/src/app/store.ts')).powerButton()"` (the sandbox start has all cables in). In Build my PC: `window.__build` and the dev hook `window.__power`; the stage never steps its game, so the machine is switched on with `__build.game.powerButton()` and its draws are those of the snapshot.
- Tests: `power/ledger.test.ts` (the flows add up, the missing and idle states, the cards' shares, the fans), `power/net.test.ts` (the lines from the real cables and buses, the stubs, the rings, the words, the glow), `power/flows.test.ts` (the strips and what a snapshot writes into them), `power/view.test.ts` (the view on a real machine, the words of detail), `machine3d.runs.test.ts` (the runs of the real machine: order, `fed`, `cablesRev`, `heldCables`, `partBox`), `machine3d.power.test.ts` (the parts in the lens: a fan and the TPM alone, the role colours, red on a trip, the shroud off, the fans' rings low, a part with no role), `core/render/three/powerscale.test.ts` (the scale and the roles), `materials.test.ts` (`PartSkin.electric`), `core/render/three/eye.test.ts` and `post.test.ts` (the eye held, the local eye off), `air/airtags.test.ts` (the watts tone, the role chip, the scale and the legend).

## What it does not do

- It does not feed back to the sim. The sim has the draw by device and by cable; the lens only shows it.
- The run of a lead from the supply behind the tray is not modelled: the lens shows a short stub of it, not the whole run. The supply's own unit glows as a whole (cyan), not by its parts.
- A part with no copper of its own on the board rides the strip beside the 24-pin: it is a clean run, not the real route.
- The 2D live die (the close CPU view) is not lit by the lens.
- Build my PC does not run its machine. The lens shows the cables and the copper idle, at 0 W. (In dev, `__build.game.powerButton()` switches the machine on for a picture: then the draws are the idle draws of the parts, with no work running.)
