# @studio/api — Domain API

A small [Fastify](https://fastify.dev/) service that gives the SPA a real
backend: **Cosmos DB persistence**, **Azure AI Speech** text-to-speech, and an
optional **Microsoft Foundry** agent bridge. It authenticates to every Azure
service with a **user-assigned managed identity** (Entra ID) — there are no
secrets or connection strings in the app.

## Why it exists

The React app (`apps/web`) ships with an in-memory store seeded from
`sample-data`, so it runs offline for review. This service upgrades that
experience without changing the UX contract:

- On load, the SPA calls `GET /api/bootstrap` and **merges** any persisted
  records over its seed (by `id`). If the backend is unreachable, the SPA keeps
  working against the seed.
- Every mutation the SPA makes is **best-effort persisted** via
  `POST /api/collections/:key`. Failures are non-fatal and warned once.
- Audio **Play** buttons call `POST /api/speech/tts` to synthesize real neural
  audio. If the backend is unavailable, the SPA falls back to a browser voice
  preview (clearly labelled as simulated).

The service is intentionally **generic** over entities (`{ id, ... }`) so it has
no build dependency on `@studio/domain`; the SPA remains the source of the
domain types.

## Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET`  | `/healthz` | Liveness + which services are configured (`cosmos`, `speech`, `foundry`). |
| `GET`  | `/api/bootstrap` | Returns all known collections from Cosmos (`{ collections, persistence }`). Empty `{}` when Cosmos is not configured. |
| `POST` | `/api/collections/:key` | Upsert one item (requires a string `id`). `404` unknown key, `503` when persistence is off. |
| `POST` | `/api/speech/tts` | Synthesize audio from `{ ssml | text, voice?, locale?, format? }`. Returns an audio buffer. `503` when Speech is off. |
| `POST` | `/api/agents/:name/generate` | Run a Foundry agent with `{ prompt }`. Returns `501` until Foundry is configured. |

Collection keys map to Cosmos containers in [`src/cosmos.ts`](src/cosmos.ts)
(e.g. `projects → projects (/id)`, `passages → evidence (/projectId)`,
`deliveryReceipts → deliveryReceipts (/publicationId)`).

## Configuration (environment variables)

All are optional; each capability turns on only when its variables are present.

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `PORT` | `8080` | Container Apps ingress target. |
| `HOST` | `0.0.0.0` | |
| `CORS_ORIGINS` | (none) | Comma-separated allow-list, or `*` for any. |
| `AZURE_CLIENT_ID` | (none) | User-assigned managed identity client id. |
| `SPEECH_ENDPOINT` | (none) | Speech resource custom-domain endpoint. |
| `SPEECH_RESOURCE_ID` | (none) | Full ARM id of the Speech account (required for Entra TTS auth). |
| `SPEECH_DEFAULT_VOICE` | `de-DE-KatjaNeural` | Fallback voice. |
| `COSMOS_ENDPOINT` | (none) | Cosmos account endpoint. |
| `COSMOS_DATABASE` | `podcaststudio` | |
| `FOUNDRY_PROJECT_ENDPOINT` | (none) | Enables the agent bridge when set. |
| `FOUNDRY_API_VERSION` | `v1` | |

`SEARCH_ENDPOINT`, `SERVICEBUS_FQDN`, `KEYVAULT_URI`, and `STORAGE_BLOB_ENDPOINT`
are read for forward-compatibility but not yet used by request handlers.

## Authentication model

- `DefaultAzureCredential` — uses the managed identity in Azure (via
  `AZURE_CLIENT_ID`) and your developer identity locally (`az login`).
- **Speech TTS** uses an Entra bearer of the form
  `aad#{SPEECH_RESOURCE_ID}#{aadToken}` (token scope
  `https://cognitiveservices.azure.com/.default`), which requires the Speech
  resource to have a **custom domain**.
- **Cosmos** uses `aadCredentials` data-plane RBAC (no keys).
- **Foundry** uses the `https://ai.azure.com/.default` scope.

## Run locally

```powershell
# From the repo root
npm install
npm run dev:api        # tsx watch on http://localhost:8080

# Point the SPA at it
$env:VITE_API_BASE_URL = "http://localhost:8080"
npm run dev
```

With no Azure env vars set, `/healthz` reports all services `false`, `/api/bootstrap`
returns `{}`, and TTS returns `503` — the SPA then runs entirely against its seed.

## Build & container

```powershell
npm run build:api                     # tsc -> dist/
# Cloud build + push (no local Docker):
az acr build -r <registry> -t podstudio-api:v1 apps/api
```

The [`Dockerfile`](Dockerfile) build context is `apps/api` (self-contained). It
compiles TypeScript, prunes dev dependencies, runs as the non-root `node` user,
and listens on `8080`.
