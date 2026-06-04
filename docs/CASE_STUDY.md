# rapitas — Case Study

> A local-first **AI engineering workbench** I designed and built solo: autonomous coding agents that research → plan → implement → verify a task **inside an isolated git worktree**, gated by an automated lint/type **verification gate** before any commit or PR — shipped as a Next.js web app **and** a Tauri/Rust desktop app over a Bun/Elysia backend.
>
> Built primarily for my own workflow; published as an engineering showcase.

<!-- TODO: 90-second demo GIF/video here — agent picks up a task → research/plan → edits code in a worktree → verification gate runs → PR opened. This is the single highest-leverage thing to add. -->
<!-- ![demo](demo.gif) -->

---

## At a glance (what this demonstrates)

| Area | What it shows |
| --- | --- |
| **Agentic systems** | I didn't just call an LLM API — I built the orchestration: isolated execution, a quality gate, a self-repair retry loop, and a workflow state machine. |
| **Systems / OS-level** | Real PTY (ConPTY) integration, multi-process lifecycle, graceful shutdown, and a kernel-socket-leak fix that previously required a reboot. |
| **End-to-end ownership** | Three runtimes (Tauri/Rust desktop, Bun/Elysia backend, Next.js/React frontend) integrated by one person. |
| **Engineering maturity** | ADRs, enforced code/comment/folder policies, an automated agent-output gate, profiled-and-fixed startup performance. |

**Stack:** Tauri 2 + Rust · Bun + Elysia + Prisma (SQLite local / PostgreSQL web) · Next.js 16 + React 19 + Tailwind 4 + TypeScript · multi-provider LLMs (Claude / OpenAI / Gemini) + local LLM (Ollama/llama-server) + RAG embeddings.

---

## The problem I set out to solve

AI coding agents are powerful but **unsafe by default**: they edit files in place, happily produce broken diffs, and flood you with PRs you then have to babysit. I wanted a tool where an agent could take a task and *actually finish it* — without (a) touching my working tree while I work, (b) shipping code that doesn't even lint or type-check, or (c) locking me into a single AI CLI.

So rapitas is built around three opinions:

1. **Isolate the agent.** Every run happens in a throwaway git worktree, never the main checkout.
2. **Gate the output.** No diff becomes a commit/PR until an automated lint + type-check gate passes — and if it fails, the agent is sent back to fix its own mess (bounded retries).
3. **Don't get locked in.** Claude Code / Codex / Gemini are interchangeable, with model-tier routing and fallback.

---

## Architecture

```
┌─────────────────────────────┐     spawns / supervises
│  Tauri 2 (Rust)  desktop     │ ─────────────────────────┐
│  · tray, shortcuts, PTYs     │                           │
│  · parent-liveness watchdog  │                           ▼
└──────────────┬──────────────┘            ┌────────────────────────────────┐
   loads :3000 │ (dev) / static (prod)     │  Bun + Elysia backend  :3001     │
               ▼                           │  · orchestrator + worker manager │
┌─────────────────────────────┐  HTTP/SSE  │  · workflow state machine        │
│  Next.js 16 / React 19       │ ◀────────▶ │  · verification gate             │
│  · tasks, kanban, dashboards │            │  · model discovery / router      │
│  · integrated terminal (xterm)│           │  · RAG memory (embeddings)       │
└─────────────────────────────┘            └───────────────┬──────────────────┘
                                                            │ per-task isolation
                                                            ▼
                                            ┌────────────────────────────────┐
                                            │  git worktree per execution      │
                                            │  .worktrees/task-<id>-<hex>/     │
                                            │  agent CLI runs HERE (subprocess)│
                                            └────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](ARCHITECTURE.md) and the ADRs in [docs/adr/](adr/) for the reasoning (three-runtime coexistence, Prisma schema-folder split, realtime transport, TypeScript strictness ratchet, …).

---

## Hero engineering achievements

### 1. Safe autonomous agent execution → **[full deep-dive](deep-dive/safe-agent-execution.md)**

The flagship. An agent takes a task and runs the `research → plan → verify` workflow inside an isolated worktree; an automated **verification gate** (ESLint `--format json` + `tsc --noEmit`, scoped to the files the agent changed) must pass before any commit/PR. On failure, a **self-repair loop** re-runs the agent in the *same* worktree with the lint/type errors as feedback (default 2 retries), and the gate **guards both** auto-PR paths. The gate is **fail-closed**: if the tooling can't run, the task is blocked rather than waved through.

*Why it's interesting:* it's a concrete answer to "how do you let an AI modify a real codebase without it breaking things?" — isolation + an objective gate + bounded self-correction, with a state machine that prevents out-of-order or regressive steps.

### 2. Resilient multi-process desktop lifecycle

A Tauri desktop app supervising a Bun backend, a Next.js frontend, agent worker processes, a Whisper voice daemon, and a local LLM sidecar — across `tauri dev`, tray-quit, and hard window-close paths on Windows. I hit (and fixed) a class of bug where half-closed SSE/polling connections orphaned as `CLOSE_WAIT` zombie sockets on port 3001, eventually requiring a reboot. The fix combined a **force-close-on-shutdown** (`server.stop(true)`), a **parent-liveness watchdog** (polls the parent PID and shuts down gracefully even when no signal is delivered), and a layered port-reclamation strategy in the dev launcher.

*Why it's interesting:* most app developers never touch process/socket lifecycle. This is the kind of bug that's invisible until production and miserable to diagnose.

### 3. Multi-model routing with cost awareness

Provider **probes** (Claude/OpenAI/Gemini/Ollama) discover available models, classify them into tiers (`premium → standard → economy → free`), and a router picks by preferred-provider / free-first / cheapest-per-1k-tokens with automatic tier fallback. Results are cached (5 min) and token/cost is tracked per execution.

*Why it's interesting:* it turns "which model?" from a hardcoded constant into a policy, and makes the cost of agentic work visible.

---

## Engineering practices (maturity signals)

- **ADRs** for the load-bearing decisions ([docs/adr/](adr/)).
- **Enforced standards**: comment policy (WHY-not-WHAT), component-splitting, folder-organization, and icon-consistency policies — applied to humans *and* AI agents via `CLAUDE.md`.
- **The agent's own output is gated** by lint + type-check before it can be committed (dogfooding the verification gate).
- **Profiled and fixed startup**: identified that `prisma generate` ran on every (re)start and that warm-up tasks blocked the event loop after `listen`; added a schema-hash cache and deferred/instrumented warm-up. *(要計測: restart X.Xs → Y.Ys を README に記載する)*

---

## How this was built (honest note)

This was developed **AI-augmented** — I used coding agents heavily (including rapitas-style workflows and Claude Code). What I own and can defend in depth: the **architecture**, the **isolation + verification-gate design**, the **process/socket lifecycle fixes**, and the **quality gates** that keep AI-generated code honest. Directing AI tooling toward a correct, maintainable system *is* the modern engineering skill this project demonstrates.

---

## Limitations & what I'd do next

- The verification gate covers **lint + type-check**; **test execution** is the obvious next gate (and persisting retry state in the DB rather than session metadata).
- It's **local-first / single-user** by design; **cloud sync / multi-device** would require scoping data by `userId` and a sync service (deliberately out of scope today).
- GitHub integration is **read + comment** oriented; bidirectional issue↔PR sync is not a goal.
- More automated tests + CI coverage (in progress).

---

## Links

- 🔬 Deep-dive: [Safe autonomous agent execution](deep-dive/safe-agent-execution.md)
- 🏛️ [Architecture](ARCHITECTURE.md) · [ADRs](adr/)
- 🧭 Agent operating rules: [CLAUDE.md](../CLAUDE.md)
