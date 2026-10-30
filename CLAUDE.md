# Pipeline City

Incremental game about building computing hardware. TypeScript, Vite, PixiJS (board), Preact + signals (UI), simulation in a Web Worker.

## Commands
- `npm run dev` | `npm run typecheck` | `npm run build`
- While working run only what you touched: `npx vitest run <path>`. Full `npm run test:q` (quiet) only before a push; plain `npm test` only to debug a failure.

## Where to look
- `src/sim` pure TS, no DOM/Pixi/Preact. `sim/game/game.ts` is the `Game` state; its methods live in feature files next to it (see its header): Grep for the method.
- `src/game` main-thread state, signals, save/load. `src/render` Pixi (`die/`, `board/`, `room/`). `src/ui` Preact (`panels/`, `shop/`, `tutorial/`, `kit/`).
- A test sits next to the file it covers (`x.ts` -> `x.test.ts`).

## Docs: read one, by topic, only when needed
- Cross-layer work only: `docs/ARCHITECTURE.md`.
- render, board, room -> `RENDER.md` (hub with a topic table to `render/{interact,live,board,case,net}.md` and `render/room/{room,shell,light}.md`), `BOARD.md` | die, CPU -> `DIE.md`, `CPU.md` | UI, panels -> `UI.md` | economy, loop -> `GAME.md` | jobs -> `JOBS.md`, `GEN.md` | levels, unlocks -> `PROGRESSION.md` | network -> `NETWORK.md`, `NETSTACK.md` | OS, kernel -> `OS.md` | saves -> `SAVE.md` | accelerators -> `ACCEL.md` | GPU engines, card view -> `GPU.md` | assembly, install -> `ASSEMBLY.md`
- Docs over ~20 KB (`render/interact`, `NETWORK`, `PROGRESSION`, `UI`, `ASSEMBLY`): Grep `^## ` for the headings, then Read only that section. Never read them whole.

## Rules
- The old prototype `legacy/` is not in this tree; it lives on the `legacy-archive` branch (`git show legacy-archive:legacy/<file>` only if asked). Never read `dist/` or `package-lock.json`.
- Work list: `docs/TODO.md` (tagged, bite-size tasks), run by the separate `prompt-system` repo; do not add runner scripts here.
- Other sessions share the working tree: new files and small edits, stage explicit paths only (never `git add -A`).
- Rendering or UI work (anything under `src/render`, `src/ui`, CSS): look at it before calling it done. Run `npm run shot -- <out.png> [--view cpu|board|x,y,z] [--clip hud]` (`tools/shot.mjs`: headless Chrome on the real GPU, never software GL, it prints the GL renderer and stops on SwiftShader), then Read the png and fix what looks wrong; save shots in the scratchpad, not the repo. Tests and typecheck do not show an invisible icon, overlapping layers or a cheap look. If you cannot get a screenshot, say so plainly in the report instead of claiming it works.
- Before a push, and after any change that could differ in the optimized build (rendering, workers, imports, dev-only code), run `npm run build` and test the compiled game, not just the dev server: `npm run shot -- <out.png> --prod [--view cpu|board]` builds, serves it with `vite preview` and screenshots it. Guard anything that only exists in dev (`import.meta.env.DEV`, `window.__board`).
- Use Edit, never rewrite a file from a script. UI sizes are relative units (`src/ui/scaling.test.ts` stays green).
- Always commit your work when a task is done (explicit paths only, after the touched tests and `npm run typecheck` pass); do not leave it uncommitted for the user to ask.
- Commit subject <= 72 chars, body <= 3 lines. Final report: 3 lines max, no recap of the diff.
- Style: Simplified Technical English (ASD-STE100). Short active sentences, one idea each, no filler.
- No text between tool calls. Speak only to report a blocker, ask a needed question, or give the final report. Give longer explanations only when asked.
