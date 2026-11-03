# Documentation index

Maintained documentation for rapitas. When a document and the code disagree,
the code is right — fix the document.

## Start here

| Document | Contents |
| --- | --- |
| [../README.md](../README.md) | What rapitas is |
| [SETUP.md](SETUP.md) | Prerequisites, first-time setup, dev commands |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System map: processes, module boundaries, data model, CI gates |
| [RUNBOOK.md](RUNBOOK.md) | Symptoms and fixes for common local problems |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Branching, commits, code style, testing |
| [../AGENTS.md](../AGENTS.md), [../.claude/CLAUDE.md](../.claude/CLAUDE.md) | Rules for AI agents working in this repository |

## How things work

| Document | Contents |
| --- | --- |
| [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md) | Inventory of the live agent-orchestration mechanisms |
| [deep-dive/safe-agent-execution.md](deep-dive/safe-agent-execution.md) | Worktree isolation, verification gate, bounded self-repair |
| [reproducibility.md](reproducibility.md) | What keeps prompt-visible context deterministic |
| [eval-private-set.md](eval-private-set.md) | Private evaluation set and fault-injection E2E |
| [PERFORMANCE.md](PERFORMANCE.md) | Known bottlenecks and budgets |
| [AUTO_UPDATE.md](AUTO_UPDATE.md) | Desktop auto-update (currently disabled, #978) and release flow |
| [local-llm-tuning.md](local-llm-tuning.md) | Tuning the local LLM (Ollama) tier |
| [runtime-preview-api.md](runtime-preview-api.md) | Runtime config for previewing rapitas itself |
| [pre-commit-guide.md](pre-commit-guide.md) | What the pre-commit hook does |
| [test-data-driven-guide.md](test-data-driven-guide.md) | Table-driven test patterns for `bun:test` |
| [../rapitas-backend/docs/pr-endpoint-guard-pattern.md](../rapitas-backend/docs/pr-endpoint-guard-pattern.md) | Pre-checks for PR-operation endpoints |

## Design notes

| Document | Contents |
| --- | --- |
| [design/ui-design-language.md](design/ui-design-language.md) | UI aesthetic rules |
| [design/dev-schema-sync.md](design/dev-schema-sync.md) | Provider-aware dev schema sync |
| [design/global-error-reporter-filter.md](design/global-error-reporter-filter.md) | Benign-error filter for the global error reporter |
| [research/autonomous-os-improvement-roadmap.md](research/autonomous-os-improvement-roadmap.md) | Research-based improvement proposals (2026-07) |

## Generated

`rapitas-backend/docs/boundary-guide.generated.md`,
`rapitas-backend/docs/shutdown-error-spec.md` and
`rapitas-backend/docs/shutdown-error-changelog.md` are generated — edit their
generator scripts, not the files.

## Records

- [adr/](adr/README.md) — architecture decision records. Historical decisions;
  do not rewrite them, supersede them with a new ADR.
- [lessons/](lessons/) — incident and lesson narratives.
- [archive/](archive/README.md) — historical documents, not maintained.
