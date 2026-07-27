# Known Limitations

This reference implementation faithfully models the **product behavior,
workflow rules, speech-control fidelity, and security posture** of the
specification. It runs two ways:

- **In-browser mode** (no `VITE_API_BASE_URL`): the SPA runs entirely against
  its seeded in-memory store — every feature works, nothing is persisted, and
  audio uses the labeled browser-speech fallback.
- **Connected mode** (the live deployment): the SPA is built against the
  deployed Container Apps API, giving **real Cosmos DB persistence** and **real
  Azure AI Speech neural synthesis**.

Several other backend and operational capabilities remain **simulated** to keep
the reference focused. This document is the honest inventory of what is real,
what is mocked, and why.

## Live deployment

This reference has been deployed and validated end-to-end against a real Azure
subscription. Resource names, endpoints, and subscription/tenant identifiers are
deliberately **not** committed — configure your own via `infra/_env.local.ps1`
(see `infra/_env.local.ps1.example`) and the Bicep parameters in
[infra/bicep](infra/bicep).

What connected mode proved:

- **Persistence is real:** the API reads/writes a Cosmos DB account (SQL API,
  19 containers). The SPA hydrates from Cosmos on load and persists mutations
  through the API.
- **Workflow enforcement is server-side:** state transitions and publishing go
  through authoritative endpoints (`POST /api/projects/:id/transition` and
  `.../publish`) that re-validate the state-machine edge and the actor's roles,
  apply the quality gate (a critical pronunciation-QA mismatch blocks audio
  approval), and write the immutable audit event. The generic collection
  endpoint refuses to change a project's `state` or overwrite a publication, so
  the gates cannot be bypassed. All of this is covered by route tests in
  `apps/api/src/routes.test.ts`.
- **Private networking:** corporate Azure Policy force-disables Cosmos public
  network access. Cosmos is therefore reachable **only over a private endpoint**
  (group `Sql`) in a dedicated VNet, resolved through the
  `privatelink.documents.azure.com` private DNS zone. **Blob Storage, AI Search,
  Document Intelligence, and Key Vault are private too**, each with public
  network access disabled and its own private endpoint + DNS zone. The API runs
  in a **VNet-integrated Container Apps environment** so it can reach them.
- **Speech is real (both directions):** `POST /api/speech/tts` calls Azure AI
  Speech with managed-identity auth and streams back MP3 audio.
  `POST /api/projects/:id/synthesize` renders the whole approved script to a
  multi-voice preview and **stores the MP3 in Blob Storage** (`audio-preview`),
  and `POST /api/projects/:id/pronunciation-qa` **re-transcribes** that stored
  audio with the Speech fast-transcription API to drive closed-loop
  medical-pronunciation QA.
- **All service auth is keyless** — the API authenticates to Cosmos, Speech,
  Storage, Search, Document Intelligence, Service Bus, and Key Vault with a
  user-assigned managed identity; no connection strings or keys are used.

## Legend

- ✅ **Real** — production-quality logic in this repo.
- 🟡 **Simulated** — behaves correctly in the UI using in-memory data; no live
  service call.
- ⛔ **Not implemented** — described in the spec; would be built for production.

---

## Front end & domain

| Capability | Status | Notes |
| ---------- | ------ | ----- |
| Workflow state machine (transitions, gates, rejections, terminals, **role authorization**) | ✅ | `@studio/domain`, unit-tested (incl. per-edge role gating). Vendored into the API (`apps/api/src/workflow.ts`) because the API's Docker build context cannot resolve the private workspace package. A **drift-guard test** (`apps/api/src/workflow.test.ts`) compares the two implementations across every state pair × role × reason, so divergence fails CI. |
| Entity model (Section 6) | ✅ | `@studio/domain`. |
| SSML projection from friendly controls | ✅ | `@studio/ssml`, unit-tested, XML-safe. |
| Voice capability registry driving projection | ✅ | Seeded voices with per-feature capability flags. |
| Live SSML preview for a selected region | ✅ | Computed from the real projection engine. |
| Reviewer gating, audit trail, role switching | ✅ | Enforced **server-side**: every workflow transition and publish is re-validated against the state machine and the actor's roles by the deployed API (`POST /api/projects/:id/transition` and `.../publish`), which writes the canonical audit event. The generic collection endpoint refuses to change a project's `state` or overwrite a publication, so the gates cannot be bypassed. The client keeps an optimistic pre-check for UX. |
| Persistence | ✅ (connected) / 🟡 (in-browser) | Connected mode reads/writes Cosmos DB through the API and survives refresh. In-browser mode uses the in-memory store and resets on refresh. |
| Authentication (MSAL/Entra), app roles | ✅ (code) / ⚠️ (needs app registration) | Two identity modes selected by `AUTH_MODE`. **`entra`**: the API validates a Microsoft Entra Bearer JWT per request (signature via tenant JWKS, issuer + audience checks) and derives id/name/roles from verified `oid`/`name`/`roles` claims (`apps/api/src/auth.ts`); the SPA acquires tokens with **MSAL** (`apps/web/src/lib/auth.ts`) and sends `Authorization: Bearer` on every call. **`header`** (local demo only): role selector + `x-actor-*` request headers — enforcement is real, identity is not verified. This mode now **fails closed**: the API refuses to start in header mode unless `NODE_ENV` is development/test or `ALLOW_HEADER_AUTH=true` is set explicitly, and a half-configured `AUTH_MODE=entra` throws instead of silently degrading (covered by `apps/api/src/auth.test.ts`). **Still an owner action:** create the app registrations with app roles matching the domain roles and set `AUTH_TENANT_ID`/`AUTH_AUDIENCE` + `VITE_ENTRA_*`. See [docs/AUTH.md](docs/AUTH.md). |

## AI, research & speech

| Capability | Status | Notes |
| ---------- | ------ | ----- |
| Research acquisition / retrieval (AI Search, Document Intelligence) | ✅ (connected) / 🟡 (seeded) | Connected mode is real: `POST /api/projects/:id/extract-source` uploads a document (PDF/HTML/image/office) to Blob Storage, extracts its text with **Azure AI Document Intelligence** (`prebuilt-read`), stores the extracted text in `research-extracted`, records a `source`, and indexes it into **Azure AI Search**. `POST /api/projects/:id/index-evidence` (re)indexes the project's sources + structured-evidence brief + non-excluded claims into the `research-index`, and `GET /api/projects/:id/search?q=` retrieves the most relevant grounding units (semantic ranker, falling back to keyword). Both services use AAD/managed-identity only (Search has `disableLocalAuth: true`; Document Intelligence uses a custom subdomain). Retrieval is **not yet fed into** the Foundry script prompt automatically, and the SPA still uses seeded evidence for in-browser mode. |
| Script generation (Foundry agent) | ✅ (connected) / 🟡 (in-browser) | Connected mode generates a **grounded** script by calling the deployed Foundry prompt agent `podcast-script-generator` (Responses API) through `POST /api/projects/:id/generate-script`. It is grounded in the project's accepted structured evidence + non-excluded claims (**refuses with 422** when neither exists), forces a synthetic-media disclosure as the first segment, and the model's claim citations are **server-validated** against the accepted claim-id set before they are stored. Requires the Creator/Administrator role and preserves the one-script-per-project invariant (bumps the version). In-browser mode uses the seeded sample script. The agent runs in a separate Foundry resource (configured via `FOUNDRY_PROJECT_ENDPOINT`); the platform managed identity holds `Cognitive Services User` + `Azure AI Developer` on it. |
| Import a finished script (upload / paste) | ✅ | The "Create a project" screen has an **Upload a script** mode: the author uploads a file (`.txt/.md/.html` parse in-browser; `.pdf/.docx/images` are extracted server-side via `POST /api/extract-text` → **Azure AI Document Intelligence** `prebuilt-read`, Creator-gated, no persistence) or pastes text. A **deterministic, non-AI** parser (`apps/web/src/lib/scriptImport.ts`) auto-detects the three authoring shapes (plain narration, structured narration with `[bracketed]` cues, Host/Expert dialogue), splits multi-version documents so the author picks one, and builds a `ScriptVersion` (speakers + segments). The project is created directly in **`SCRIPT_DRAFT`** (research + evidence stages skipped) with the script **unapproved and ungrounded** — claims are not mapped to evidence, and the UI + the `script.imported` audit event say so, so reviewers must validate accuracy before approval. The heuristic parse is best-effort (labeled as such); it does not verify factual grounding. |
| Text-to-speech synthesis | ✅ (connected) / 🟡 (in-browser) | Connected mode calls Azure AI Speech and returns real MP3 audio. `POST /api/projects/:id/synthesize` renders the approved script to a multi-voice preview (per-speaker `<voice>` SSML) and stores the MP3 in Blob Storage; `GET /api/projects/:id/audio` streams it back from the private blob. In-browser mode uses the labeled browser-speech fallback (no audio file). |
| Closed-loop pronunciation QA (STT re-transcription) | ✅ (connected) / 🟡 (in-browser) | Connected mode runs a **real synth → transcribe round trip**: `POST /api/projects/:id/pronunciation-qa` downloads the stored preview, re-transcribes it with the Azure AI Speech **fast-transcription** API, and compares each expected medical term (from the project's evidence pronunciation candidates + the locale's golden-set lexicon entries) against what the recognizer actually heard using a Levenshtein-scored best-window match. A critical mismatch sets `hasBlockingIssues`, which the transition endpoint enforces as a **hard gate** on audio approval. **Audio-level DSP checks** (loudness/LUFS, true-peak, clipping) are **not** measured — those fields are reported as `0`/neutral and labeled as such in the UI. In-browser mode uses a seeded report to demonstrate the blocking + override flow. |
| Custom lexicon / PLS upload | ⛔ | Modeled in the data (`supportedSsml.lexicon`); no upload endpoint. |

## Backend, data & operations

| Capability | Status | Notes |
| ---------- | ------ | ----- |
| Domain APIs (Functions/Container Apps) | ✅ | Fastify API deployed to Azure Container Apps; exposes generic collection CRUD, **authoritative workflow transition + publish endpoints**, and speech synthesis. |
| Cosmos DB persistence wiring | ✅ | API reads/writes all 19 containers over the private endpoint; SPA hydrates and persists through it. |
| Durable orchestration for long-running gated jobs | 🟡 | Workflow rules live in `@studio/domain`. Background jobs run on **Service Bus queues drained by an in-process worker** (`apps/api/src/worker.ts`) — honest queue-based processing, **not** a Durable Functions / workflow-host runtime. The `SynthesisJob` document is the durable record of progress. |
| Blob Storage wiring | ✅ (connected) | Rendered audio previews and their transcripts are uploaded to and streamed from Blob Storage (`audio-preview`) over a private endpoint with managed-identity auth. Promotion of `audio-preview` → `audio-approved` on publish is modeled but not yet wired. |
| Service Bus wiring | ✅ (connected) | `POST /synthesize-async` enqueues to `synthesis-jobs`; a background worker renders the episode, marks the job `succeeded`/`failed`, then chains a `qa-jobs` message that runs closed-loop pronunciation QA. Auth is managed-identity (no SAS keys). Synchronous `/synthesize` + `/pronunciation-qa` routes remain and share the exact same `audioPipeline` core. `delivery-jobs` is provisioned but not yet driven. Scaling: `minReplicas=1` keeps the worker alive; production would add a KEDA Service Bus queue-length scale rule. |
| Event Grid / Service Bus job events | 🟡 | `synthesis-jobs` + `qa-jobs` are driven by application code; `delivery-jobs` and Event Grid are provisioned in IaC only. |
| Secure-email / webhook delivery adapters | 🟡 | Publishing is server-side: the API creates the **immutable** publication + per-recipient receipts in Cosmos and flips the project to `PUBLISHED`; no real email/webhook is sent. |
| Malware scanning of uploads / quarantine promotion | ⛔ | `source-quarantine` container + lifecycle rule exist in IaC. |
| CI/CD, `azd` packaging, Defender for Cloud, Azure Policy | ✅ (artifacts) / 🟡 (not yet run) | GitHub Actions **CI** (`.github/workflows/ci.yml` — typecheck/test/build, validated green locally) and **Deploy** (`.github/workflows/deploy.yml` — OIDC → `az acr build` → Container App roll → health-gate → SWA publish) workflows added, plus an `azure.yaml` for the `azd` path. Defender for Cloud plan enablement and Azure Policy guardrails are **documented (not enabled — billed/owner action)**. The live deploy was still done imperatively via `az`; the pipelines need the owner to create the OIDC federated credential + repo secrets before they can run. See [docs/CI-CD.md](docs/CI-CD.md). |

## Infrastructure (Bicep)

| Item | Status | Notes |
| ---- | ------ | ----- |
| Storage (9 containers, versioning, lifecycle, no public access, no shared key, **private endpoint** for blob) | ✅ in Bicep | `modules/storage.bicep` + `modules/privateEndpoint.bicep`; blob reachable only over `privatelink.blob.core.windows.net`. |
| Cosmos DB (serverless, local-auth disabled, data-plane RBAC, **private endpoint**) | ✅ in Bicep | Public access disabled (policy-enforced); `modules/network.bicep` + `modules/cosmos.bicep` wire the VNet, private endpoint, and DNS. |
| AI Search (key auth disabled / AAD-only, **private endpoint**) | ✅ in Bicep | Driven by app code (extract → index → semantic retrieve) over managed identity; `disableLocalAuth: true`. Public access disabled; reachable only over `privatelink.search.windows.net`. Live-validated through the in-VNet API. |
| Speech (key auth disabled, RBAC) | ✅ in Bicep / ⚠️ public+RBAC | Speech is live (TTS + STT). A private endpoint was **attempted and reverted**: with the Speech account and the PE/VNet in different regions, TTS returned `403 "Traffic is not from an approved private endpoint"` over the cross-region `account` PE (Search + Document Intelligence worked cross-region; Speech's TTS/STT data plane did not). Speech therefore keeps **public network access with AAD/RBAC (no keys)**. Production fix: co-locate Speech + VNet + PE in one region, then reuse the shared `privatelink.cognitiveservices.azure.com` zone. |
| Document Intelligence (`prebuilt-read`, custom subdomain, RBAC, **private endpoint**) | ✅ in Bicep | `modules/docintel.bicep` (kind FormRecognizer, S0). MI holds `Cognitive Services User`. Public access disabled; reachable only over `privatelink.cognitiveservices.azure.com`. Live-validated. |
| Key Vault (RBAC, purge protection, **private endpoint**) | ✅ in Bicep | Public access disabled; private endpoint on `privatelink.vaultcore.azure.net`. Not consumed by the API at runtime yet (config carries `KEYVAULT_URI` but no secret reads). |
| Service Bus, Container Apps, API Management, Static Web App | ✅ in Bicep | Container App is VNet-integrated; SWA + APIM provisioned. Service Bus is **not** behind a private endpoint. |
| **Deployment validation** (what-if against a live subscription) | 🟡 | Core stack is deployed and verified end-to-end, and `az bicep build` is green. A full-stack `what-if` in CI has not been run. |
| Container image for the API | ✅ | Real image built with `az acr build` and deployed to the Container App. |

---

## Deliberate simplifications

- **Cosmos DB, Blob Storage, AI Search, Document Intelligence, and Key Vault use
  private endpoints** (public network access disabled; reachable only from the
  VNet), and all of them are now **codified in Bicep**
  (`modules/privateEndpoint.bicep` + the private DNS zones in
  `modules/network.bicep`). Set `usePrivateEndpoints: false` for a public
  sandbox. **Speech is the one exception** — it keeps public network access with
  AAD/RBAC because its TTS/STT data plane rejected a cross-region private
  endpoint; co-locating it with the VNet in one region is the production fix.
- **Region split:** compute, the VNet, Cosmos, and every privately-reachable
  service share `computeLocation` (needed for the private endpoints to bind);
  Speech defaults to `location` (chosen to match the German sample content and
  voice availability).
- **Connected mode persists** across refreshes via Cosmos. **In-browser mode**
  (no API URL) is a stateless demo whose state resets on refresh.
- **In-browser mode makes no network calls**, so it is safe to run offline and
  cannot leak data. Connected mode calls only the deployed API (CORS-restricted).
- **Server-side workflow enforcement is live**, and the workflow module is
  duplicated into the API (`apps/api/src/workflow.ts`) because its Docker build
  context cannot resolve the private `@studio/domain` workspace package. A
  drift-guard test keeps the two copies honest.
- **Identity fails closed.** `AUTH_MODE=entra` validates real Entra tokens on the
  API and the SPA acquires them with MSAL. The `header` shim remains for the
  local demo, but the API refuses to start with it outside development unless
  `ALLOW_HEADER_AUTH=true` is set explicitly. What is still missing is purely an
  owner action: the app registrations themselves (see [docs/AUTH.md](docs/AUTH.md)).
- **No API rate limiting.** The Container App has a public FQDN and APIM is
  provisioned as the intended façade, but the API itself does not throttle;
  expensive endpoints (Speech synthesis, Foundry generation) would need
  `@fastify/rate-limit` or APIM policies before real exposure.
- **Request bodies are not schema-validated.** A 5 MB `bodyLimit` is set and the
  domain routes validate the fields they use, but the generic collection endpoint
  defers structural validation to Cosmos.

---

## What we would build next (production path)

1. **Finish Entra sign-in.** Both sides are implemented: the API validates Entra
   JWTs (`AUTH_MODE=entra`, `apps/api/src/auth.ts`) and fails closed when
   half-configured, and the SPA acquires tokens with MSAL
   (`apps/web/src/lib/auth.ts`). What remains is an owner action: create the app
   registrations with app roles matching the domain roles, then set
   `AUTH_TENANT_ID`/`AUTH_AUDIENCE` and `VITE_ENTRA_*`. See
   [docs/AUTH.md](docs/AUTH.md).
2. **Add rate limiting** (`@fastify/rate-limit` and/or APIM policies) and JSON
   schema validation on the write paths before exposing the API publicly.
3. Durable Functions (or an equivalent workflow host) for synthesis/QA/delivery
   orchestration with idempotent, retriable, gated steps. Today the async path is
   **Service Bus queues drained by an in-process worker** (`synthesize-async` →
   `synthesis-jobs` → chained `qa-jobs`); a production build would add KEDA
   queue-length scaling and a first-class orchestration runtime.
4. Feed **AI Search retrieval into the Foundry script prompt** (retrieval-augmented
   grounding). The extract → index → semantic-retrieve pipeline (Document
   Intelligence + AI Search) is already live behind `/extract-source`,
   `/index-evidence`, and `/search`; the Speech TTS, **audio-render**,
   **closed-loop STT QA**, and Foundry script-generation adapters are live too.
   The remaining step is to pass retrieved passages into the script generator and
   surface source ingestion + retrieval in the SPA (still seeded in-browser).
5. Real audio **mastering/DSP** stage (loudness/LUFS, true-peak, clipping
   measurement) so `QualityReport.audioChecks` and `AudioVersion.loudnessLufs`
   reflect measured values instead of the current neutral placeholders.
6. CI/CD with `azd`, plus Defender for Cloud and Azure Policy guardrails. **The
   GitHub Actions workflows (`ci.yml`, `deploy.yml`) and `azure.yaml` now exist,
   and Defender/Policy setup is documented** ([docs/CI-CD.md](docs/CI-CD.md)); the
   pipelines still need the owner to wire the OIDC federated credential + repo
   secrets, and the plans/policies are documented rather than enabled.
7. **Co-locate Speech with the VNet in one region** so it too can sit behind a
   private endpoint (its cross-region PE was reverted). Every other data service
   is already private and codified in Bicep.
