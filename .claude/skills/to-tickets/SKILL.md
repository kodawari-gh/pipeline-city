---
name: to-tickets
description: Break a plan, spec, or the current conversation into tracer-bullet tickets on the project board, each with blocking edges, a planned model, and the test seam the swarm needs.
disable-model-invocation: true
---

# To Tickets

Break a plan, spec, or conversation into **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it. Each ticket is built later by `ticket-swarm`, so it carries what the swarm reads: acceptance items, the test seam, the checks, and a planned model.

Tracker operations: `docs/agents/issue-tracker.md`. Board operations and the planned-model rubric: the `update-gh-board` skill.

## Process

### 1. Gather context

Work from the conversation. If the user passes a reference (a spec path, an issue number), read its full body and comments. When the source is an old list (a TODO file, earlier tickets), check each item against the code first: drop what is already done.

### 2. Explore the codebase

Learn the current state of the code. Use the domain glossary vocabulary and respect the ADRs in the area (`docs/agents/domain.md`). Find the test seam for each slice: the module, the exported functions, and the test helpers a tester can call. Look for prefactoring: "make the change easy, then make the easy change."

### 3. Draft vertical slices

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer it touches (data, logic, API, UI, tests).
- A completed slice is demoable or verifiable on its own.
- Each slice fits in one fresh context window of its planned model.
- Prefactoring comes first.

</vertical-slice-rules>

Give each ticket its **blocking edges**: the tickets that must complete before it can start.

Give each ticket a **planned model** from the rubric in `update-gh-board`. When one slice mixes a Haiku part and a Sonnet part, split it so the Haiku part can land on Haiku.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change whose **blast radius** fans across the codebase, so no vertical slice can land green. Sequence it as **expand–contract**: expand (add the new form beside the old), migrate call sites in batches sized by blast radius (each batch a ticket blocked by the expand), then contract (delete the old form, blocked by every batch). When the batches cannot stay green alone, let them share an integration branch that blocks a final integrate-and-verify ticket.

### 4. Quiz the user

Show the breakdown as a numbered list. For each ticket: **Title**, **Blocked by**, **Planned model** with a one-line reason, **What it delivers**.

Ask:

- Is the granularity right (too coarse / too fine)?
- Does each blocking edge gate genuinely?
- Is each planned model right? (Too low costs rounds; too high costs tokens.)
- Merge or split any tickets?

Iterate until the user approves.

### 5. Publish

Publish in dependency order (blockers first) so edges reference real numbers. For each ticket:

1. `gh issue create` with the template below and the `ready-for-agent` label (`ready-for-human` for a Human ticket). If there is a parent issue, create it as that issue's sub-issue.
2. Add the native blocked-by edges.
3. Set the planned model: `node .claude/skills/update-gh-board/board.mjs planned <n> <Model>` (this also adds it to the board).

Then run `board.mjs sync <parent>` and `board.mjs show <parent>`. Done when the parent lists every new ticket as a child and sync reports no ticket without a planned model. Leave the parent issue's body and state unchanged.

<issue-template>

## Parent

`#<parent>` (omit when there is no parent).

## What to build

The end-to-end behaviour this ticket makes work, from the player's or caller's view, not a layer-by-layer list.

## Acceptance criteria

- [ ] Criterion 1, each one checkable by a test or a named command
- [ ] Criterion 2

## Test seam

The module and exported functions the tester calls, and the test helpers to use. Name modules, not line numbers.

## Checks

The commands the reviewer runs: the test files, plus the checks the repo requires (`AGENTS.md` or `CLAUDE.md`, and the repo notes in `docs/agents/board.md`). For visual work, the screenshot to capture.

</issue-template>

Keep code out of the body: it goes stale. Exception: a prototype snippet that encodes a decision more precisely than prose (state machine, reducer, type shape). Inline the decision-rich part and note it came from a prototype.
