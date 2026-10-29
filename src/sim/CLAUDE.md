# src/sim
- Pure TypeScript, runs in the worker. No DOM, Pixi or Preact imports.
- The only thing shared across the thread boundary is `protocol.ts` (`Snapshot` out, `ToSim` in).
- `game/game.ts` is the `Game` state and constructor; its methods are in feature files beside it (header of `game.ts` lists them: `parts`, `shop`, `machine`, `keys`, `clients`, `os`, `memory`, `network`, `snapshot`, `persist`...). Grep the method name. Each export of a feature file is a `Game` method written `function x(this: Game, ...)`; feature files import `Game` as a type only. Numbers live in `ECONOMY` (`game/economy.ts`).
- Docs: economy `docs/GAME.md`, jobs `docs/JOBS.md`, levels `docs/PROGRESSION.md`, assembly `docs/ASSEMBLY.md`, OS `docs/OS.md`, CPU `docs/CPU.md`.
- Test the folder you touched: `npx vitest run src/sim/game/<name>.test.ts`.
