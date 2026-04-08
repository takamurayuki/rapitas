# Architecture Decision Records (ADR)

This directory captures **decisions that shape the architecture of rapitas** —
not bug fixes, not feature work. The goal is that a future contributor (or
future you) can read an ADR and understand *why* the codebase is the way it is,
without having to reconstruct the reasoning from git archeology.

## When to write an ADR

Write one when a decision:
- Constrains how future code must be structured
- Trades off two reasonable approaches (and the loser is non-obvious)
- Reverses a previous decision
- Touches a cross-cutting concern (build, deploy, runtime, data model)

Bug fixes, refactors, and "we picked library X because it was popular" do not
need an ADR.

## Format

Each ADR is a single Markdown file named `NNNN-kebab-case-title.md`, numbered
sequentially. Use this template:

```markdown
# NNNN. Title

- Status: proposed | accepted | superseded by ADR-XXXX
- Date: YYYY-MM-DD
- Deciders: @takamurayuki

## Context

What problem are we solving? What constraints exist? Quote dates and links.

## Decision

What did we decide? Be specific.

## Alternatives considered

1. **Option A** — pros / cons / why not
2. **Option B** — pros / cons / why not

## Consequences

- Positive: ...
- Negative: ...
- Neutral: ...

## Follow-ups

- [ ] open tasks created by this decision
```

## Index

| # | Title | Status |
|---|---|---|
| [0001](./0001-three-runtimes-coexistence.md) | Three runtimes (npm + pnpm + bun) coexistence | accepted |
