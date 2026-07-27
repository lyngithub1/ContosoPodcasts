# Delivery Plan — Azure Scientific Podcast Studio

This plan tracks how the reference implementation maps to the specification, the
milestones delivered here, the risks that shaped scope decisions, and what a
production team would build next.

## Guiding priority order (from the spec)

> Speech quality & medical pronunciation → factual grounding → reviewer control
> → security/compliance → usability → speed → cost

Every scope decision below was made in that order. Where something had to be cut
for a runnable reference, we preserved the **higher-priority** behaviors (typed
workflow correctness, SSML fidelity, reviewer gating, security posture) and
simulated the **lower-priority** operational plumbing.

---

## Milestones

| # | Milestone | Outcome | Status |
| - | --------- | ------- | ------ |
| M1 | Monorepo scaffold (npm workspaces, TS project refs, Vite) | Reproducible build/test/typecheck | ✅ Done |
| M2 | Domain model + workflow state machine (+ tests) | Single source of truth | ✅ Done |
| M3 | SSML projection engine (+ tests) | Friendly controls → standards SSML | ✅ Done |
| M4 | Sample medical content | 3 German HIV scripts + 10 pronunciation seeds | ✅ Done |
| M5 | SPA shell, design tokens, store, routing | Accessible Azure-styled shell | ✅ Done |
| M6 | Full workflow stage screens + management pages | 15-step MVP flow is walkable | ✅ Done |
| M7 | Azure infrastructure (Bicep) | Compiles; least-privilege RBAC; private endpoints | ✅ Done |
| M8 | Documentation (README, ADRs, limitations, plan) | This set | ✅ Done |
| M9 | Validation (typecheck, test, build) | All green | ✅ Done |
| M10 | Domain API + orchestration | Fastify API on Container Apps; authoritative transition/publish endpoints; Service Bus queues + in-process worker | ✅ Done (Durable-host substitute — see M14) |
| M11 | Live Azure integration | Cosmos persistence, Speech TTS + fast transcription, Blob storage, AI Search, Document Intelligence, Foundry script generation — all keyless | ✅ Done |
| M12 | Entra sign-in end-to-end | API validates Entra JWTs and fails closed; SPA acquires tokens with MSAL | ✅ Code complete — needs an app registration (owner action) |
| M13 | API + route test coverage | Workflow parity guard, gate-bypass, quality gate, publish preconditions, fail-closed auth | ✅ Done |
| M14 | Durable orchestration host | Replace the in-process worker with Durable Functions (or equivalent) + KEDA queue scaling | ⛔ Not started |
| M15 | CI/CD execution + Defender/Policy guardrails | Workflows and `azure.yaml` exist; pipelines need OIDC credential + repo secrets; Defender/Policy documented, not enabled | 🟡 Artifacts ready, not run |
| M16 | Retrieval-augmented script generation | Feed AI Search results into the Foundry script prompt | ⛔ Not started |
| M17 | Audio mastering / DSP | Measure loudness (LUFS), true-peak, clipping | ⛔ Not started |

The MVP acceptance flow (spec §"MVP") — sign-in through audit inspection — is
demonstrable end-to-end both in-browser and against the deployed API.

---

## Risks & mitigations

| Risk | Impact | Decision / mitigation |
| ---- | ------ | --------------------- |
| **UI component library churn** (Fluent version/build friction) | Blocks a runnable demo | Ship **custom design tokens** that honor the Azure aesthetic and WCAG 2.2 AA. See [ADR-0003](docs/adr/0003-custom-design-tokens-over-fluent-ui.md). |
| **Cloud dependency for a reviewable demo** | Can't evaluate UX without a subscription | **In-browser mock backend** seeded from sample data; real domain + SSML logic underneath. See [ADR-0004](docs/adr/0004-in-browser-mock-backend.md). |
| **Secret sprawl** | Security-critical per spec §1 | Managed identity + RBAC only; local auth disabled; secrets (if any) → Key Vault. See [ADR-0005](docs/adr/0005-managed-identity-and-no-secrets.md). |
| **Pronunciation errors in medical terms** | Highest-priority quality risk | Closed-loop QA (STT re-transcription) with **blocking** critical-term mismatches and explicit reviewer override + reason. Modeled and demonstrated in Audio review. |
| **Auto-publish / data leakage** | Compliance breach | Publication is explicit, idempotent, receipted; external recipients gated on Publisher role; addresses never exposed cross-recipient. |
| **Voice capability drift** | SSML that a voice can't honor | Capability registry drives projection; unsupported features degrade with warnings rather than failing. |

---

## Testing strategy

- **Unit** (implemented): workflow transitions/rejections/terminals and per-edge
  role gating; SSML projection incl. phoneme fallback, break clamping,
  overlap/out-of-range detection, and XML-injection resistance.
- **Route/integration** (implemented, `apps/api/src/routes.test.ts`): the
  authoritative transition and publish endpoints against an in-memory Cosmos
  stand-in — illegal edges (422), insufficient role (403), missing rejection
  reason (422), the blocking pronunciation-QA quality gate (409), publish
  preconditions, and the guards that stop the generic collection endpoint from
  bypassing those gates.
- **Drift guard** (implemented, `apps/api/src/workflow.test.ts`): the API's
  vendored state machine is compared against `@studio/domain` across every state
  pair × role × reason combination, so the two copies cannot silently diverge.
- **Auth fail-closed** (implemented, `apps/api/src/auth.test.ts`): a
  half-configured `AUTH_MODE=entra` must refuse to start rather than fall back to
  the spoofable header shim.
- **Contract** (planned): speech, research, storage, and distribution adapters
  against recorded fixtures.
- **E2E** (planned): golden-path walkthrough via Playwright.
- **Failure-injection** (planned): partial synthesis, storage timeout, failed
  delivery retry/idempotency.

---

## Definition of done for this reference

- `npm run typecheck`, `npm test`, and `npm run build` all pass. ✅
- `az bicep build infra/bicep/main.bicep` compiles. ✅
- The 15-step MVP flow is walkable in the SPA. ✅
- Workflow gates are enforced **server-side** and covered by route tests. ✅
- Security non-negotiables are honored in code and IaC. ✅
- No subscription, tenant, or resource identifiers are committed. ✅
- Every deviation from the spec is documented in
  [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). ✅

---

## Remaining owner actions

These need directory or billing rights that the repository itself cannot grant:

1. **Create the Entra app registrations** (API + SPA) with app roles matching the
   domain roles, then set `AUTH_MODE=entra`, `AUTH_TENANT_ID`, `AUTH_AUDIENCE` on
   the Container App and `VITE_ENTRA_*` on the SPA build. The code on both sides
   is complete — see [docs/AUTH.md](docs/AUTH.md).
2. **Create the GitHub OIDC federated credential + repo secrets** so `ci.yml` and
   `deploy.yml` can run — see [docs/CI-CD.md](docs/CI-CD.md).
3. **Enable Defender for Cloud plans and assign Azure Policy initiatives**
   (billed / subscription-scope actions).
4. **Co-locate Azure AI Speech with the VNet** in a single region so it can also
   sit behind a private endpoint.
