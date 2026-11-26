// The 3D world's mount (docs/render/three.md): the game's view (`app/main.tsx`). It builds the room and the machine from the snapshot, drives the orbit camera,
// picks with rays and writes the hover / selected signals, so the HUD's tooltips and cards work. The dies run on `Chips3D`. Parts, cables and keys drag (`drag3d.ts`).
// The die's blocks hover and click (`Chips3D.hitAt`), the lenses lie over the view (`Lens3D`, keys P and A). The room's materials take its probe
// at every height (`RoomEnv`), and so does the machine: it reads at night by the room's lamps alone, at every zoom (`src/features/room/light.md`).
// The world itself lives in `world/`: the stage, what is built, the view, the hands, the frame and the dev hook (`world/mount.ts` boots it).
export { mountBoard3d } from './world/mount';
