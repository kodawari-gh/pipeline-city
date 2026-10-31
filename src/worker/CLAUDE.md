# src/worker (sim entry) and src/features/*/sim
- Pure TypeScript, runs in the worker. No DOM, Pixi or Preact imports. `architecture.test.ts` enforces it.
- The only thing shared across the thread boundary is `protocol.ts` (`Snapshot` out, `ToSim` in).
- `game/game.ts` is the `Game` state and constructor. Its methods live in feature files: `src/features/<f>/sim/` (header of `game.ts` lists them). Grep the method name. Each export of such a file is a `Game` method written `function x(this: Game, ...)`; feature files import `Game` as a type only. Numbers live in `ECONOMY` (`features/economy/sim/economy.ts`).
- Docs sit in the feature folder: economy `GAME.md`, `PROGRESSION.md`; jobs `JOBS.md`; cpu `CPU.md`, `ASSEMBLY.md`; os `OS.md`. Saves: `src/worker/SAVE.md`.
- Test the file you touched: `npx vitest run src/features/<f>/sim/<name>.test.ts`.
