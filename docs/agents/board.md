# Project board: repo notes

Board ids and swarm settings: `docs/agents/board.json` (read by `board.mjs` and `swarm.mjs`). This file holds what agents need that the config cannot say.

- Test one file: `npx vitest run <path>`. Checks every ticket runs: `npm run check`; UI sizes: `npx vitest run src/core/ui/scaling.test.ts`; rendering or UI: `npm run shot` (see `CLAUDE.md`).
- Planned model hints from the swarm log: UI layout tickets took 4 rounds from Haiku; plan them on Sonnet.
- The owner gives sign-off. Hold a ticket only when its planned model is Human.
- Legacy board fields, read only: `Model` (winning model) and `Swarm effort`.
