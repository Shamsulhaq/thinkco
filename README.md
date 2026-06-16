# thinkco

A terminal-first, **multi-provider** agentic coding CLI — provider-agnostic, extensible, and
remote-capable. Think "Claude Code, but it works across Anthropic, OpenAI, Gemini, and local
models (Ollama)."

See `AGENT.md` for architecture and `WORKPLAN.md` for the phased roadmap.
New here? Read the **[User Guide](docs/USER-GUIDE.md)** (install, commands, tools, skills, plugins, MCP, Telegram).

## Install

```bash
# One-line install (clones, builds, and links the `thinkco` command)
curl -fsSL https://raw.githubusercontent.com/Shamsulhaq/thinkco/main/install.sh | bash

# Or via npm (global)
npm install -g thinkco                                  # once published to npm
npm install -g git+https://github.com/Shamsulhaq/thinkco.git   # straight from GitHub

# Or run without installing
npx thinkco
```

### From source

```bash
git clone https://github.com/Shamsulhaq/thinkco.git && cd thinkco
npm install && npm run build
npm link        # puts `thinkco` on your PATH
```

### Single-file build (portable)

```bash
npm run bundle            # → dist/thinkco.mjs (one self-contained file)
node dist/thinkco.mjs     # run it anywhere with Node ≥ 20
```

`dist/thinkco.mjs` bundles all core dependencies into one file you can copy to any machine with
Node ≥ 20. Optional features keep their own installs and degrade gracefully if absent:
`web_search` needs `npm i playwright`, AST code intelligence needs `npm i @ast-grep/napi`. Keep
the `plugins/` folder next to the file to ship the bundled agents.

## Quick start

```bash
thinkco                       # interactive full-screen TUI (Ink)
thinkco --classic             # classic readline REPL instead of the TUI
thinkco --provider openai     # pick a provider
thinkco -p "summarize src/"   # headless: run one task and exit
thinkco -p "fix the bug" --json --yes   # headless JSON, auto-approve
```

The interactive UI is a full-screen terminal app (persistent input box, live-rendering
scrollback, status bar). On a non-TTY (pipes/CI) or with `--classic`, it falls back to a
streaming readline REPL automatically.

Set API keys via env or config:

```bash
export ANTHROPIC_API_KEY=...   # or OPENAI_API_KEY / GEMINI_API_KEY
```

If no key is set, thinkco falls back to an offline **fake** provider so the CLI still runs.

## Configuration

`~/.config/thinkco/config.json` (global) merged with `./.thinkco/config.json` (project):

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-3-5-sonnet-latest",
  "providers": { "openai": { "baseUrl": "https://api.openai.com/v1" } },
  "permissions": { "allow": ["read", "grep"], "deny": ["shell:rm *"], "sandbox": false },
  "mcpServers": { "files": { "command": "uvx", "args": ["mcp-server-files"] } },
  "hooks": { "post-edit": ["prettier --write $THINKCO_PATH"] },
  "schedule": [{ "id": "nightly", "every": "1d", "prompt": "summarize today's git log" }]
}
```

Run scheduled tasks in the foreground with `thinkco schedule` (Ctrl-C to stop).

## Slash commands

`/help` `/clear` `/compact` `/resume` `/models` `/login` `/mode` `/provider` `/skills` `/plugin`
`/usage` `/trust` `/init` `/doctor` `/config` `/rename` `/agent` `/goal` `/compose` `/agents` `/budget` `/fallback` `/undo` `/exit`

**Primary agents** (switch with **Tab** or `/agent`): **build** (full tools), **plan** (read-only
analysis), **compose** (specs-driven orchestration: plan→implement→review→test→verify). `/goal
<condition>` sets a stop condition an independent judge model verifies before the agent stops;
`/compose <spec>` drives the spec-to-shipped lifecycle; `/agents` lists/cancels sub-agents.

**Reliability, cost & safety** (all opt-in via config):

```json
{
  "fallback": [{ "provider": "anthropic", "model": "claude-3-5-sonnet-latest" }],
  "maxCostUSD": 5,
  "autoCommit": true,
  "modelRouting": { "plan": "gpt-4o-mini", "build": "gpt-4o", "compose:implement": "openai:gpt-4o" },
  "permissions": { "sandbox": true }
}
```

- **`fallback`** — on a provider error mid-turn, thinkco switches to the next provider/model and retries (notice in the transcript). Set it without editing config via **`/fallback openai:gpt-4o, anthropic`** (`/fallback off` clears it); it persists globally.
- **`maxCostUSD`** — per-session spend cap from live pricing: warns at 80%, hard-stops the turn at 100%. `/budget <usd>` sets it at runtime.
- **`autoCommit`** — snapshots the git working tree before each turn; **`/undo`** restores the last snapshot.
- **`modelRouting`** — pick a model (or `provider:model`) per agent (`build`/`plan`/`compose`) or compose phase (`compose:<phase>`).
- **`permissions.sandbox`** — hard-blocks dangerous/network/privilege shell commands (curl, ssh, `rm -rf /`, sudo, `git push`, …), enforced over every mode.
**Persistent memory** lives in `.thinkco/memory/` (`MEMORY.md`, `notes.md`, `checkpoint.md`) and is
auto-injected on resume; tasks are a persistent tree (`T1`, `T1.1`, …) under `.thinkco/tasks/`.

**Add a provider/API key** without editing config: run `/login`, pick a provider — **Anthropic,
OpenAI, Gemini, OpenRouter, Groq, Together, opencode zen, Ollama, LM Studio**, or a **custom
OpenAI-compatible** endpoint — and enter the key. thinkco then **tests the connection by fetching
the provider's models** and lets you pick one. Keys are saved to the global config and persist
across sessions.

Permission modes (cycle with **Shift+Tab**, or `/mode <name>`): `default`, `acceptEdits`,
`plan`, `dontAsk`, `auto` (classifier-based), `bypass`.

## Core tools

`read` `write` `edit` `list` `glob` `grep` `shell` `git` `web_fetch` `web_search` `task`
`memory` `use_aws` `subagent` `code` `knowledge` — all gated by the permission engine (destructive
commands and secret-file access always prompt).

- **`web_search`** uses a headless **Playwright** browser to scrape results. It's an optional
  dependency — enable it with `npm i playwright && npx playwright install chromium`. Without it,
  the tool returns install guidance instead of failing.
- **`use_aws`** wraps the AWS CLI (must be installed and configured via `aws configure`).
- **`subagent`** delegates a self-contained subtask to a fresh agent loop with its own context.
- **`task`** tracks work as a persistent task tree (subtasks, dependencies, priorities) under `.thinkco/tasks/`, folded into checkpoints.
- **`code`** is code intelligence: `search_symbols`, `lookup_symbols`, `get_document_symbols`,
  `generate_codebase_overview`, `search_codebase_map`, plus `pattern_search`/`pattern_rewrite`
  for structural search & rewrite. Symbol extraction is **AST-accurate** when the optional
  `@ast-grep/napi` is installed (`npm i @ast-grep/napi`) and falls back to fast multi-language
  regex parsing otherwise. Rewrites default to a dry-run preview.
- **`knowledge`** indexes local content (code, markdown, text, csv) and searches it with BM25,
  persisted under `.thinkco/knowledge`. Commands: `add`, `search`, `show`, `update`, `remove`,
  `clear`, `status`.

## Extending thinkco

- **MCP servers** — add to `mcpServers` in config (stdio; Python via `uvx`/`python -m`).
- **Skills** — drop a `SKILL.md` folder under `.thinkco/skills/`; activates progressively.
- **Custom commands** — add `.thinkco/commands/*.md` with `$ARGUMENTS`, `$1`, and `` !`cmd` `` injection.
- **Workflows** — hooks, headless mode (`-p`), subagents, and task pipelines.
- **Plugins** — bundle all of the above; `thinkco`'s `PluginManager` can scaffold, install, enable/disable.
- **Claude Code plugins** — thinkco runs Claude Code-format plugins too: their `.claude/agents/*.md`
  load as skills and `.claude/commands/*.md` as commands. A curated set of **ruflo (claude-flow)**
  coding agents (`coder`, `reviewer`, `tester`, `planner`, `researcher`, `architect`,
  `code-analyzer`) ships **bundled and enabled by default** in `plugins/ruflo-core`. To load more
  Claude Code plugins by choice, point `claudePlugins` at their directories:

  ```json
  { "claudePlugins": ["~/.thinkco/plugins/ruflo"] }
  ```

  The full ruflo agent set references claude-flow's MCP tools. thinkco **auto-starts that MCP
  server for you** as a managed child process (no `npx … mcp start` needed, and it's stopped when
  thinkco exits) — the first launch fetches `claude-flow@alpha` via npx. Only required servers
  start automatically; optional ones (`ruv-swarm`, `flow-nexus`) are skipped.

See `skills/` and `plugins/` for runnable examples.

## Remote coding (Telegram)

thinkco's agent core is **headless and UI-agnostic**. The CLI is one frontend; a Telegram bot is
another (Phase 12) — same loop, tools, providers, and permissions. Remote operation enforces a
stricter security model (user allowlist, stricter approval defaults, audit logging). **Operating a
coding agent over chat is remote code execution — keep the allowlist tight and prefer a sandbox.**

## Development

```bash
npm run build      # tsc
npm test           # vitest
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

## License

MIT
