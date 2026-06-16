# GAP-WORKPLAN.md — closing the gaps vs Claude Code

Derived from `COMPARISON.md`. This continues the phase numbering from `WORKPLAN.md`
(which ended at Phase 12). Each item lists **priority**, rough **effort**, and an
**acceptance** check. Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

Priorities: **P0** = high value + feasible now · **P1** = valuable, more work ·
**P2** = large/strategic · **OUT** = intentionally not planned (with reason).

## Status (as of latest build)

- **P13 Permission modes + Shift+Tab — DONE** ✅ (default/acceptEdits/plan/dontAsk/auto/bypass, `/mode`, `--permission-mode`)
- **P14 Protected paths — DONE** ✅ (always prompt; circuit breaker for `rm -rf /`)
- **P15 MCP HTTP/SSE transport — DONE** ✅ (`HttpTransport`, `transport: "http"`)
- **P16 Agent Skills standard parity — DONE** ✅ (allowed-tools/paths/model/context:fork/agent; `$ARGUMENTS[N]`, `$name`, fenced ` ```! ` blocks)
- **P17 Classifier-based auto mode — DONE** ✅ (provider-backed classifier + fallback)
- **P18 More built-in commands — DONE** ✅ (`/compact /resume /init /doctor /config /rename`)
- **P19 Full-screen TUI — DONE** ✅ (Ink/React frontend: persistent input box, `<Static>` scrollback, live streaming, status bar, inline approval + model-picker overlays, Shift+Tab mode cycle; readline kept as `--classic` fallback)
- **P20 Agent teams & worktrees — DONE** ✅ (`runTeam` parallel subagents with optional git-worktree isolation per member; `createWorktree`/`runInWorktree`)
- **P21 Plugin marketplace + scheduled tasks — DONE** ✅ (curated registry + `/plugin search` + install-by-name; `Scheduler` + `thinkco schedule` foreground runner driven by `schedule` config)

All gap phases (P13–P21) are now implemented. 210 tests pass at the time of writing.

---

## Milestones

- **M4 — Parity essentials** (Phases 13–15): permission modes, protected paths, MCP HTTP,
  skill/command standard parity. The highest-impact, achievable gaps.
- **M5 — Depth** (Phases 16–18): manual context tools, more built-in commands, agent teams &
  worktrees, classifier auto-mode.
- **M6 — Platform & polish** (Phases 19–21): full TUI, plugin marketplace, scheduled tasks.

Dependency sketch:

```
P13 perm-modes ─┐
P14 protected   ├─► P17 auto-mode (classifier)
P15 mcp-http    │
P16 skills-std ─┘
P18 commands ───► P19 TUI ──► P20 marketplace ──► P21 scheduler
```

---

## Phase 13 — Permission modes + Shift+Tab cycle  **(P0)**
Gap: Claude Code has `default / acceptEdits / plan / auto / dontAsk / bypassPermissions` cycled
with Shift+Tab; thinkco has only allow/deny rules + per-tool "always allow".

- [ ] Introduce a `PermissionMode` enum: `default | acceptEdits | plan | dontAsk | bypass`
- [ ] `default`: current behavior (reads auto, rest prompt)
- [ ] `acceptEdits`: auto-approve `write`/`edit` + safe fs commands **inside cwd**; others prompt
- [ ] `plan`: read-only; block all edits/shell-writes; agent proposes a plan, no mutations
- [ ] `dontAsk`: only pre-approved (allow-rule) tools run; everything else denied (for CI)
- [ ] `bypass`: skip prompts (guarded; refuse as root; only with explicit flag)
- [ ] **Shift+Tab** cycles `default → acceptEdits → plan` in the REPL; show mode in a status line
- [ ] `--permission-mode <mode>` CLI flag + `permissions.defaultMode` config
- **Acceptance:** switching modes changes prompting behavior; plan mode never mutates files; tests per mode.
- **Effort:** M. **Depends on:** existing PermissionEngine.

## Phase 14 — Protected paths  **(P0)**
Gap: Claude never auto-approves writes to `.git`, `.claude.json`, `.mcp.json`, `.vscode`, etc.

- [ ] Define a protected-path list (`.git/`, `.thinkco/`, `.ssh/`, `.vscode/`, lockfiles, CI configs)
- [ ] Writes/edits to protected paths always prompt (even under acceptEdits / allow-rules)
- [ ] In `bypass` mode only, allow — but still block `rm -rf /` and `rm -rf ~` as a circuit breaker
- **Acceptance:** an `allow:['write']` rule still prompts for a `.git/config` write; tests cover it.
- **Effort:** S. **Depends on:** P13.

## Phase 15 — MCP HTTP/SSE transport  **(P0)**
Gap: thinkco MCP is stdio-only; Claude supports HTTP/SSE and a large connector ecosystem.

- [ ] Implement `HttpTransport` (Streamable HTTP + SSE) behind the existing `Transport` interface
- [ ] Config `mcpServers.<name>.transport: "http"`, `url`, headers/auth
- [ ] Reuse `McpClient` unchanged (JSON-RPC layer is transport-agnostic)
- [ ] Connection retry + reconnect on SSE drop
- **Acceptance:** a mock HTTP MCP server's tools register and execute; contract test mirrors the stdio test.
- **Effort:** M. **Depends on:** Phase 6 MCP client.

## Phase 16 — Skills & commands: Agent Skills standard parity  **(P1)**
Gap: Claude skills follow the **Agent Skills open standard** with richer frontmatter; custom
commands are **merged into skills**; more string substitutions.

- [ ] Parse full frontmatter: `allowed-tools`, `disallowed-tools`, `model`, `paths`, `context: fork`, `agent`
- [ ] `allowed-tools` pre-approves listed tools while a skill is active (ties into PermissionEngine)
- [ ] `paths` globs gate auto-activation to matching files
- [ ] `context: fork` runs a skill in a subagent (ties into Phase 9 subagents)
- [ ] Command substitutions: add `$ARGUMENTS[N]`, `$0/$1`, `$name`, `${THINKCO_SESSION_ID}`
- [ ] Multi-line `` ```! `` fenced bash-injection blocks (currently only inline `` !`cmd` ``)
- [ ] Treat `commands/*.md` and `skills/<name>/SKILL.md` as one unified system
- **Acceptance:** a skill with `allowed-tools` runs its tools without prompts; `paths` gating works; new substitutions covered by tests.
- **Effort:** M. **Depends on:** Phases 7, 8, 13.

## Phase 17 — Classifier-based "auto" mode  **(P1)**
Gap: Claude's `auto` mode routes each action through a safety classifier model.

- [ ] `auto` permission mode: send pending tool call + recent transcript to a classifier prompt
- [ ] Classifier returns allow/deny + reason; block irreversible/external/destructive actions
- [ ] Provider-agnostic: use the active provider (or a configured cheaper model) as the classifier
- [ ] Fallback to prompting after N consecutive blocks (match Claude's 3-in-a-row / 20-total behavior)
- [ ] Honor in-conversation boundaries ("don't push") as block signals
- **Acceptance:** scripted classifier denies a destructive command and allows a safe edit; fallback triggers after repeated blocks.
- **Effort:** M–L. **Depends on:** P13. **Note:** quality depends on the model; document as experimental.

## Phase 18 — More built-in commands  **(P1)**
Gap: thinkco lacks several everyday Claude commands.

- [ ] `/compact [instructions]` — manual conversation compaction (reuse `compactConversation`)
- [ ] `/resume` — interactive session picker (arrow list of saved sessions) + `--resume <id>`
- [ ] `/init` — generate a starter `AGENT.md` by scanning the project
- [ ] `/doctor` — diagnose config, provider keys, MCP servers, skills, perms
- [ ] `/config` — view/edit settings (scopes: project/global) without hand-editing JSON
- [ ] `/rename` — name the current session
- [ ] `/review` — bundled code-review skill (we already ship a sample plugin; promote to bundled)
- **Acceptance:** each command works in the REPL with tests where logic is non-trivial.
- **Effort:** M. **Depends on:** Phases 2, 5.

## Phase 19 — Full-screen TUI (Ink)  **(P2)**
Gap: Claude renders a persistent, redrawing terminal UI; thinkco uses ANSI/readline.

- [ ] Evaluate Ink (React-for-TTY); spike a persistent bottom input box + scrollback region
- [ ] Live re-render of streaming markdown; status bar (mode, model, tokens)
- [ ] Inline slash-command autocomplete menu (beyond Tab)
- [ ] Keep the headless core untouched — TUI is just another `Frontend`
- **Acceptance:** feature-parity with the current readline frontend, plus persistent input + live status.
- **Effort:** L. **Risk:** larger rewrite; keep readline frontend as fallback.

## Phase 20 — Agent teams & worktree isolation  **(P2)**
Gap: Claude has agent teams and git-worktree session isolation.

- [ ] Run subagents in isolated git worktrees (branch per task) to avoid clobbering
- [ ] "Team" orchestration: a lead agent delegates to specialized subagents in parallel, merges results
- [ ] Surface progress per subagent in the UI
- **Acceptance:** a multi-agent task runs in separate worktrees and merges cleanly.
- **Effort:** L. **Depends on:** Phase 9 subagents/pipelines.

## Phase 21 — Plugin marketplace + scheduled tasks  **(P2)**
Gap: Claude has plugin discovery/marketplace and scheduled tasks.

- [ ] Plugin registry/index (install by name from a curated list or git URL — git already works)
- [ ] `/plugin search` / `/plugin marketplace`
- [ ] Scheduled tasks: run a headless task on a cron-like schedule (local daemon or `cron` integration)
- **Acceptance:** install a plugin by name; a scheduled task fires and runs headless.
- **Effort:** M–L.

---

## Intentionally NOT planned (OUT) — with reasons

- **Computer use / desktop control** — large surface, high risk, out of scope for a coding CLI.
- **Chrome extension, VS Code / JetBrains plugins** — separate products; the headless core could
  power them later, but they are not CLI work.
- **Claude Code on the web / cloud sessions** — requires hosted infrastructure; thinkco is local-first.
  (The Telegram frontend already covers the "remote control" need.)
- **First-party model features** (e.g. tuned safety classifier) — thinkco stays provider-agnostic;
  `auto` mode in P17 is a best-effort, model-dependent approximation.

---

## Suggested order of attack

1. **P13 + P14** (modes + protected paths) — biggest UX/safety win, moderate effort.
2. **P15** (MCP HTTP) — unlocks the wider MCP ecosystem.
3. **P18** (`/compact`, `/resume`, `/init`, `/doctor`) — everyday quality-of-life.
4. **P16** (skills standard) — interoperability with the Agent Skills ecosystem.
5. **P17** (auto mode), then **P19–P21** as capacity allows.

Keep the cross-cutting rules from `WORKPLAN.md`: provider parity, never regress safety,
fake-provider tests, and update `AGENT.md` when architecture changes.
