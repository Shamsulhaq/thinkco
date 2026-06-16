# thinkco — User Guide

A terminal-first, multi-provider agentic coding CLI. This guide covers install/uninstall,
commands, and how to use tools, skills, plugins, MCP, and remote (Telegram).

---

## 1. Install

```bash
# One-line install (clones, builds, links the `thinkco` command)
curl -fsSL https://raw.githubusercontent.com/Shamsulhaq/thinkco/main/install.sh | bash

# Or via npm (global)
npm install -g thinkco                                  # once published
npm install -g git+https://github.com/Shamsulhaq/thinkco.git   # straight from GitHub

# Or run without installing
npx thinkco

# From source
git clone https://github.com/Shamsulhaq/thinkco.git && cd thinkco
npm install && npm run build && npm link
```

Requirements: **Node.js ≥ 20** and **git**. Optional features:
- `web_search` → `npm i -g playwright && npx playwright install chromium`
- structural code rewrite → `npm i -g @ast-grep/napi`
- semantic search → an embeddings backend (OpenAI key, or `ollama pull nomic-embed-text`)

## 2. Uninstall

```bash
# If installed via npm
npm uninstall -g thinkco

# If installed via the curl script / npm link
cd ~/.thinkco/src && npm unlink -g 2>/dev/null; npm rm -g thinkco 2>/dev/null
rm -rf ~/.thinkco/src           # the cloned source (curl installer)

# Remove your data/config (optional)
rm -rf ~/.config/thinkco        # global config + caches
rm -rf .thinkco                 # per-project state (memory, tasks, sessions) in a repo
```

## 3. First run & API keys

```bash
thinkco                      # full-screen TUI
thinkco --classic            # plain readline REPL
```
Set a provider key one of three ways:
- In the app: run **`/login`**, pick a provider, paste the key (it tests the connection + lists models).
- Env var: `export ANTHROPIC_API_KEY=...` (or `OPENAI_API_KEY`, `GEMINI_API_KEY`).
- Config file (below).
- Or run a **local model** (Ollama / LM Studio) — auto-detected, no key needed.

## 4. CLI flags & subcommands

```
thinkco [options]                 Interactive session (TUI; falls back to readline on non-TTY)
thinkco -p "<task>" [--json --yes]  Headless: run one task and exit (great for CI/scripts)
thinkco --provider <name>         anthropic | openai | gemini | ollama | lmstudio | <custom>
thinkco --model <id>              Model id
thinkco --permission-mode <m>     default|acceptEdits|plan|dontAsk|auto|bypass
thinkco --classic                 Classic readline REPL
thinkco --resume [id]             Resume the latest session (or a specific one by id)
thinkco -v | --version            Print version
thinkco -h | --help               Help

thinkco telegram <cmd>            setup | set-token <t> | add-user <id> | remove-user <id> | status | test | start
thinkco schedule                  Run configured scheduled tasks in the foreground
```

## 5. Slash commands (inside a session)

| Command | What it does |
|---|---|
| `/help` | List commands (tabbed overlay in the TUI) |
| `/login` | Add a provider API key (tests connection, lists models) |
| `/provider [name]` | List configured providers / switch |
| `/models` | Pick a model (↑/↓), shows price + context |
| `/mode [name]` | Permission mode (or **Shift+Tab** to cycle) |
| `/agent [build\|plan\|compose]` | Switch primary agent (or **Tab** to cycle) |
| `/goal <condition>` | Set a stop condition verified by a judge model (`/goal clear`) |
| `/compose <spec>` | Specs-driven orchestration: plan→docs→implement→review→test→verify→readme |
| `/agents` | List sub-agents · `/agents cancel <id>` · `/agents result <id>` |
| `/budget <usd>` | Per-session cost cap (`off` to clear) |
| `/fallback ...` | Show/set the provider failover chain: `/fallback openai:gpt-4o, anthropic` · `/fallback off` |
| `/undo` | Revert the working tree to the pre-turn snapshot (needs `autoCommit`) |
| `/usage` | Token usage + estimated cost (live pricing) |
| `/skills` | List available skills |
| `/plugin ...` | `search <q>` · `install <src>` · `enable/disable/remove <name>` |
| `/memory` *(tool)* | Agent reads/writes durable memory (see Tools) |
| `/compact` | Summarize/compact the conversation now |
| `/resume` | Resume the latest session |
| `/clear` | Clear the conversation |
| `/init` `/doctor` `/config` `/trust` `/rename` | Project init / health check / show config / trust dir / rename session |
| `/exit` | Quit |

**Keys (TUI):** `Tab` cycles agents (or autocompletes the highlighted `/command`), `Shift+Tab` cycles permission modes, `↑/↓` navigate, `Esc` closes overlays. **`Ctrl+C`** interrupts a running task; press it **again (within 3s)** — or run `/exit` — to quit. On exit, thinkco prints `thinkco --resume <id>` so you can pick the session back up.

## 6. Tools (the agent calls these for you)

You don't invoke tools directly — you describe what you want and the agent uses tools, asking for
approval on risky actions. Available tools:

`read` `write` `edit` `list` `glob` `grep` `shell` `git` `web_fetch` `web_search` `code`
`knowledge` `task` `memory` `subagent` `use_aws`

- **code** — `search_symbols`, `get_document_symbols`, `generate_codebase_overview`,
  `search_codebase_map`, and `pattern_search`/`pattern_rewrite` (AST, via optional `@ast-grep/napi`).
- **knowledge** — `add`/`search`/`show`/`update`/`remove` indexed content (BM25 + optional embeddings), under `.thinkco/knowledge`.
- **task** — persistent tree (`T1`, `T1.1`) with `add`/`start`/`done`/`next`/`progress`, dependencies & priority, under `.thinkco/tasks`.
- **memory** — `read`/`remember`/`note`/`search`/`checkpoint` cross-session memory in `.thinkco/memory`.
- **subagent** — delegate a subtask (optionally `share_context` or run in `background`).
- **web_search** — headless browser search (needs Playwright). **use_aws** — wraps the AWS CLI.

**Permissions:** destructive/secret/network actions prompt for approval. Cycle modes with **Shift+Tab**
(`default` prompts, `acceptEdits` auto-allows edits, `plan` is read-only, `auto` uses a classifier,
`bypass` runs everything, `dontAsk` never prompts). Set `"permissions": {"sandbox": true}` to hard-block
dangerous/network shell commands.

## 7. Skills

Reusable instruction packs that activate by trigger words.

```
.thinkco/skills/<name>/SKILL.md
```
```markdown
---
name: my-skill
description: When to use this skill
triggers: keyword1, keyword2
allowed-tools: read, grep
---
Instructions the agent follows when the skill activates.
```
List with `/skills`. Skills activate progressively when your message matches a trigger; a skill can
pre-approve tools and ship runnable scripts.

## 8. Plugins

Bundle commands, skills, MCP servers, and hooks.

```bash
/plugin search review            # browse the registry
/plugin install code-review      # installs a bundled plugin (offline)
/plugin enable code-review
/plugin disable code-review
/plugin remove code-review
```
Bundled examples: **code-review** (`/review` + skill) and **conventional-commits**.

**Claude Code plugins** also work: point `claudePlugins` at their directories and thinkco loads their
`.claude/agents/*.md` as skills and `.claude/commands/*.md` as commands. The **ruflo-core** set
(coder, reviewer, tester, planner, researcher, architect, code-analyzer) ships enabled by default.

```json
{ "claudePlugins": ["~/.thinkco/plugins/ruflo"] }
```

## 9. MCP servers

Add Model Context Protocol servers in config; thinkco **auto-starts them as managed child processes
and stops them on exit** — no manual `mcp start` needed.

```json
{
  "mcpServers": {
    "files":      { "command": "uvx", "args": ["mcp-server-files"] },
    "remote-svc": { "transport": "http", "url": "https://example.com/mcp" }
  }
}
```
Their tools appear as `mcp__<server>__<tool>` and are gated by the permission engine. MCP servers
declared by loaded Claude Code plugins (e.g. claude-flow) are auto-started too.

## 10. Remote coding (Telegram)

```bash
thinkco telegram set-token <bot-token>     # from @BotFather
thinkco telegram add-user <your-id>        # from @userinfobot
thinkco telegram test                      # ✓ Connected as @yourbot
thinkco telegram start                     # runs in your project dir
```
Then message your bot like the CLI. ⚠ **This is remote code execution** — keep the allowlist to just
your ID, run in a sandbox/dedicated dir, and stop the bot when idle.

## 11. Configuration

Global `~/.config/thinkco/config.json` merged with project `./.thinkco/config.json`:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-3-5-sonnet-latest",
  "providers": { "openai": { "apiKey": "sk-..." } },
  "permissions": { "allow": ["read", "grep"], "deny": ["shell:rm *"], "sandbox": false },
  "mcpServers": {},
  "hooks": { "post-edit": ["prettier --write $THINKCO_PATH"] },
  "schedule": [{ "id": "nightly", "every": "1d", "prompt": "summarize today's git log" }],
  "fallback": [{ "provider": "openai", "model": "gpt-4o" }],
  "maxCostUSD": 5,
  "autoCommit": true,
  "modelRouting": { "plan": "gpt-4o-mini", "build": "gpt-4o" },
  "claudePlugins": []
}
```

## 12. Where thinkco stores things

- `~/.config/thinkco/` — global config + pricing cache
- `.thinkco/memory/` — `MEMORY.md`, `notes.md`, `checkpoint.md`
- `.thinkco/tasks/` — persistent task tree + per-task `progress.md`
- `.thinkco/sessions/` — saved sessions (for `/resume`)
- `.thinkco/knowledge/` — knowledge index
- `.thinkco/skills/`, `.thinkco/commands/`, `.thinkco/plugins/` — your extensions
