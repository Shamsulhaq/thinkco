# thinkco vs Claude Code — honest comparison

This report compares **thinkco** (this project) with **Anthropic's Claude Code CLI**.

Claude Code facts below were verified against the official documentation
(`docs.claude.com` / `code.claude.com`) and Anthropic's engineering blog in **June 2026**.
Where a detail could not be verified, it is marked *(unverified)*. thinkco facts come directly
from this repository's source. No numbers or capabilities are invented.

> **Important context:** Claude Code is a mature, closed-source commercial product from the
> company that makes the underlying model. thinkco is a from-scratch open implementation. The
> goal here is an accurate map of overlaps and gaps — not to claim parity.

> **Update:** Most gaps below have since been closed — see `GAP-WORKPLAN.md`. thinkco now has
> permission modes (default/acceptEdits/plan/dontAsk/auto/bypass + Shift+Tab), protected paths,
> an MCP HTTP transport, richer Agent-Skills frontmatter, a classifier-based auto mode, the
> `/compact /resume /init /doctor /config /rename` commands, a **full-screen Ink TUI**, **parallel
> agent teams with git-worktree isolation**, and **plugin search/install-by-name + scheduled tasks**.
> Sections below describe the original gap; `GAP-WORKPLAN.md` reflects what is now implemented.

---

## 1. Snapshot

| | thinkco | Claude Code |
|---|---|---|
| Source | Open (this repo, TypeScript/Node ≥20) | Closed; distributed as a binary/npm package |
| Providers | **Anthropic, OpenAI, Gemini, Ollama, LM Studio, fake** | **Anthropic models only** (Sonnet/Opus/Haiku) via Anthropic API, Bedrock, Vertex, Foundry |
| Local models | **Yes — Ollama & LM Studio auto-detected** | No (Anthropic models only) |
| Remote/chat control | **Telegram frontend** (built in) | Remote Control, Claude Code on web, Slack, mobile *(verified features)* |
| Maturity | Early, ~160 unit tests | Production, millions of users, years of iteration |

The single biggest **difference in kind**: thinkco is **provider-agnostic and runs local models**;
Claude Code is **Anthropic-only**. The single biggest **difference in degree**: Claude Code is a
deep, polished platform; thinkco implements the core of that surface.

---

## 2. Permission model

**Claude Code (verified):** six permission *modes* — `default` (reads only), `acceptEdits`,
`plan`, `auto` (a separate classifier model approves/denies; research preview, requires
Opus 4.6+/Sonnet 4.6), `dontAsk`, and `bypassPermissions`. `Shift+Tab` cycles
default → acceptEdits → plan; the active mode shows in the status bar. A set of **protected paths**
(`.git`, `.claude.json`, `.mcp.json`, `.vscode`, …) is never auto-approved except in
`bypassPermissions`. A **workspace trust dialog** must be accepted before a project's skills,
settings, and `allowed-tools` load.

**thinkco (this repo):** a single permission engine with allow/deny rules, a **destructive-command
classifier** (regex: `rm -rf`, `git push --force`, `reset --hard`, fork bombs, `curl | sh`, …) and
**secret-file detection** (`.env`, `id_rsa`, `.pem`, …). Read-only actions auto-approve; everything
else prompts with a human-readable summary and a `[y]es / [a]lways allow <tool> / [N]o` choice.
A `/trust` command and first-run onboarding grant basic folder permissions. Remote (Telegram) runs
in a stricter mode that never auto-allows non-read actions.

**Gap:** thinkco has **no `plan` mode, no `acceptEdits` mode, and no Shift+Tab mode cycle**, and no
classifier-based `auto` mode. Its "trust folder" + "always allow tool" is closest to a coarse
`acceptEdits`. thinkco's rule-based destructive/secret detection is a reasonable, deterministic
substitute for Claude's classifier, but it is pattern-matching, not a model.

---

## 3. Extensibility (MCP, skills, commands, hooks, plugins)

| Capability | thinkco | Claude Code (verified) |
|---|---|---|
| **MCP** | stdio client; namespaced tools; Python servers via subprocess. HTTP transport not implemented | stdio + HTTP/SSE; 300+ service integrations; mature |
| **Skills** | `SKILL.md` + triggers + progressive loading + runnable scripts | `SKILL.md` following the **Agent Skills open standard** (agentskills.io); richer frontmatter (`allowed-tools`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `paths`, `shell`); auto-compaction re-attaches skills; **custom commands are merged into skills** |
| **Custom commands** | `.thinkco/commands/*.md` with `$ARGUMENTS`, `$1`, `` !`cmd` `` injection | Same substitutions plus `$ARGUMENTS[N]`, `$name`, `${CLAUDE_SESSION_ID}`, fenced `` ```! `` blocks; unified with skills |
| **Hooks** | `pre-tool-use`, `post-tool-use`, `post-edit`, `session-start/stop` | `PreToolUse`, `PostToolUse`, `PermissionRequest`, and more; hooks can also be scoped inside skills |
| **Plugins** | Manifest bundles commands/skills/MCP/hooks; install/enable/disable/scaffold | Mature plugin system + marketplace/discovery |
| **Subagents** | `spawn_subagent` tool + pipeline DAG | Subagents, **agent teams**, **worktree session isolation**, dynamic workflows |

thinkco implements the *shape* of all five extensibility layers. Claude Code's are deeper:
the Agent Skills open standard, an HTTP MCP transport with a large connector ecosystem, agent
teams, and worktrees are **real Claude Code features thinkco does not have**.

---

## 4. Commands & UX

**Claude Code (verified):** 60+ slash commands including `/help`, `/compact`, `/clear`
(aka `/reset`, `/new`), `/model`, `/config` (a tabbed settings UI), `/permissions`, `/agents`,
`/mcp`, `/doctor`, `/init`, `/review`, `/security-review`, `/rename`, `/feedback`, `/plan`,
`/skills`; bundled skills like `/code-review`, `/batch`, `/debug`, `/loop`, `/run`, `/verify`.
Keyboard: `Shift+Tab` (modes), `Ctrl+G` (open plan in editor).

**thinkco:** `/help`, `/clear`, `/models` (single arrow-key picker), `/provider`, `/skills`,
`/plugin`, `/usage`, `/trust`, `/exit`, plus Tab autocomplete for commands, a welcome box,
a thinking spinner, and streaming markdown + `⏺/⎿` tool rendering.

**Gap:** thinkco lacks `/compact` as a manual command (compaction is automatic), `/doctor`,
`/init`, `/config` UI, `/agents`, `/review`, `/security-review`, and the bundled-skill commands.
It has **no `/model` typed command** by design — model switching is the single `/models` arrow
picker.

---

## 5. Things thinkco does that Claude Code does not

These are genuine thinkco advantages, all present in this repo:

1. **Multiple providers** — Anthropic, OpenAI, Gemini, Ollama, LM Studio behind one unified
   adapter interface. Claude Code is Anthropic-only.
2. **Local-model auto-detection** — probes Ollama and LM Studio on launch and uses a local model
   with zero config or API key.
3. **Built-in Telegram remote frontend** — operate the same agent core over chat with an allowlist
   and inline-button approvals. (Claude Code has its own remote/web/Slack options, but not an
   open, self-hostable Telegram bot in the CLI package.)
4. **Open and forkable** — every part (providers, tools, permissions, frontends) is editable TS.

---

## 6. Where Claude Code is clearly ahead

Stated plainly and without spin:

- **Model quality & integration** — it is made by Anthropic for Anthropic models, with features
  like the `auto`-mode safety classifier that depend on first-party models.
- **Depth of platform** — computer use, Chrome extension, VS Code/JetBrains integrations, Claude
  Code on the web, Remote Control. (thinkco now has parallel agent teams, git-worktree isolation,
  and scheduled tasks, but not the IDE/web/desktop surface.)
- **Ecosystem** — 300+ MCP connectors, a plugin marketplace, the Agent Skills open standard.
- **Maturity & safety** — years of production hardening, classifier-based permissioning,
  extensive protected-path handling.
- **Full TUI** — Claude Code renders a persistent, redrawing terminal UI; thinkco uses a robust
  ANSI/readline approximation (welcome box, spinner, markdown, tool markers) — not a full-screen
  Ink/React TUI.

---

## 7. Honest summary

thinkco faithfully reproduces Claude Code's **core architecture** — agent loop, tool use,
permissions, MCP, skills, custom commands, hooks, subagents, plugins, headless mode — and adds
**multi-provider + local-model + Telegram** capabilities Claude Code does not have. It is **not**
at parity on **breadth** (agent teams, worktrees, scheduled tasks, computer use, IDE/web/Slack
integrations), **ecosystem** (MCP connector catalog, plugin marketplace, Agent Skills standard),
**permission sophistication** (classifier `auto` mode, the Shift+Tab mode cycle), or **polish**
(full-screen TUI, years of hardening).

Think of thinkco as an **open, provider-agnostic re-implementation of Claude Code's core**, useful
when you want local models or a different provider — not a drop-in replacement for the full
Claude Code platform.

*Verification note: Claude Code details were checked against official docs in June 2026 and may
change as the product evolves. thinkco details reflect this repository at the time of writing.*
