# src/sim
- Pure TypeScript, runs in the worker. No DOM, Pixi or Preact imports.
- The only thing shared across the thread boundary is `protocol.ts` (`Snapshot` out, `ToSim` in).
- `game/game.ts` is ~3000 lines: Grep the symbol, Read with offset/limit. Numbers live in `ECONOMY` (`game/economy.ts`).
- Docs: economy `docs/GAME.md`, jobs `docs/JOBS.md`, levels `docs/PROGRESSION.md`, assembly `docs/ASSEMBLY.md`, OS `docs/OS.md`, CPU `docs/CPU.md`.
- Test the folder you touched: `npx vitest run src/sim/game/<name>.test.ts`.
