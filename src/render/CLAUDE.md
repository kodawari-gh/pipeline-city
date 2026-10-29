# src/render
- Pixi only. Reads snapshots/signals, never touches sim internals.
- Layout: shared helpers here (camera, theme, ink, shape, live, interact, capture); `die/` CPU die, `board/` board and wiring, `room/` desk, wall, props, light.
- Docs: `docs/RENDER.md` is the hub (<= 15 KB) with a topic table to `docs/render/` (`interact`, `live`, `board`, `case`, `net`) and `docs/render/room/` (`room`, `shell`, `light`); read the one for your topic. Die view: `docs/DIE.md`. Board: `docs/BOARD.md`.
- Test the file you touched: `npx vitest run src/render/<area>/<name>.test.ts`.
