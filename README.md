# Azure Scientific Podcast Studio

A self-service **research-to-podcast factory** for scientific and healthcare
users. The studio acquires research material, builds a cited evidence set,
drafts a podcast script, supports staged human review, converts approved text
into high-quality speech, lets non-technical reviewers fine-tune pronunciation
and delivery **visually**, stores approved media privately in Azure, and
distributes it to selected recipients **only after explicit final approval**.

> This repository is a **runnable reference implementation** of the product
> specification in [`spec/`](spec). It ships an interactive front end, a Fastify
> domain API with real Azure integrations, a strongly-typed domain model, a
> tested SSML projection engine, sample medical content, and Infrastructure-as-Code
> for the target Azure architecture.
> See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for what is real vs. simulated.

The studio runs in **two modes**:

| Mode | How | What you get |
| --- | --- | --- |
| **In-browser** (default) | `npm run dev`, no `VITE_API_BASE_URL` | Every screen and workflow rule works against a seeded in-memory store. No cloud resources, no network calls, nothing persisted. |
| **Connected** | Point `VITE_API_BASE_URL` at the deployed API | Real Cosmos DB persistence, real Azure AI Speech synthesis + transcription, Document Intelligence extraction, AI Search retrieval, and Foundry script generation — all behind managed identity. |

---

## What's in the box

| Area | Location | Status |
| --- | --- | --- |
| Typed domain model + workflow state machine | [`packages/domain`](packages/domain) | ✅ real + unit-tested |
| SSML projection engine (friendly controls → standards-compliant SSML) | [`packages/ssml`](packages/ssml) | ✅ real + unit-tested |
| React SPA (full 15-step MVP flow) | [`apps/web`](apps/web) | ✅ runnable |
| Domain API (Fastify → Azure Container Apps) | [`apps/api`](apps/api) | ✅ real + route-tested |
| Sample medical content (German HIV scripts, pronunciation seeds) | [`sample-data`](sample-data) | ✅ |
| Azure infrastructure (Bicep) | [`infra/bicep`](infra/bicep) | ✅ compiles + deploys |
| Durable orchestration host | — | 🟡 Service Bus queues + in-process worker (not Durable Functions) |
| Malware scanning, delivery adapters, audio DSP | — | ⛔ not implemented (see limitations) |

---

## Quick start

**Prerequisites:** Node.js ≥ 20.

```bash
npm install         # install all workspaces
npm run dev         # start the SPA (Vite) at http://localhost:5173
```

Other scripts:

```bash
npm run typecheck   # tsc across packages, web app, and api
npm test            # unit + route tests (domain, ssml, api)
npm run build       # production build of packages + SPA
npm run build:api   # compile the domain API
npm run dev:api     # run the API locally (watch mode)
```

### Running the API locally

The API degrades gracefully: every Azure integration is optional, and anything
unconfigured reports as disabled on `/healthz` instead of failing to start.

```bash
npm run dev:api     # http://localhost:8080/healthz
```

With no environment variables it runs in **`header` identity mode** — a documented
demo shim that trusts `x-actor-*` request headers. That is insecure by design and
the server refuses to start that way unless `NODE_ENV` is `development`/`test` or
you set `ALLOW_HEADER_AUTH=true` deliberately. For a real deployment set
`AUTH_MODE=entra` with `AUTH_TENANT_ID` and `AUTH_AUDIENCE`; see
[docs/AUTH.md](docs/AUTH.md).

### Try the golden-path demo

1. The app opens on the **Projects** dashboard with two seeded projects.
2. Open **HIV — Doravirine/Islatravir** (it sits in *Audio review*).
3. Walk the persistent **timeline**: Research → Evidence → Script → Speech →
   Review → Publish.
4. In **Speech workbench**, select a word, open *"How should this sound?"*, and
   watch the **live SSML preview** update. Toggle voices to compare capabilities.
5. In **Audio review**, note the **blocking pronunciation QA** on
   *Tenofovir-Alafenamid* — approval is gated until you record an override.
6. Switch your role to **Publisher** (top bar) to unlock external-recipient
   delivery, then walk the **Publish** confirmation flow.
7. Inspect the **Audit trail** to see every transition and decision recorded.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web  (React + Vite SPA)                                   │
│    shell · store · stage screens · SSML preview · MSAL sign-in  │
└───────────────┬───────────────────────────────┬────────────────┘
                │ imports (typed)               │ HTTPS + Bearer
     ┌──────────▼──────────┐        ┌───────────▼────────────┐
     │  @studio/domain     │        │  apps/api (Fastify)    │
     │  entities + workflow│◄─mirror─┤  authoritative gates   │
     │  state machine      │        │  + Azure adapters      │
     └─────────────────────┘        └───────────┬────────────┘
     ┌─────────────────────┐                    │ managed identity
     │  @studio/ssml       │        ┌───────────▼────────────┐
     │  friendly → SSML    │        │  Cosmos · Blob · Speech│
     │  projection + escape│        │  Search · DocIntel     │
     └─────────────────────┘        │  Service Bus · Foundry │
                                    └────────────────────────┘

  infra/bicep — target Azure topology (Storage, Cosmos, Speech,
  AI Search, Document Intelligence, Key Vault, Service Bus,
  Container Apps, APIM, SWA) with private endpoints
```

- **`@studio/domain`** — the single source of truth for entities (Section 6 of
  the spec) and the workflow **state machine** (legal transitions, rejection
  edges, terminal states, stage mapping). Fully unit-tested.
- **`@studio/ssml`** — converts non-expert speech controls into
  standards-compliant SSML, adapting to each voice's declared capabilities and
  emitting warnings instead of failing. XML-injection-safe. Fully unit-tested.
- **`apps/api`** — the Fastify domain API. Workflow transitions and publication
  are **re-validated server-side** against the state machine and the actor's
  roles; the generic collection endpoint refuses to bypass those gates. All
  Azure access is keyless (user-assigned managed identity).
- **`apps/web`** — the reviewer-facing studio. State lives in a React context
  store seeded from `sample-data`; all workflow rules come from `@studio/domain`.

> **Note on the duplicated state machine:** `apps/api/src/workflow.ts` is a
> vendored mirror of `packages/domain/src/workflow.ts`, because the API's Docker
> build context is the `apps/api` folder alone and cannot resolve the workspace
> package. A test in `apps/api/src/workflow.test.ts` compares the two
> implementations across every state pair and role, so drift fails CI.

See [`docs/adr`](docs/adr) for the key architecture decisions and
[PLAN.md](PLAN.md) for milestones, risks, and status.

---

## Security & compliance posture

The design follows the spec's non-negotiables:

- **Managed identity + Entra ID everywhere.** No credentials in source, client
  bundles, or config. Infra grants least-privilege **RBAC data-plane roles** to a
  single user-assigned identity; local/key auth is disabled on Storage, Cosmos,
  Speech, Search, Document Intelligence, and Service Bus. See
  [ADR-0005](docs/adr/0005-managed-identity-and-no-secrets.md).
- **Private by default.** Storage, Cosmos, AI Search, Document Intelligence, and
  Key Vault have public network access disabled and are reachable only over
  private endpoints from the VNet-integrated Container Apps environment. Speech
  is the documented exception (see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).
- **Server-authoritative workflow gates.** Every transition and publication is
  re-validated against the state machine and the actor's roles by the API, which
  writes the canonical audit event. The generic collection endpoint refuses to
  change a project's `state` or overwrite a publication.
- **User identity.** The API validates **Microsoft Entra access tokens**
  (signature via tenant JWKS, issuer + audience) and derives id/name/roles from
  signed claims. A `header` shim exists for the local demo; it is insecure by
  design and the server **refuses to start** with it outside development unless
  explicitly acknowledged. See [docs/AUTH.md](docs/AUTH.md).
- **Human-gated publication.** Nothing publishes automatically; the Publish
  button requires an explicit confirmation summary and is idempotent.
- **External recipients require the Publisher role.** Recipient addresses are
  never exposed cross-recipient.
- **Immutable published artifacts.** Corrections create a new version.
- **Synthetic-media disclosure** is embedded in every publication.
- **Pronunciation entries are review candidates**, never authoritative.
- **Complete audit trail** with redacted detail — secrets never logged.
- **WCAG 2.2 AA**: keyboard-first, visible focus, skip link, status conveyed by
  icon + text (never color alone), reduced-motion support.

---

## Repository layout

```
apps/web/            React SPA (studio UI)
apps/api/            Fastify domain API (Azure Container Apps)
packages/domain/     Entities + workflow state machine (+ tests)
packages/ssml/       SSML projection engine (+ tests)
sample-data/         German HIV scripts + pronunciation seed
infra/bicep/         Azure infrastructure modules
infra/               Operational + smoke-test scripts (see infra/_env.ps1)
docs/adr/            Architecture Decision Records
docs/AUTH.md         Identity modes and how to turn on Entra sign-in
docs/CI-CD.md        Pipelines, Defender, and Azure Policy guardrails
spec/                The original product specification
PLAN.md              Milestones, risks, status
KNOWN_LIMITATIONS.md What is real vs. simulated, and why
```

> The scripts in `infra/` read their subscription, resource group, and endpoint
> coordinates from environment variables (see [infra/_env.ps1](infra/_env.ps1)).
> Copy `infra/_env.local.ps1.example` to `infra/_env.local.ps1` and fill in your
> own values — that file is git-ignored, and no tenant-specific identifiers are
> committed to this repository.

---

## License

MIT. Sample medical content is illustrative and **not medical advice**.
