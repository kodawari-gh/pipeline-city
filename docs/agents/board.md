# Project board: GitHub Projects

Config for the `update-gh-board`, `to-tickets`, `ticket-swarm` and `orchestrate-parent` skills.

| What | Value |
| --- | --- |
| Owner | `kodawari-gh` |
| Project number | `4` |
| Repo | `kodawari-gh/pipeline-city` |
| Project id | `PVT_kwHOA2XHg84BsuAo` |
| Status field | `PVTSSF_lAHOA2XHg84BsuAozhq6zYA` |
| Status: Backlog / Ready / In progress / In review / Done | `f75ad846` / `61e4505c` / `47fc9ee4` / `df73e18b` / `98236657` |
| Planned model field | `PVTSSF_lAHOA2XHg84BsuAozhq-R_k` |
| Planned: Opus / Sonnet / Haiku / Human / Parent | `7f4653d4` / `cde2c3a7` / `46bb0cb7` / `d285167b` / `1fc3c805` |
| Rounds field (number) | `PVTF_lAHOA2XHg84BsuAozhrHypY` |
| Swarm log | `docs/agents/swarm-log.md` |

Legacy fields, read only: `Model` (winning model) and `Swarm effort`.

## Repo notes

- `jq` is not installed: use `gh ... --jq`.
- Test one file: `npx vitest run <path>`. Checks every ticket runs: `npm run typecheck`; UI sizes: `npx vitest run src/core/ui/scaling.test.ts`; rendering or UI: `npm run shot` (see `CLAUDE.md`).
- A worktree that needs packages runs `npm ci` (no `node_modules` junction).
- Planned model hints from the swarm log: UI layout tickets took 4 rounds from Haiku; plan them on Sonnet.
- Held for human sign-off: #31.
