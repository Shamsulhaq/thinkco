# WORKPLAN.md — thinkco

Phase-by-phase development plan for **thinkco**, a multi-provider agentic coding CLI
(TypeScript + Node.js ≥ 20). Check off items as they land. Read `AGENT.md` first.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done

---

## Milestones

- **M1 — MVP** (Phases 0–4): usable, safe, multi-provider coding agent.
- **M2 — Extensible** (Phases 5–9): context, MCP, skills, commands, automation.
- **M3 — Platform** (Phases 10–12): plugins, remote/multi-frontend (Telegram), distribution, docs.

## Dependency order

```
P0 → P1 → P2 → P3 → P4 → P5
           │         │
           │(frontend │
           │ abstr.)  │
           │         ├─► P6 MCP ──┐
           │         ├─► P7 Skills┤
           │         ├─► P8 Cmds  ├─► P10 Plugins ─► P11 Ship
           │         └─► P9 Flows ┘
           └──────────────► P12 Remote / Telegram (needs P2 core + P4 perms; full value after P9)
```

---

## Phase 0 — Foundation & Scaffolding
**Goal:** repo, tooling, and a skeleton that runs.

- [x] Initialize `package.json` (ESM, Node ≥ 20 engines), `tsconfig.json` (strict)
- [x] Configure ESLint + Prettier
- [x] Configure Vitest + coverage
- [x] CLI entrypoint `thinkco` with arg parsing, `--version`, `--help`
- [x] Config loader: merge global (`~/.config/thinkco/`) + project (`./.thinkco/`)
- [x] Logging + centralized error handling
- [x] Telemetry opt-in stub
- [x] CI pipeline: lint + test + build
- [x] Detect Python toolchain (`python3`/`uv`/`venv`) for later sidecar use
- **Acceptance:** `thinkco` launches, loads config, prints help.

## Phase 1 — Provider Abstraction Layer
**Goal:** one unified interface, multiple backends (the core differentiator).

- [x] Define unified types: `Message`, `ToolDef`, `ToolCall`, `ToolResult`
- [x] Define `ProviderAdapter` interface (streaming `chat()`)
- [x] Anthropic adapter (Messages API)
- [x] OpenAI adapter (Chat Completions + tool calls)
- [x] Ollama adapter (local models)
- [x] Gemini adapter (stretch for M1)
- [x] Normalize tool-call formats, streaming deltas, stop reasons, system prompt, token usage
- [x] Provider registry + model selection (`--model`, config default)
- [x] Retry/backoff + rate-limit + error normalization
- [x] Fake provider for tests + contract test suite
- **Acceptance:** identical code path streams from all adapters; contract tests pass.

## Phase 2 — Agent Loop & Terminal UI
**Goal:** interactive REPL with a working reason→act→observe loop.

- [x] Agent loop: send context+tools → parse tool calls → execute → feed results → repeat
- [x] **Frontend abstraction:** define `Frontend` interface (input events, output stream, approval requests, session-for-context) so the agent core is **headless/UI-agnostic**; CLI is the first frontend
- [x] Streaming markdown renderer + spinner
- [x] Token/cost display
- [x] Conversation state + multi-turn memory
- [x] Slash commands: `/help`, `/clear`, `/model`, `/provider`, `/exit`
- [x] Session persistence (SQLite) + resume last session
- [x] Graceful interrupt (Ctrl-C cancels current turn)
- **Acceptance:** user chats, model calls a stub tool, loop completes, session resumes.

## Phase 3 — Core Tools
**Goal:** real work on the filesystem and shell.

- [x] File tools: `read`, `write`, `edit` (diff-based), `list`
- [x] Search tools: `glob`, `grep` (respect `.gitignore`)
- [x] `shell` execution with streaming output + timeout
- [x] `git` helpers (status/diff/commit on request)
- [x] `web_fetch` / `web_search`
- [x] Zod tool schemas auto-converted to each provider's format
- **Acceptance:** agent edits files, runs commands, searches codebase end-to-end.

## Phase 4 — Permissions & Safety
**Goal:** trust and guardrails before exposing power.

- [x] Risk classifier (read / edit / execute / network)
- [x] Interactive approval prompts (allow / deny / always-allow)
- [x] Per-project allowlist/denylist config
- [x] Sandbox / dry-run mode
- [x] Secret-file detection + destructive-command flagging
- [x] Audit log of executed actions
- **Acceptance:** destructive/network actions prompt; rules persist; audit log written.
- **➡ M1 (MVP) complete.**

## Phase 5 — Context Management
**Goal:** codebase awareness and long-session stability.

- [x] Project file indexing + relevance retrieval
- [x] Context-window budgeting
- [x] Automatic conversation compaction/summarization
- [x] Project memory file (`AGENT.md` / `.thinkco/memory`) auto-load
- [x] `@file` mentions to inject specific files
- **Acceptance:** long sessions don't overflow; project conventions auto-applied.

## Phase 6 — MCP Integration
**Goal:** external tool ecosystem.

- [x] MCP client: stdio + HTTP/SSE transports
- [x] Server config (global/project) + lifecycle (spawn/health/shutdown)
- [x] Map MCP tools/resources/prompts into the unified tool registry
- [x] Per-server permission scoping + tool-name namespacing
- [x] Support spawning **Python** MCP servers (`uv run` / `python -m`) + venv mgmt
- [x] `/mcp` command (list/inspect servers)
- **Acceptance:** a configured MCP server's tools are callable across all providers.

## Phase 7 — Skills System
**Goal:** reusable, on-demand expertise.

- [x] Skill format: dir with `SKILL.md` (name/description/trigger) + scripts/resources
- [x] Discovery from global/project/plugin skill dirs
- [x] Progressive loading (inject full skill only when relevant)
- [x] Skills can ship runnable helper scripts (`.ts`/`.py`/`.sh`) as tools
- [x] `/skills` command (list/enable/disable)
- **Acceptance:** a skill activates on relevant requests and guides the agent.

## Phase 8 — Slash Commands & Custom Commands
**Goal:** user-defined shortcuts.

- [x] Built-in command framework (extends Phase 2)
- [x] Custom commands as templated markdown (`./.thinkco/commands/*.md`)
- [x] Argument substitution, file references, bash-output injection
- **Acceptance:** a user-authored `/review` command runs a parameterized prompt.

## Phase 9 — Workflow Automation
**Goal:** run without a human in the loop.

- [x] Headless/non-interactive mode (`thinkco -p "task" --json`)
- [x] Hooks on events (pre-tool-use, post-edit, session-start/stop)
- [x] Subagents (spawn specialized agents for delegated/parallel tasks)
- [x] Task chaining / pipelines (DAG with dependencies)
- [x] Optional scheduling triggers
- **Acceptance:** headless CI run works; post-edit hook auto-formats; multi-stage workflow completes.

## Phase 10 — Plugin System
**Goal:** package and distribute everything above.

- [x] Plugin manifest (`plugin.json`) declaring commands/skills/subagents/MCP servers/hooks
- [x] Plugin loader registers all declared components into the right subsystems
- [x] Install from git URL or registry; version pinning; enable/disable
- [x] Plugin sandboxing + permission scoping
- [x] Python deps/venv setup for plugin-bundled Python MCP servers
- [x] `/plugin` commands (install/list/update/remove)
- [x] Plugin scaffolding/authoring tool
- **Acceptance:** one installed plugin adds working commands + a skill + an MCP server + a hook, all functioning together.

## Phase 11 — Polish, Distribution & Docs
**Goal:** ship-ready.

- [x] Optional IDE/editor integration hooks
- [x] Standalone binaries (Bun/pkg) + install script + Homebrew/WinGet
- [x] Cost/usage dashboards + config UI
- [x] Comprehensive docs + example skills/plugins
- [x] Opt-in telemetry + crash reporting
- [x] Security review + e2e suite across all providers
- **Acceptance:** installable via one command; docs cover authoring skills/plugins/MCP/workflows.

## Phase 12 — Remote & Multi-Frontend (Telegram)
**Goal:** operate thinkco remotely via Telegram, with the **same agent core** as the CLI.
**Depends on:** P2 (headless core + Frontend interface) and P4 (permissions); full value after P9 (headless).

### Frontend & transport
- [x] Telegram bot frontend implementing the `Frontend` interface (long-polling and/or webhook)
- [x] Buffered streamed output via **message editing** (throttled to respect Telegram rate limits)
- [x] Per-chat/thread → session mapping
- [x] Large output (diffs/logs) sent as **document attachments**
- [x] Slash/bot commands mirroring CLI (`/model`, `/provider`, `/clear`, `/help`)

### Permissions over chat
- [x] Approval prompts rendered as **inline buttons** (Approve / Deny / Always-allow)
- [x] Reuse the Phase 4 permission engine unchanged (only rendering differs)

### Security (MANDATORY — remote = remote code execution)
- [x] **User allowlist** by Telegram user ID; ignore unauthorized users
- [x] **Stricter remote defaults:** destructive/network actions always require explicit approval; no "always-allow" over remote by default
- [x] Optional **sandbox/container** workspace for remote sessions
- [x] Never transmit secrets over the transport; redact in output
- [x] Bot token stored in env/config only (never committed)
- [x] Audit log records every remote action with originating user ID

### Extensibility
- [x] Frontend registry so future transports (web/Slack/Discord) plug in the same way
- **Acceptance:** an allowlisted user drives a full coding session over Telegram — streamed
  output, inline-button approvals, file edits, and shell commands — using the same core as the CLI.
- **➡ M3 (Platform) complete.**

---

## Cross-cutting (every phase)

- [x] **Provider parity:** test new tools/features against all adapters.
- [x] **Security:** never regress permissions, secret handling, sandboxing.
- [x] **Testing:** fake provider + recorded fixtures; no live calls in unit tests.
- [x] **Token/cost efficiency:** progressive skill loading; context compaction.
- [x] **Docs:** keep `AGENT.md` + this file current.
