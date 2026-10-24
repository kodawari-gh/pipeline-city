#!/usr/bin/env bash
# Runs one fresh `claude -p` session per task from docs/TODO.md, sequentially.
# usage: scripts/todo-runner/run-todos.sh T11 T12 T13     (task ids, in the order to run)
# env:   CLAUDE_BIN=path to claude executable if not on PATH
#        ALLOW_DIRTY=1 to start with uncommitted changes (otherwise refuses)
#        MAX_TURNS=60  per-task turn cap
#        MAX_BUDGET_USD=1.50  hard dollar cap per run (the run stops when it is reached)
#        AUTOCOMPACT=150000  context size (tokens, 100k-1M) at which a run compacts instead of growing
#        VISUAL_FLOOR=0  to let haiku take render/UI tasks (default: they are raised to sonnet)
# Only open `[auto]` tasks run; `[human]` and `[owner]` tasks are refused.
# Model: a task line may carry {haiku}, {sonnet} or {opus}; untagged tasks use the cheapest (haiku).
# A haiku run that fails (turn cap, no commit, red build) is retried once on sonnet.
# Every run is appended to logs/costs.tsv.
set -u
cd "$(dirname "$0")/../.."
LOGS=scripts/todo-runner/logs
mkdir -p "$LOGS"
CLAUDE="${CLAUDE_BIN:-claude}"
[ -f "$LOGS/costs.tsv" ] || printf 'task\tmodel\toutcome\tusd\tturns\tcommitted\n' > "$LOGS/costs.tsv"

if [ -n "$(git status --porcelain)" ] && [ "${ALLOW_DIRTY:-0}" != "1" ]; then
  echo "working tree is dirty; commit/stash first or set ALLOW_DIRTY=1"; exit 1
fi

# The rules block of TODO.md goes into the prompt, so the agent need not open the whole file.
rules=$(awk '/^## Rules for every task/{f=1;next} /^## /{f=0} f' docs/TODO.md)

# run_one <id> <task line> <model> [retry]  -> sets OUTCOME and COMMITTED
run_one() {
  local id="$1" task="$2" model="$3" retry="${4:-}" before out
  before=$(git rev-parse HEAD)
  local note=""
  [ -n "$retry" ] && note="A cheaper model already tried this and failed. Run git status and git diff first: uncommitted work may exist; finish or redo it."

  "$CLAUDE" -p "Rules:
$rules

Your task (from docs/TODO.md):
$task

Start from the files named in the task and its Docs. Do not explore the repo, do not search legacy/ or node_modules, and do not read docs/HANDOVER.md or the whole of docs/TODO.md. If the code already does what the task asks, change nothing except ticking the box.
Run the one relevant test file first (npx vitest run <file>); run npm test and npm run build once, just before committing.
When done: tick this task's box in docs/TODO.md (edit that one line only), then make one commit. Add a line to docs/HANDOVER.md Traps only if you hit a real trap. If blocked or it needs an owner decision, change nothing and say why in one line. $note" \
    --model "$model" \
    --permission-mode acceptEdits \
    --allowedTools "Read" "Edit" "Write" "Glob" "Grep" "Bash(npm run *)" "Bash(npm test)" "Bash(npx vitest:*)" "Bash(npx tsc:*)" "Bash(git add:*)" "Bash(git commit:*)" "Bash(git status)" "Bash(git diff:*)" \
    --max-turns "${MAX_TURNS:-60}" \
    --max-budget-usd "${MAX_BUDGET_USD:-1.50}" \
    --autocompact "${AUTOCOMPACT:-150000}" \
    --output-format json > "$LOGS/$id.json" 2> "$LOGS/$id.err"

  out=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log([j.subtype,(j.total_cost_usd||0).toFixed(2),j.num_turns].join("\t")+"\t"+String(j.result||"").replace(/\s+/g," ").slice(0,400))}catch(e){console.log("no_output\t0.00\t0\t")}' "$LOGS/$id.json")
  OUTCOME=$(echo "$out" | cut -f1)
  COMMITTED=no; [ "$(git rev-parse HEAD)" != "$before" ] && COMMITTED=yes
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$model" "$OUTCOME" "$(echo "$out" | cut -f2)" "$(echo "$out" | cut -f3)" "$COMMITTED" >> "$LOGS/costs.tsv"
  echo "$id [$model] $OUTCOME \$$(echo "$out" | cut -f2) $(echo "$out" | cut -f3) turns, committed=$COMMITTED | $(echo "$out" | cut -f4)"
  # a commit must leave the build green
  if [ "$COMMITTED" = yes ] && ! npm run build >/dev/null 2>&1; then OUTCOME=build_red; fi
}

for id in "$@"; do
  task=$(grep -E "^- \[ \] $id " docs/TODO.md | head -1)
  [ -z "$task" ] && { echo "$id: not found or already done, skipping"; continue; }
  case "$task" in *"[auto]"*) ;; *) echo "$id: not tagged [auto], refusing"; continue ;; esac
  model=$(echo "$task" | grep -oE '\{(haiku|sonnet|opus)\}' | head -1 | tr -d '{}')
  model="${model:-haiku}"
  # Visual/UI work never goes below sonnet, whatever the tag says (override: VISUAL_FLOOR=0).
  if [ "${VISUAL_FLOOR:-1}" = 1 ] && [ "$model" = haiku ] && echo "$task" | grep -qE 'src/render|\.tsx|\.css|PartArt|Hud\.|NetPanel|screenshot|visual'; then
    model=sonnet; echo "$id: visual/UI task, floor raised haiku -> sonnet"
  fi
  task=$(echo "$task" | sed -E 's/ *\{(haiku|sonnet|opus)\}//')
  echo "== $id =="

  run_one "$id" "$task" "$model"
  if [ "$model" = haiku ] && { [ "$COMMITTED" = no ] || [ "$OUTCOME" != success ]; } && [ "$OUTCOME" != no_output ]; then
    echo "$id: haiku failed, retrying once on sonnet"
    run_one "$id" "$task" sonnet retry
  fi

  case "$OUTCOME" in
    no_output) echo "$id: claude did not run, stopping"; break ;;
    error_max_turns) echo "$id: hit the turn cap, stopping; review git status"; break ;;
    build_red) echo "$id: build failing after commit, stopping"; break ;;
  esac
  [ "$COMMITTED" = no ] && { echo "$id: no commit made (blocked?), stopping"; break; }
done
exit 0
