# AGENT.md — thinkco

> Universal context file. **Any** coding agent (Claude Code, Cursor, Copilot, Kiro,
> Aider, or a human) should read this first to understand what this repo is, how it is
> structured, and how to work in it. Keep this file accurate and up to date.

---

## 1. What thinkco is

**thinkco** is a terminal-based, **multi-provider agentic coding CLI** — think "Claude Code,
but provider-agnostic." It lives in your terminal, understands your codebase, and performs
real work (editing files, running commands, git workflows) through natural-language requests.

Its defining feature is a **provider abstraction layer**: the same agent runs on
**Anthropic, OpenAI, Google Gemini, and local models (Ollama)** through pluggable adapters.

It is extensible through four layers:

- **Tools** — built-in primitives the agent calls (read/write/edit files, shell, search, git, web).
- **MCP servers** — external processes exposing extra tools/resources via the Model Context Protocol.
- **Skills** — on-demand instruction packages (`SKILL.md` + optional scripts) that teach the agent specialized tasks.
- **Workflows** — automation: event hooks, headless/non-interactive runs, subagents, task pipelines.
- **Plugins** — distributable bundles that package any combination of the above.
- **Frontends (transports)** — interchangeable interfaces over a headless agent core. The
  **CLI** is the first frontend; **Telegram** ("remote coding") is a second, with web/Slack/Discord
  possible later. The core is UI-agnostic; frontends only handle input, output rendering, and approvals.

## 2. Goals & non-goals

**Goals**
- One unified agent core that behaves consistently across all providers.
- Safe by default: permission prompts for destructive/irreversible/network actions.
- Token/cost efficient: progressive skill loading, conversation compaction.
- Extensible: MCP, skills, workflows, and plugins are first-class.
- **UI-agnostic core**: usable from the terminal **and** remotely (e.g., Telegram) through the same agent core.

**Non-goals (for now)**
- A GUI/desktop app (terminal-first).
- Reimplementing every provider feature; we normalize to a common denominator + capability flags.
- Training/fine-tuning models.

## 3. Tech stack (decided)

- **Language/runtime:** TypeScript + Node.js **≥ 20** (ESM).
- **Terminal UI:** Ink (React for the terminal) or readline + ANSI renderer.
- **LLM access:** official SDKs (Anthropic, OpenAI) + raw `fetch` for Ollama/others.
- **MCP:** `@modelcontextprotocol/sdk`.
- **Validation:** Zod (tool schemas + config).
- **Persistence:** SQLite (sessions/history) + JSON/YAML (config).
- **Testing:** Vitest, with a **fake provider** for deterministic agent-loop tests.
- **Packaging:** npm bin first; standalone binaries (Bun/pkg) later.

### Language policy: TS core + optional Python sidecar
- **TypeScript owns** the CLI/UI, agent loop, provider adapters, core tools, MCP host, plugin loader.
- **Python is optional** and only enters via **MCP servers** and **skill scripts** (process boundary = language boundary).
- Do **not** embed one runtime inside the other or split core logic across languages.

## 4. Architecture (high level)

```
┌──────────── Frontends / Transports (UI-agnostic core below) ───────────┐
│  CLI (terminal: ANSI/stdin)   Telegram bot (messages + inline buttons)   │
│  [future: web · Slack · Discord · VS Code]                               │
│        └──────────── unified Frontend interface ───────────┘            │
│   input events · streamed output · permission-approval requests          │
├──────────────────────────────────────────────────────────┤
│ Agent Loop: reason → tool-call → execute → observe → repeat │
├───────────────┬───────────────┬───────────────┬───────────┤
│ Tool Registry │ Permission     │ Context Mgr   │ Session    │
│ (core + MCP   │ Engine         │ (index,        │ Store      │
│  + skills)    │ (risk + prompt)│  compaction)  │ (SQLite)   │
├───────────────┴───────────────┴───────────────┴───────────┤
│ Provider Abstraction Layer (ProviderAdapter interface)      │
│   ├─ AnthropicAdapter  ├─ OpenAIAdapter                     │
│   ├─ GeminiAdapter     └─ OllamaAdapter                     │
└──────────────────────────────────────────────────────────┘
        │ MCP (stdio/HTTP)              │ subprocess
        ▼                               ▼
   MCP servers (TS or Python)     Skill scripts (.ts/.py/.sh)
```

**The provider abstraction is the heart of the project.** All features must work across every
adapter. Providers differ most in **tool-calling format**, **streaming deltas**, and **stop reasons** —
the adapter layer normalizes these into unified internal types.

### Frontend abstraction (remote coding)
- The **agent core is headless**: it never touches stdin/stdout directly. It emits structured
  output events and **approval requests**, and consumes input events.
- A **`Frontend` interface** adapts these to a transport. Each frontend implements:
  `receiveInput()`, `renderOutput(stream)`, `requestApproval(action)`, `sessionFor(context)`.
- **CLI frontend:** ANSI streaming + terminal prompt for approvals.
- **Telegram frontend:** buffered message **editing** for streamed output (no token stream),
  **inline buttons** for approvals, per-chat sessions, large output sent as document attachments.

### Remote security model (MANDATORY for Telegram / any remote frontend)
Remote operation = remote code execution. Non-negotiable safeguards:
- **User allowlist** by Telegram user ID; unauthorized users are ignored.
- **Stricter permission defaults remotely**: destructive/network actions always require explicit
  per-action approval; no "always-allow" over remote frontends by default.
- **Sandboxing recommended**: run tools in a container/restricted workspace for remote sessions.
- **Never transmit secrets** (API keys, env values) over the transport; redact in output.
- **Bot token is a high-value secret**: env/config only, never committed.
- **Audit log** records every remote action with the originating user ID.

## 5. Planned repo layout

> Created incrementally as phases land. Treat this as the target shape.

```
thinkco/
├── AGENT.md                 # this file
├── WORKPLAN.md              # phased plan + TODO checkboxes
├── package.json
├── tsconfig.json
├── src/
│   ├── cli/                 # entrypoint, arg parsing, REPL, slash commands
│   ├── frontends/           # Frontend interface + implementations
│   │   ├── cli/             # terminal frontend
│   │   └── telegram/        # Telegram bot frontend (remote coding)
│   ├── agent/               # agent loop, conversation state
│   ├── providers/           # ProviderAdapter interface + adapters
│   │   ├── anthropic/
│   │   ├── openai/
│   │   ├── gemini/
│   │   └── ollama/
│   ├── tools/               # core tools (file, shell, search, git, web)
│   ├── permissions/         # risk classification + approval engine
│   ├── context/             # indexing, retrieval, compaction, memory
│   ├── mcp/                 # MCP client/host
│   ├── skills/              # skill discovery + progressive loading
│   ├── workflows/           # hooks, headless mode, subagents, pipelines
│   ├── plugins/             # plugin manifest, loader, registry
│   ├── config/              # config loading/merging
│   └── types/               # shared unified types (Message, ToolDef, ...)
├── test/                    # Vitest suites + fixtures + fake provider
├── skills/                  # built-in/example skills
└── plugins/                 # built-in/example plugins
```

## 6. Core internal types (contract)

These unified types are the contract every adapter and tool conforms to:

- `Message` — `{ role, content[] }` where content is text / tool_use / tool_result.
- `ToolDef` — `{ name, description, inputSchema (Zod/JSON Schema) }`.
- `ToolCall` — `{ id, name, input }`.
- `ToolResult` — `{ id, output, isError }`.
- `ProviderAdapter.chat(messages, tools, opts)` → async stream of
  `{ type: 'text' | 'tool_call' | 'usage' | 'stop', ... }`.

Adapters translate these ↔ each provider's wire format. **Never leak provider-specific
shapes above the adapter boundary.**

## 7. Conventions for agents working here

- **Read `WORKPLAN.md` before coding.** Work the current phase; respect dependency order.
- **Provider parity:** any new tool/feature must be tested against all adapters (at least via the fake provider).
- **Safety first:** route destructive/network actions through the permission engine; never bypass it.
- **Validation:** all tool inputs validated with Zod; all config validated on load.
- **Tests:** add Vitest tests for new logic; use the fake provider for deterministic agent-loop tests; no live API calls in unit tests.
- **ESM + strict TypeScript:** no `any` without justification; prefer narrow types.
- **Style:** follow ESLint/Prettier config; match existing patterns; small focused modules.
- **Don't introduce new core dependencies casually** — pin versions; prefer well-maintained libs.
- **Secrets:** never log/echo API keys; load from env/config only.
- **Commits:** only when the user asks; stage specific files; conventional, concise messages.
- **Update docs:** if you change architecture or conventions, update this file and `WORKPLAN.md`.

## 8. Key terms

| Term | Meaning |
|------|---------|
| Adapter | Provider-specific translator implementing `ProviderAdapter`. |
| Agent loop | The reason→act→observe cycle driving tool use. |
| Tool | A callable capability with a validated input schema. |
| MCP | Model Context Protocol — standard for external tool/resource servers. |
| Skill | On-demand instruction package (`SKILL.md` + resources). |
| Workflow | Automation: hooks, headless runs, subagents, pipelines. |
| Plugin | Bundle packaging commands/skills/agents/MCP servers/hooks. |
| Frontend | A transport adapter (CLI, Telegram, …) over the headless agent core. |
| Remote coding | Operating the agent through a remote frontend such as Telegram. |
| Headless mode | Non-interactive run for CI/scripting (`thinkco -p "..."`). |

## 9. Status

Project is in **planning/scaffolding**. See `WORKPLAN.md` for the current phase and open TODOs.
