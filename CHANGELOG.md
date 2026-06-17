# Changelog

All notable changes to thinkco are documented here. This project is currently in **beta** at
`0.1.0`; the version stays `0.1.0` until the first stable release.

## 0.1.0-beta — 2026-06-16

First public beta. Addresses the product-owner audit (P0–P2) and adds a full TUI/UX pass.

### Providers & cost

- **Native Gemini adapter** — real Google Generative Language API support (SSE streaming +
  function calling). Fixes the previously-broken "Gemini" provider that silently fell back to a
  fake stub.
- **Prompt caching (Anthropic)** — the system prompt and tools are marked with `cache_control`,
  caching the stable prefix across turns. Cached read/written tokens show in `/usage`.
- **Real tokenizer** — accurate token counting via the optional `gpt-tokenizer` dependency, with
  a dependency-free heuristic fallback. Drives compaction triggers and cost estimates.
- **Extended thinking (Anthropic)** — opt-in reasoning budget via `reasoning.budgetTokens`.
- **Image/vision input** — unified image content blocks, sent natively by the Anthropic and
  OpenAI adapters.

### Agent core

- **Parallel tool execution** — independent read-only tool calls run concurrently (mutating
  calls stay sequential); result order is preserved.
- **Failover preserves work** — on a mid-turn provider error, executed tool results are carried
  to the fallback provider so it resumes instead of restarting.
- **LLM-backed compaction by default** — older turns are summarized by a (configurable, cheap)
  model instead of lossy truncation.
- **`runtime.ts` decomposed** — commands, compose orchestration, the goal judge, subagent
  management, and checkpointing moved into focused modules (~30% smaller core file).

### Frontends & UX

- **VS Code extension** (`extensions/vscode/`) wrapping the headless core, with native tool
  approvals.
- **Theme system** — `/theme` plus light/dark auto-detection.
- **Input foundation** — command history recall/search, `@file` path completion, multi-line input
  helpers.
- **Rich tool display** — status icons and collapsible output.
- **Better approvals** — command-detail preview and trust-scope options.
- **Activity tray**, concise **thinking/progress** line, **crew/subagent monitor** (`/crew`),
  **transcript export/copy** (`/transcript`), and **terminal-title progress**.

### Ecosystem & packaging

- **Plugin registry growth** — a larger curated catalog with categories/tags, `/plugin search`
  by tag/category, and `/plugin categories`.
- **npm beta readiness** — `prepublishOnly` gate (build + lint + test) and `publishConfig` so the
  package publishes publicly under the `beta` dist-tag. Install with `npm install -g thinkco@beta`.

### Tests

- Test suite grown to **438 passing** across the new and existing features.
