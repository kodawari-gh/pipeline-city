#!/usr/bin/env bash
# Runs one fresh `claude -p` session per task from docs/TODO.md, sequentially.
# usage: scripts/todo-runner/run-todos.sh T11 T12 T13     (task ids, in the order to run)
# env:   CLAUDE_BIN=path to claude executable if not on PATH
#        ALLOW_DIRTY=1 to start with uncommitted changes (otherwise refuses)
#        MAX_TURNS=60  per-task turn cap
# Only open `[auto]` tasks run; `[human]` and `[owner]` tasks are refused.
set -u
cd "$(dirname "$0")/../.."
LOGS=scripts/todo-runner/logs
mkdir -p "$LOGS"
CLAUDE="${CLAUDE_BIN:-claude}"

if [ -n "$(git status --porcelain)" ] && [ "${ALLOW_DIRTY:-0}" != "1" ]; then
  echo "working tree is dirty; commit/stash first or set ALLOW_DIRTY=1"; exit 1
fi

total=0
for id in "$@"; do
  task=$(grep -E "^- \[ \] $id " docs/TODO.md | head -1)
  [ -z "$task" ] && { echo "$id: not found or already done, skipping"; continue; }
  case "$task" in *"[auto]"*) ;; *) echo "$id: not tagged [auto], refusing"; continue ;; esac
  echo "== $id =="
  before=$(git rev-parse HEAD)

  "$CLAUDE" -p "Read docs/TODO.md (the rules at the top apply), then do ONLY this task:
$task
If the code already does what the task asks, change nothing except ticking the box.
When done: tick this task's box in docs/TODO.md, add a line to docs/HANDOVER.md 'Traps' only if you hit a real trap, and make one commit with a clear message. If blocked or it needs an owner decision, change nothing and say why in one line." \
    --model sonnet \
    --permission-mode acceptEdits \
    --allowedTools "Read" "Edit" "Write" "Glob" "Grep" "Bash(npm run *)" "Bash(npm test)" "Bash(npx vitest:*)" "Bash(npx tsc:*)" "Bash(git add:*)" "Bash(git commit:*)" "Bash(git status)" "Bash(git diff:*)" \
    --max-turns "${MAX_TURNS:-60}" \
    --output-format json > "$LOGS/$id.json" 2> "$LOGS/$id.err"

  cost=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));total=j.total_cost_usd;console.log(j.subtype+" $"+total.toFixed(2)+" "+j.num_turns+" turns | "+String(j.result||"").slice(0,400))}catch(e){console.log("NO OUTPUT (see "+process.argv[1].replace(".json",".err")+")")}' "$LOGS/$id.json")
  echo "$cost"

  case "$cost" in
    NO\ OUTPUT*) echo "$id: claude did not run, stopping"; break ;;
    error_max_turns*) echo "$id: hit the turn cap; uncommitted changes may remain, review with git status"; break ;;
  esac
  if [ "$(git rev-parse HEAD)" = "$before" ]; then echo "$id: no commit made, stopping"; break; fi
  if ! npm run build >/dev/null 2>&1; then echo "$id: build failing after commit, stopping"; break; fi
done
