# Pipeline City

Incremental game about building computing hardware. TypeScript, Vite, PixiJS (board), Preact + signals (UI), simulation in a Web Worker.

## Commands
- `npm run dev` | `npm run typecheck` | `npm run build` | `npm run prod` (build, then serve the optimized game and open it)
- While working run only what you touched: `npx vitest run <path>`. `npm run test:fast` (about 30 s, no heavy or browser files) any time. Before a push: `npm run test:q` (fast, then only the heavy files whose imports changed since `origin/main`). Before a merge into `main`: `npm run test:heavy` (all heavy files, about 13 min; it also catches changes to files a test reads as text). Browser files: `T44_BROWSER=1 npm run test:browser`, one Chrome at a time.
- A test file that takes 10 s or more goes in `tools/heavy-tests.ts` (the `heavy` project in `vite.config.ts`).

## Where to look
- Start with `docs/MAP.md` (architecture overview). To find code, use the `cocoindex-code` MCP search (`mcp__cocoindex-code__search`) before Grep or Glob.
- Feature-first: `src/features/<f>/{sim,render,ui}` + the feature doc, for `cpu gpu npu tpm memory storage network os board economy jobs tutorial room sandbox`. Read `src/features/CLAUDE.md`.
- `src/worker` sim entry, `protocol.ts` and the `Game` state (`worker/game/game.ts`; its methods live in `features/*/sim`, see its header: Grep for the method). `src/app` main-thread state, signals, save/load. `src/core/{sim,render,ui}` shared code.
- `sim/` code is pure TS, no DOM/Pixi/Preact (`src/architecture.test.ts` checks it).
- A test sits next to the file it covers (`x.ts` -> `x.test.ts`).

## Agent skills

### Issue tracker

GitHub Issues in `kodawari-gh/pipeline-city`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Docs: read one, by topic, only when needed
- Cross-layer work only: `docs/ARCHITECTURE.md`.
- Feature docs sit in the feature folder: `src/features/<f>/*.md` (`ls` it). Cross-cutting: `docs/RENDER.md` (hub with a topic table to `docs/render/{interact,live,board,case,net}.md` and `src/features/room/{room,shell,light}.md`), `docs/UI.md`. Saves: `src/worker/SAVE.md`.
- Docs over ~20 KB (`render/interact`, `NETWORK`, `PROGRESSION`, `UI`, `ASSEMBLY`): Grep `^## ` for the headings, then Read only that section. Never read them whole.

## Rules
- The old prototype `legacy/` is not in this tree; it lives on the `legacy-archive` branch (`git show legacy-archive:legacy/<file>` only if asked). Never read `dist/` or `package-lock.json`.
- Work list: the GitHub project board (project 4, owner `kodawari-gh`), via the `update-gh-board` skill. There is no TODO file. Do not add runner scripts here.
- Other sessions share the working tree: new files and small edits, stage explicit paths only (never `git add -A`).
- Rendering or UI work (anything under `src/core/render`, `src/core/ui`, CSS): look at it before calling it done. Run `npm run shot -- <out.png> [--view cpu|board|x,y,z] [--clip hud]` (`tools/shot.mjs`: headless Chrome on the real GPU, never software GL, it prints the GL renderer and stops on SwiftShader), then Read the png and fix what looks wrong; save shots in the scratchpad, not the repo. Tests and typecheck do not show an invisible icon, overlapping layers or a cheap look. If you cannot get a screenshot, say so plainly in the report instead of claiming it works.
- Before a push, and after any change that could differ in the optimized build (rendering, workers, imports, dev-only code), run `npm run build` and test the compiled game, not just the dev server: `npm run shot -- <out.png> --prod [--view cpu|board]` builds, serves it with `vite preview` and screenshots it. Guard anything that only exists in dev (`import.meta.env.DEV`, `window.__board`).
- Use Edit, never rewrite a file from a script. UI sizes are relative units (`src/core/ui/scaling.test.ts` stays green).
- Always commit your work when a task is done (explicit paths only, after the touched tests and `npm run typecheck` pass); do not leave it uncommitted for the user to ask.
- Commit subject <= 72 chars, body <= 3 lines. Final report: 3 lines max, no recap of the diff.
- Style: Simplified Technical English (ASD-STE100). Short active sentences, one idea each, no filler.
- No text between tool calls. Speak only to report a blocker, ask a needed question, or give the final report. Give longer explanations only when asked.
