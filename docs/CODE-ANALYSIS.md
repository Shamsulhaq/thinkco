# docs/CODE-ANALYSIS.md — thinkco codebase analysis & gaps

Snapshot: **78 source files, ~7,200 LOC, 225 tests** (TypeScript/Node ESM). Architecture is
clean: a headless `AgentRuntime` core with provider adapters, a tool registry, a permission
engine, MCP, skills, plugins, workflows, and two frontends (Ink TUI + readline) plus a Telegram
frontend. This document lists concrete gaps with severity and a plan.

Severity: **S1** = correctness/reliability (fix now) · **S2** = production hardening · **S3** = polish/UX.

---

## S1 — Reliability / correctness

1. **No provider-call timeout → silent hangs.** `*Adapter.chat()` uses `fetch` with the caller's
   abort signal but no timeout. A stalled Ollama/HTTP call leaves the UI on "working…" forever.
   *Fix:* a stall timeout in the agent loop that aborts if no stream event arrives within N seconds.

2. **`read` tool has no size cap.** Reading a very large file dumps the whole thing into context,
   which can blow the model's window and slow local models. *Fix:* cap default reads (with a clear
   truncation note and guidance to use offset/limit).

3. **Adapters don't use `withRetry`.** `withRetry`/`httpStatusToError` exist but the streaming
   `chat()` calls aren't wrapped, so transient 429/5xx/network blips fail the turn. *Fix:* retry the
   initial request (pre-stream) with backoff.

## S2 — Production hardening

4. **Telegram frontend duplicates orchestration and lacks features.** `frontends/telegram` builds an
   `AgentLoop` per chat directly (its own `getChat`/`buildEngine`) instead of using `AgentRuntime`.
   Consequence: no slash commands, skills, custom commands, plugins, hooks, `@file`, or model
   switching over Telegram, and divergent code. *Fix:* rebuild it on `AgentRuntime` (per-chat
   runtime) so it inherits everything the CLI has.

5. **Entrypoint logic is untested.** `cli/index.ts main()` (onboarding, local detection, provider
   fallback, `schedule`, frontend selection) has no unit coverage. *Fix:* extract testable helpers
   and/or add integration tests.

6. **`web_fetch` has no SSRF guard.** It will fetch `http://localhost`, `169.254.169.254`, and
   internal hosts. As a `network`-risk tool it prompts, but a guard/allowlist is safer. *Fix:* block
   private/loopback hosts by default (configurable).

7. **Session store is unbounded.** `.thinkco/sessions/` grows forever. *Fix:* prune to the N most
   recent.

8. **Compaction summarizer uses the live (possibly local) model.** Summarizing a large transcript on
   a small local model is slow/unreliable. *Fix:* allow a configured cheaper summarizer model; keep
   heuristic fallback.

## S3 — UX / polish

9. **Tabbed overlays missing** (per design samples): `/plugin` should be a `Discover | Installed |
   Marketplaces` tabbed view, and `/help` a `General | Commands | Custom` view. Data/logic exist;
   only the interactive tab UI is missing.

10. **Two-column welcome header** (Tips / What's new) — currently a single column.

11. **`estimateTokens` is char/4** — fine for budgeting, imprecise for cost.

---

## Plan / status

- [x] **S1.1 provider stall timeout** — loop aborts a turn if the stream stalls past a threshold.
- [x] **S1.2 `read` size cap** — large reads truncated with guidance.
- [x] **S1.3 retry transient provider errors** — initial request wrapped in `withRetry`.
- [x] **S2.4 Telegram on AgentRuntime** — rebuilt on the shared runtime; gains commands/skills/plugins/permissions parity (also fixed a latent bug where the runtime didn't thread `cwd` into tool execution).
- [x] **S2.5 entrypoint tests** — extracted `ensureKnownProvider`/`resolveProvider` into `cli/resolve.ts` with unit tests (configured / local-detected / offline-fallback / saved-model-preservation).
- [x] **S2.6 web_fetch SSRF guard** — blocks loopback/private/link-local hosts unless `allowPrivateHosts`.
- [x] **S2.7 session pruning** — keeps the N most recent sessions.
- [x] **S3.9 tabbed `/plugin` and `/help` overlays** — Ink tabbed overlay (Help: General/Commands/Custom; Plugins: Installed/Discover) with search filter, ←/→ tabs, ↑/↓ nav, Enter-to-install, Esc-to-close.

All S1–S3 backlog items are now implemented and tested.
