# 4. In-browser mock backend for the reference

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

The spec describes a substantial cloud backend (Functions/Container Apps,
Durable orchestration, Cosmos, Blob, Service Bus, Speech, AI Search, Foundry
models). Standing all of that up is required for production but is a poor fit
for a reference whose goal is to let a reviewer **evaluate the reviewer
experience and workflow correctness** quickly, offline, and safely.

The priority order (speech quality → factual grounding → **reviewer control** →
security → usability) means the most valuable thing to demonstrate is the
**human-in-the-loop workflow**, driven by the *real* domain rules and *real*
SSML engine — not live model calls.

## Decision

Back the SPA with an **in-memory store** (`apps/web/src/store/StudioContext.tsx`)
seeded from `sample-data`. Crucially:

- All **workflow transitions** go through the real `@studio/domain` state
  machine (`evaluateTransition`), including gates, rejection reasons, and audit
  append.
- The **live SSML preview** uses the real `@studio/ssml` projection engine and
  the seeded voice **capability registry**.
- Synthesis, retrieval, and delivery are represented with pre-seeded, realistic
  data (e.g. a **blocking** pronunciation-QA mismatch) so the gating behavior is
  genuinely exercised.

No network calls leave the browser.

## Consequences

- `npm run dev` gives a full, walkable 15-step MVP flow with no cloud, no
  secrets, and no data-leak risk.
- The parts that most affect quality and safety (workflow, SSML, gating) are
  **real and tested**, not faked.
- State resets on refresh, and simulated capabilities (auth, synthesis, delivery)
  must be swapped for real adapters in production. Every such boundary is listed
  in [KNOWN_LIMITATIONS.md](../../KNOWN_LIMITATIONS.md). The store is deliberately
  shaped like a service client so it can be replaced with API calls with minimal
  UI change.
