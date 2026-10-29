# src/render
- Pixi only. Reads snapshots/signals, never touches sim internals.
- Layout: shared helpers here (camera, theme, ink, shape, live, interact, capture); `die/` CPU die, `board/` board and wiring, `room/` desk, wall, props, light.
- Docs: `docs/RENDER.md` is 120 KB. Grep `^## ` and Read one section. Die view: `docs/DIE.md`. Board: `docs/BOARD.md`.
- Test the file you touched: `npx vitest run src/render/<area>/<name>.test.ts`.
