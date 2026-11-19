# Rendering: the airflow lens (3D air)

Part of the renderer docs; the hub is [`RENDER.md`](../RENDER.md). Code: `src/features/board/render/three/air/`. The lens's words and numbers (the model) are in `src/features/room/render/desk/airflow.ts`; see "The airflow lens" in [`room.md`](../../src/features/room/room.md).

The lens shows the air of the case as particles in the machine's own 3D space. The air goes round the real parts, takes heat from the hot ones by the sim's coefficients, and leaves where a fan or a grille lets it. The coolant of a liquid loop and the air of the power supply run as particles on lines of their own. Nothing here changes the sim: the lens is a picture of the same machine, fed by the same numbers.

## Cost: what is made once, what runs each frame

The case, the parts and the fans do not move. So the flow is solved once for a machine, and a frame only moves particles.

| When | What | Cost |
|---|---|---|
| a part is fitted or removed (`planKey` changes) | the plan, the grid, one solved flow per fan | about 0.2 s of work for a full tower (13,700 cells, 8 fans), done in slices of 4 ms a frame |
| a fan changes speed | the fans' flows are added again with the new weights (flow is linear in the fans' flows) | one pass over the cells, no solve |
| each snapshot | the hot parts' temperatures and coefficients (`airParts`), the words, the coolant loop and the supply's channel | tiny |
| each frame | about 1,900 particles move (trilinear sample of the field, eddies, collisions, heat) and the ribbons' buffer is copied | 0.6 to 0.9 ms on the main thread (`AirView3D.cost`) |

There is no per-frame solve and no per-frame grid work. The particles are a structure of arrays; no step allocates.

## Files (`board/render/three/air/`)

| File | Role |
|---|---|
| `plan.ts` | pure: the STATIC plan (`airPlan`: the case's air box, the parts' boxes with how well air passes each, the vents, the fans), the LIVE parts (`airParts`: temperature, power, coefficient), `airReference` (the case air's mean temperature), and the lines the coolant and the supply's air follow (`loopPath`, `pathLine`, `coolantAt`) |
| `grid.ts` | pure: the voxel grid. Each cell's open share along x, y and z; the faces' conductances; the per-cell lists of boxes (for collisions); vents as ground conductances |
| `solve.ts` | pure: the flow. A potential flow on the grid, solved fan by fan (a "basis") by a matrix-free Jacobi-preconditioned conjugate gradient, a slice per frame. `AirField.sample` reads the speed at a point (trilinear) |
| `build.ts` | pure: `AirSim` builds the grid and the field from a plan, holds the fans' levels (`levels(fn)`), the inflow, the inlet cells (`inlet(u)`: weighted by what comes in there) and the exit cell of each wall (`exits`) |
| `particles.ts` | pure: `AirParticles`. Air, coolant beads and the supply's air, their trails, collisions, heat exchange, births and deaths |
| `ribbons.ts` | Three: `Ribbons` (the particles as instanced ribbons, two passes) and the dark veil |
| `airtags.ts` | the words as light DOM pills pinned to 3D points (`AirTags3D`) |
| `view.ts` | `AirView3D`: owns all the above, rebuilds on a new plan, feeds the fans' speeds, calls the steps. `Lens3D` (`lens3d.ts`) hosts it |
| `debug.ts` | the plan as lines for the developer (`window.__air.debug = true`) |

`sim` files are pure TS (no DOM, Pixi or Preact); a test builds a plan by hand or from the real layout (`*.test.ts` next to each file).

## The frame

The machine's root is the scene space: x east, y up (the layout's y runs down: world y is minus layout y), z toward the glass; 23,000 units to a metre (`UNITS_PER_M`). The air's domain is the case's inside, from the tray (`CASE_Z + 70`) to the glass (`CASE_FRONT`). The six walls are numbered 0 to 5: -x, +x, -y, +y, -z, +z. The front fans are on the east wall (1), the rear fan on the west wall (0), the top fans on the top wall (3). The layout constants are live bindings (`setLayoutTier`): the plan is made again on a tier change.

## The plan

- **Boxes** (`AirBox`): `Machine3D.airBodies()` gives each part's box in the machine's space (device id and kind; the board, the basement, the drive cage and the RAM bank as bodies of their own). `BODY_K` says how well air passes each kind along each axis (0 a wall, 1 free): the board and the basement are walls, the drives' cage lets 0.45 pass along x, a RAM stick lets air run along it and hardly across. The cooler's boxes are its own (`COOLER_AIR` in `cooler3d.ts`: the tower's stack, the stock heatsink, the pump head). The grid makes a thin plate block its normal and let air slide along its face (a harmonic mean of the two cells).
- **Fans**: a wall fan (`kind: 'wall'`: a disc on a wall, in or out) for each case mount with a fan fitted; an inner fan (`kind: 'inner'`: a plane across an axis, air from the cells behind it to the cells before it) for the cooler's fans, the two regulator sinks' and a card's (blowing up into its fins). A radiator's side keeps its fans, which then blow through the radiator's core (a box that passes air). The flow of a fan follows its size, its spec's `airflow` and `FAN_FACE_MS`.
- **Vents**: the rear grille where there is no rear fan (a fitted fan that stops shuts its wall by its own stiffness), the expansion slots, the front's mesh and the top's.
- Each fan has a `bank`: the id its speed is published under in `fanBank` (`case:front0`, `radiator:top1`, `cooler`, `vrm`, `ramvrm`, `gpu:<slot>`).

## The flow

Each fan alone makes a flux through its plane; the grid's conductances carry it; a wall fan's flow falls as pressure builds against it (its stiffness `kf`: a fan into a closed box stalls), an inner fan's by the conduction of the faces it sits on. That is a linear problem, so each fan is solved ALONE once into a field of velocities (a basis), and the air at any fan speeds is the weighted sum of the bases. `AirSim.levels` takes the weights from `fanBank` (through `levelOf` in `view.ts`: a fan that turns blows at 0.3 to 1.0 of its flow by its speed; one that does not turn blows none). Velocities are capped at `V_MAX`. A machine with no exhaust has its flow stall: the intake brings little and the lens says `NO EXHAUST`.

## The particles

- **Births**: air is born at the intake cells (a front fan, a vent that air comes in through), by the share of the inflow each has, with the room's temperature. A steady count is kept (`target`: a rate of births replaces what has left or aged). A paused game (`dt` 0) holds everything.
- **Motion**: each parcel rides the flow, plus eddies (a velocity that wanders and fades: the streams are not combed) and buoyancy (it rises as it is warmer than the room). What the air does in game time is shown at half pace (`TIME_SCALE`): the real air crosses a case in a second, too fast to follow.
- **Collisions**: the boxes are exact (a per-cell list; the grid only sets the flow). A parcel that runs into a box slides along its face; one born or pushed inside a wall is put out by the nearest face. The case's walls keep it in; where an exit cell is, it dies.
- **Heat** (`exchange`): a parcel inside a hot part's reach takes heat by that part's coefficient `ua` (W/K) from the sim: `power / max(1.5, surface - air)`. A heatsink's fins are at `air + 0.7 x (die - air)`, a card's surface at 0.75 of its rise, the radiator's at the water's mean with the power the loop rejects. The exchange grows with the air's speed over the part (forced convection: `(speed / U_REF)^0.6`, between 0.35 and 2.2), and a part in still air still gives its natural share. A parcel never takes more than the part has. A warm parcel mixes toward the case's mean air (`MIX_TAU`) but never cools below it.
- **Wisps**: a hot part in calm air lets warm parcels rise off it.
- **Trail**: five points per particle. The trail moves on by DISTANCE (a streak is as long as the air is fast, between 180 and 700 units); still air moves it on after `TRAIL_WAIT`.

### Water cooling

The liquid loop is a closed line (`loopPath`): the hot hose from the pump to the radiator, the radiator's tubes, the cold hose back, the pump's block (from the hose paths `Machine3D.loopPaths()`, which follow the real cords). Beads of coolant run along it at the pump's flow (`board.loop.flow`) and are coloured by the water's temperature at their place (`coolantAt`: hot to the radiator, cooled through it, cold back, heated in the block; blue at 22 C to orange at 62 C). A bead that comes round to the start leaves no trail across the loop. The radiator is a porous part whose coefficient comes from `rejectW`: the air that crosses its core leaves warm, and a front radiator warms the case (the lens says `WARMS THE CASE`).

### The power supply

The supply has its own 3D channel (the model's lane `fan.psu`: in from below the case, through its shroud, out the rear), run by beads of its air at the supply's fan speed (`1 + 8 x load` by the 2D board's rule, eased by a `FanMotor` in `view.ts`; the 3D machine has no PSU fan to publish it). The beads warm toward the supply's temperature along the channel and fade in and out at its ends.

## The drawing (`ribbons.ts`)

- One instanced mesh with a fixed pool; each particle is a strip along its trail, turned to face the camera (the side vector is taken end to end of the trail, not step by step: the head's step is short and turns with every eddy).
- The width is between 0.9 and 3 pixels a side whatever the size the air has in the machine (a thread from far, a fine streak from close), and tapers to the tail; the alpha falls along the trail. Colour by temperature: blue at the room's, amber, red at `AIR_RANGE_C` (18 K) over it; the water's has its own ramp. Additive blending, linear colours, no tone mapping.
- Two passes. The air is depth-tested: parts hide the streaks that pass behind them. The coolant and the supply's air are drawn with the depth test off, as they run inside opaque hoses and a casing that would hide them.
- **Quiet cold, loud heat**: the room's own air keeps half the brightness (`COLD_SHARE`) and the air that took heat stands out, so the eye finds where the heat goes.
- **Near fade**: streaks nearer to the eye than 20 cm (4,500 units) are invisible, whole at 43 cm. The camera of a close-up stands inside the case; without the fade a long line would cross the die the player came to see.
- **The veil**: a full-screen dark quad under the ribbons dims the room so the air reads (`makeVeil`, alpha 0.5).
- The density follows the graphics setting (`effective.particles`: 0.4, 0.7, 1.0 of 1,900).

## The words

`airflowModel` (room) makes the tags and the warnings from the snapshot: `RAD 61 W - COOLANT 46 C - IN 49 C OUT 43 C`, `CASE AIR 25 C`, `PSU CASE 38 C`, a part's temperature and trend, and the warnings `NO FAN TURNS`, `NO EXHAUST: HOT AIR STAYS IN`, `NO INTAKE: THE CASE STARVES`, `FAN OFF`, `MACHINE OFF`. `AirView3D.words` pins each at a 3D point on the glass side (`CASE_FRONT - 150`); `AirTags3D` draws them as DOM pills (sharp at any zoom, no draw calls).

## Where the fan speeds come from

`fanBank` (`core/render/fanmotor.ts`) holds a speed per fan id. The 3D machine's fans publish it: `Machine3D.frame` eases each fan (`needs`: its cable) and writes the speed of its bank (`fanBank.setLevel`; the radiator's fans on a radiator side are `radiator:<mount>`, the others `case:<mount>`; the cooler, the VRM and the memory sink by their header). The cards' fans come from `gpuview.ts`. So the air blows as hard as the fans on the screen turn, ramps up with them and dies away as they coast down. The Build my PC stage never steps its game, so its machine is off unless a dev harness forces the speeds.

## Tools

- `window.__air` (dev build): `planNow`, `simNow` (`field.ready`, `inflow`, `banks`), `particlesNow` (`P`, `T`, `K`, `count`), `partsNow`, `cost` (ms a frame), `debug = true` (the plan as lines: the domain white, bodies red and orange, fans as rings with a stick along the flow, vents blue).
- A picture of the real game: `node tools/shot.mjs <out.png> --view board --wait 9000 --eval "<js>"` with `const h = await import('/src/app/hover.ts'); h.airflowLens.value = true; await (await import('/src/app/store.ts')).powerButton(); await new Promise(r => setTimeout(r, 12000));` (the machine must run: all cables in; the sandbox start has them). `--look x,y,z,yaw,pitch,height` frames a view; `--view cpu` is the die close-up.
- Tests: `air/*.test.ts` (grid, flow, plan from the real layout, the sim's inlets and exits, the particles' collisions, heat, loop and channel, the tags) and `desk/airflow.test.ts` (the model).

## What it does not do

- It does not feed back to the sim: the sim cools by area (`board/sim/airflow.ts`) and has no particles.
- The flow is a potential flow with stiffness and conduction, not Navier-Stokes: no turbulence model beyond the eddies, no wake behind a part, no pressure on the glass. The shape of the streams (round a part, through fins, out of a grille) and the way a stopped or missing fan changes them is what it shows.
- Parts that move while the plan stands (the side panel, a cable) are not boxes. The plan changes only when a part is fitted or removed.
