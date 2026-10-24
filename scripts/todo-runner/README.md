# todo-runner

Runs `docs/TODO.md` tasks as one fresh `claude -p` session each, so context never piles up between tasks.

| File | Role |
|---|---|
| `docs/TODO.md` | The work list and the format contract (task lines, tags, rules). |
| `run-todos.sh` | Runs the listed task ids in order. |
| `update-todo.prompt.md` | The prompt that has Claude update `docs/TODO.md` (tick done work, add split tasks). |
| `logs/` (git-ignored) | One `<id>.json` and `<id>.err` per run, plus `costs.tsv`. |

## Loop

1. Update the list: open a Claude session, paste `update-todo.prompt.md`, fill "Notes from me" with decisions or new goals.
2. Run a batch, from Git Bash at the repo root:

   ```bash
   ALLOW_DIRTY=1 CLAUDE_BIN="/c/Users/<you>/.vscode/extensions/anthropic.claude-code-<ver>-win32-x64/resources/native-binary/claude.exe" \
     scripts/todo-runner/run-todos.sh T11 T12 T13
   ```

   `CLAUDE_BIN` is only needed if `claude` is not on PATH. Leave `ALLOW_DIRTY` out for a clean tree (the script then refuses to start on uncommitted changes, so it cannot sweep your edits into a task commit).
3. Read `logs/costs.tsv` (task, model, outcome, cost, turns, committed). Repeat.

## What the script does

- Runs only open `[auto]` tasks. `[human]` and `[owner]` tasks are refused.
- Puts the rules block and the one task line in the prompt; the agent does not read the whole TODO file or HANDOVER.md.
- Model comes from the `{haiku|sonnet|opus}` tag on the line; untagged means haiku. A failed haiku run (turn cap, no commit) is retried once on sonnet.
- Stops the batch on: claude not running, turn cap (`MAX_TURNS`, default 60), no commit (blocked), or a red build after the commit.
- Each task: one commit, its own box ticked.

## Env

`CLAUDE_BIN`, `ALLOW_DIRTY=1`, `MAX_TURNS=60`, `MAX_BUDGET_USD=1.50` (hard dollar cap per run), `AUTOCOMPACT=150000` (context size that triggers compaction; 100k to 1M), `VISUAL_FLOOR=0` (let haiku take visual tasks).

Visual/UI tasks (paths with `src/render`, `.tsx`, `.css`, `PartArt`, `Hud.`, `NetPanel`, or the words screenshot or visual) are raised from haiku to sonnet by the script. There is no hard context-size cap; a bare call already starts at about 64k tokens, so keep `AUTOCOMPACT` well above that. Cost is bounded by `MAX_TURNS` and `MAX_BUDGET_USD`.

## Traps

- Run it from Git Bash on Windows, not PowerShell (`VAR=x cmd` syntax) and not WSL (the `/c/...` path does not exist there).
- Do not edit `run-todos.sh` or `docs/TODO.md` while a batch runs: the agents tick boxes in the same file.
- Auto-mode classifiers may block launching the script from an agent session; run it yourself or add a Bash permission rule for it.
- Vague `Files:` fields make agents search, which is where the cost goes. Name exact paths.
- Measured so far: bite-size tasks cost about $0.12 to $0.57 each; one oversized task ($2.05) hit the turn cap with no commit. Split anything that needs more than about 3 files.
