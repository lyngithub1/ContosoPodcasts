# 3. Custom design tokens over Fluent UI

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

The spec's proposed frontend lists "Fluent UI React components **and** custom
design tokens." Fluent UI is the natural Microsoft-aligned choice. However, for
a self-contained reference that must **build reliably** and be easy to review,
pulling in a large component library introduces version/peer-dependency and
theming friction that is disproportionate to the value for a demo whose priority
order puts *speech quality and reviewer control* far above component polish.

The higher-priority requirements — **WCAG 2.2 AA**, an unmistakably Azure
aesthetic, and fast iteration on bespoke, workflow-specific UI (timeline,
speech workbench, waveform, SSML preview) — do not depend on a specific
component vendor.

## Decision

Implement the UI with a **custom design-token system** (CSS custom properties in
`apps/web/src/styles/tokens.css`) plus small hand-rolled primitives
(`global.css`, `app.css`). Tokens encode the Azure palette (blues/cyan/navy dark
theme), spacing, radii, typography, motion, and status colors.

Accessibility is built into the primitives:

- Visible keyboard focus, a skip link, and semantic landmarks.
- Status is always conveyed by **icon + text**, never color alone.
- `prefers-reduced-motion` support.

## Consequences

- Zero third-party UI runtime dependency → smaller bundle, no version churn, a
  build that "just works" for reviewers.
- Full control over the specialized workflow surfaces the spec emphasizes.
- We forgo Fluent's ready-made components and must maintain our primitives. If
  this graduates to a product, adopting Fluent UI (or Fluent 2 web components)
  behind the same tokens is a reasonable, non-breaking follow-up — the tokens
  were chosen to be compatible with that direction.
