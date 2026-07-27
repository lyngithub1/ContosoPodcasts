# 1. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

This project translates a detailed product specification into a runnable
reference. Several decisions materially shape the codebase (build system, UI
strategy, how the demo runs without a cloud, and the security model). Reviewers
need to understand *why* these choices were made, not just *what* was built.

## Decision

We keep short Architecture Decision Records (ADRs) in `docs/adr`, one file per
decision, numbered sequentially, using a lightweight MADR-style format
(Context → Decision → Consequences).

## Consequences

- The rationale behind non-obvious choices is discoverable and reviewable.
- New contributors can trace how the implementation diverges from — or
  faithfully implements — the specification.
- Superseded decisions are kept for history and marked as such rather than
  deleted.
