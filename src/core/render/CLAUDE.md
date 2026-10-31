# src/core/render and src/features/*/render
- Pixi only. Reads snapshots/signals, never touches sim internals.
- Shared helpers here: camera, theme, ink, shape, live, interact, capture, lod. Feature views live in `src/features/<f>/render/` (`cpu` die, `board` board and wiring, `room` desk and props, `gpu`, `npu`, `tpm`, `memory`, `storage`, `network`).
- Docs: `docs/RENDER.md` is the hub (<= 15 KB) with a topic table to `docs/render/` (`interact`, `live`, `board`, `case`, `net`) and `src/features/room/` (`room`, `shell`, `light`); read the one for your topic. Die view: `src/features/cpu/DIE.md`. Board: `src/features/board/BOARD.md`.
- Test the file you touched: `npx vitest run src/features/<f>/render/<name>.test.ts`.
