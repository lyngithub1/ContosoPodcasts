# 2. Monorepo with npm workspaces

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

The spec describes several logically distinct units: a front end, domain APIs,
speech adapters, research adapters, and shared contracts. Even though this
reference implements a subset, the **domain model** and **SSML engine** are
reusable libraries that the UI (and, later, the API) must share without
duplication or drift. We also want a single, reproducible install/build/test.

## Decision

Use a single repository with **npm workspaces**:

```
packages/domain   → @studio/domain   (entities + workflow state machine)
packages/ssml     → @studio/ssml      (friendly controls → SSML projection)
apps/web          → @studio/web       (React SPA)
```

- TypeScript **project references** (`tsconfig.build.json`) build the composite
  library packages; the web app is typechecked separately.
- Path aliases (`@studio/domain`, `@studio/ssml`) resolve to package **source**
  during development, and Vite mirrors these aliases so the SPA needs no
  pre-build step for the libraries.
- Root scripts (`dev`, `build`, `typecheck`, `test`) orchestrate the workspaces.

## Consequences

- One `npm install`; shared types cannot drift between UI and libraries.
- The domain and SSML packages are independently testable and publishable, and
  are ready to be consumed by a future API service (M10) with no changes.
- Slightly more tsconfig wiring (base + per-package + build solution + a small
  `tsconfig.node.json` for the Vite config), which is documented and validated
  by `npm run typecheck`.
