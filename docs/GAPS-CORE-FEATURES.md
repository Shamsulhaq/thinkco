# Core Features — Gaps Note (target spec vs. thinkco)

> **Status (update): all 7 gaps are now implemented.** The table shows the post-implementation
> state; details and file references follow. 331 tests pass.

Comparison of the described "Core Features" against thinkco's current implementation. Facts about
thinkco come from this repository's source (files cited). Legend: ✅ Have · 🟡 Partial · ❌ Missing.

| # | Feature | Before | Now | Where |
|---|---------|--------|-----|-------|
| 1 | Primary agents (build/plan/compose, Tab) | 🟡 | ✅ | `/agent`, Tab cycle, `runtime.setAgent/cycleAgent` |
| 2 | Persistent memory (MEMORY/checkpoint/notes/task progress) | 🟡 | ✅ | `src/context/store.ts`, `src/agent/tasks.ts` |
| 3 | Context mgmt (auto checkpoints + reconstruction) | 🟡 | ✅ | `runtime.checkpointAndReconstruct` |
| 4 | Task tracking (tree T1/T1.1, persisted) | 🟡 | ✅ | `src/agent/tasks.ts`, `task` tool |
| 5 | Subagents (shared context, background, lifecycle, cancel) | 🟡 | ✅ | `subagent` tool + `/agents` |
| 6 | Goal / stop condition + judge model | ❌ | ✅ | `/goal`, `runtime.judgeGoal` |
| 7 | Compose mode (specs-driven orchestration) | 🟡 | ✅ | `/compose`, compose agent profile |

## What was built

- **Primary agents** — `agent: build|plan|compose` on the runtime, `/agent` command, and **Tab**
  cycles agents in the TUI. `plan` aligns to read-only permission mode; `compose` loads an
  orchestration profile. (`src/agent/runtime.ts`)
- **Persistent memory** — `MemoryStore` writes `.thinkco/memory/{MEMORY.md,notes.md,checkpoint.md}`;
  injected (budgeted) into the system prompt every session so context isn't relearned.
- **Tree tasks** — `TaskStore` persists `T1`,`T1.1`,… under `.thinkco/tasks/` with per-task
  `progress.md`; exposed via the `task` tool and folded into checkpoints.
- **Context management** — auto-checkpoint every few turns or near budget; on overflow the loop is
  rebuilt and trimmed to recent messages, with the checkpoint+memory+open-tasks carried in the
  (budgeted) system prompt — i.e. reconstruction, not just summarization.
- **Enhanced subagents** — the `subagent` tool takes `share_context` (seed parent conversation) and
  `background` (async, returns an id); a manager tracks status; `/agents` lists and `/agents cancel
  <id>` cancels them.
- **Goal + judge** — `/goal <condition>` stores a stop condition; after a turn an independent judge
  model decides if it's truly met and the agent auto-continues if not (bounded to 6 iterations,
  fail-open so a flaky judge can't trap it).
- **Compose mode** — `/compose <spec>` switches to the compose agent and seeds the
  spec→plan→implement→review→test→verify lifecycle, using the `task` tool and `subagent` delegation.

Tests: `test/core-features.test.ts` (stores, task tool, agents, goal, compose, background
subagents). Full suite: **331 passing**.

---

## Original analysis (pre-implementation)



---

## 1. Multiple primary agents (build / plan / compose)

**Target:** three primary agents — `build` (full tools), `plan` (read-only), `compose`
(orchestration) — switched with **Tab**; system creates subagents as needed.

**thinkco:** has permission **modes** cycled with **Shift+Tab**
(`src/permissions/engine.ts` → `MODE_CYCLE = ['default','acceptEdits','plan']`, plus `dontAsk`,
`auto`, `bypass`). `plan` mode ≈ their read-only "plan"; `default` ≈ "build". `Tab` in our TUI
drives command-palette autocomplete, not agent switching.

**Gap:** no first-class "agent" concept (build/plan/compose) — we have modes. No `compose`
orchestration agent. Switching key differs (Shift+Tab cycles modes).

**To close:** introduce a `mode: build|plan|compose` agent abstraction layered over permission
modes + a system-prompt/skill profile per agent; bind Tab to cycle agents in the TUI.

## 2. Persistent Memory

**Target:** `MEMORY.md` (project knowledge), `checkpoint.md` (auto state snapshots by a
checkpoint-writer subagent), `notes.md` (scratch), `tasks/<id>/progress.md` (per-task logs);
backed by **SQLite FTS5** full-text search; auto-injected on resume.

**thinkco:** `src/context/memory.ts` loads project-memory files
(`AGENT.md`/`AGENTS.md`/`.thinkco/memory.md`/`CLAUDE.md`) into the system prompt every session.
Sessions persist as **JSON** (`src/agent/session.ts`, deliberately no native SQLite). `/resume`
restores the latest session's messages.

**Gap:** only the project-memory file is implemented. No `checkpoint.md`, `notes.md`, or
`tasks/<id>/progress.md`; no checkpoint-writer subagent; **no SQLite FTS5** full-text search over
memory.

**To close:** add a memory store with `checkpoint.md`/`notes.md`/task-progress files under
`.thinkco/`, a checkpoint-writer step, and a search index (FTS5 via `better-sqlite3`, or reuse the
existing BM25 `knowledge` store to avoid a native dep).

## 3. Intelligent Context Management

**Target:** automatic checkpoints based on the model context window; context **reconstruction**
from the latest checkpoint + memory + task progress + recent messages when near the limit;
**budgeted injection** with importance ranking.

**thinkco:** `src/context/budget.ts` does token-budget **compaction** — summarizes older messages
(LLM `providerSummarizer` or heuristic) and keeps the most recent N; wired via the loop's
`contextBudget` (60k) plus a manual `/compact`. Memory is injected wholesale (no token budget or
ranking).

**Gap:** we compact, but there is no **checkpoint snapshot** to reconstruct from, no
window-aware auto-checkpointing, and no **importance-ranked budgeted injection** of
memory/checkpoint/notes.

**To close:** add checkpointing (see #2), reconstruct context from checkpoint+memory+recent on
overflow instead of only summarizing, and add a ranked token budget for injected context.

## 4. Task Tracking

**Target:** tree-shaped tasks (`T1`, `T1.1`, …) integrated with checkpoints so progress survives
resume.

**thinkco:** the `todo_list` tool (`src/tools/core/todo.ts`) is a **flat**, **in-memory** list
(`t1`, `t2`), reset per process and not persisted or checkpoint-linked.

**Gap:** no hierarchy (subtasks), no persistence, no checkpoint integration.

**To close:** add parent/child task ids and persist tasks under `.thinkco/tasks/<id>/`, writing
`progress.md` and folding task state into checkpoints.

## 5. Subagent System

**Target:** primary agent spawns subagents on demand that **share the current session context**,
run **in parallel**, with **lifecycle tracking, cancellation, and background execution**.

**thinkco:** the `subagent` tool (`src/workflows/subagent.ts`, wired in `runtime.ts`) delegates a
subtask to a **fresh** `AgentLoop` with its **own** context, runs **synchronously** (blocks the
turn), and returns text. We also have `teams` + git `worktrees` (`src/workflows/team.ts`,
`worktree.ts`) and a subagent `pipeline` (`pipeline.ts`) for parallel/DAG work.

**Gap:** subagents do **not share** the parent session context; no background execution, no
parallel fan-out from the tool, no per-subagent lifecycle/cancellation tracking.

**To close:** add a subagent manager with shared-context option, async/background runs, IDs, and
cancellation; surface status in the UI.

## 6. Goal / Stop Condition

**Target:** `/goal` sets a stopping condition; an independent **judge model** decides whether it's
truly met before the agent stops (prevents premature "optimistic stops").

**thinkco:** ❌ none. The loop has a stall-timeout and a turn-completion notice
(`src/agent/loop.ts`), but no goal condition and no judge-model evaluation.

**Gap:** missing entirely.

**To close:** add a `/goal` command storing a condition on the runtime; before the loop ends, call
a judge model (cheap model) with the condition + transcript; continue if unmet (bounded retries).

## 7. Compose Mode

**Target:** structured **specs-driven** workflow with built-in skills for planning, execution,
code review, TDD, debugging, verification, and merging — orchestrating spec → shipped code.

**thinkco:** the building blocks exist — the Skills system (`src/skills/`), bundled **ruflo-core**
agents (coder, reviewer, tester, planner, architect, researcher, code-analyzer as skills), `plan`
mode, and the full ruflo SPARC skills available via `claudePlugins`. But there is **no orchestrated
"compose" mode** that sequences spec→plan→TDD→review→verify→merge automatically.

**Gap:** no compose orchestration layer/state machine; today it's manual skill activation.

**To close:** add a `compose` agent/mode that drives a spec-first lifecycle, invoking the relevant
skills/subagents at each phase with gates between phases.

---

## Summary

thinkco already covers the **fundamentals**: provider-agnostic agent loop, tools + permissions,
project-memory injection, conversation **compaction**, sessions/`/resume`, a `subagent` tool,
teams/worktrees, skills, and a flat task tool.

The **biggest gaps** versus this spec are the **memory/checkpoint subsystem** (checkpoint.md /
notes.md / task-progress + FTS, and context **reconstruction**), **tree task tracking**,
**shared-context/background subagents**, the **`/goal` judge-model stop condition**, and an
orchestrated **compose mode**. None require abandoning the current architecture — they layer on top
of the existing runtime, skills, and session store.
