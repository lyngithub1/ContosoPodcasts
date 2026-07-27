# Authentication & Authorization (Microsoft Entra ID)

The API enforces role-gated workflow transitions server-side today. Identity can
come from one of two sources, selected by the `AUTH_MODE` environment variable.

| Mode | `AUTH_MODE` | Identity source | Use |
| ---- | ----------- | --------------- | --- |
| Header shim | unset / `header` | `x-actor-id` / `x-actor-name` / `x-actor-roles` request headers | **Local demo only.** Headers are client-supplied and spoofable. |
| Entra | `entra` | Validated Microsoft Entra Bearer JWT (`oid`/`name`/`roles` claims) | Real auth. Signature + issuer + audience verified per request. |

**Status.** Both sides are implemented:

- **API** — [apps/api/src/auth.ts](../apps/api/src/auth.ts) validates the token and
  derives identity from signed claims.
- **SPA** — [apps/web/src/lib/auth.ts](../apps/web/src/lib/auth.ts) signs the user
  in with MSAL and [apiClient.ts](../apps/web/src/lib/apiClient.ts) attaches
  `Authorization: Bearer` to every request.

What remains is an **owner action**: creating the app registrations and setting
the environment variables below. Until they are set, the SPA falls back to the
demo role selector and the API runs in header mode.

**The header shim fails closed.** The API refuses to start in header mode unless
`NODE_ENV` is `development`/`test`, or you set `ALLOW_HEADER_AUTH=true` to
acknowledge running the unauthenticated demo. A half-configured
`AUTH_MODE=entra` (missing tenant or audience) throws at startup rather than
silently degrading to spoofable headers.

## 1. What the backend does (implemented)

When `AUTH_MODE=entra` **and** `AUTH_TENANT_ID` + `AUTH_AUDIENCE` are set,
[registerAuth](../apps/api/src/auth.ts) installs a Fastify `onRequest` hook that:

1. lets `OPTIONS` and public routes (`/healthz`, `/readyz`) through,
2. requires `Authorization: Bearer <jwt>` on every other route (else `401`),
3. verifies the JWT against the tenant JWKS
   (`https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys`) and checks
   the issuer (`.../v2.0`) and audience,
4. maps claims → `Actor` (`oid`→id, `name`/`preferred_username`→displayName,
   `roles`→`AppRole[]`) and attaches it to `req.actor`.

`getActor()` prefers `req.actor` and falls back to the header shim, so the
role-enforcement logic in the domain routes is unchanged. The `/healthz` payload
reports the active mode as `"auth": "entra" | "header"`.

If `AUTH_MODE=entra` but the tenant/audience are missing, `registerAuth` **throws
at startup**. A deployment that thinks it is secured must never quietly accept
client-supplied roles instead. This is covered by
[apps/api/src/auth.test.ts](../apps/api/src/auth.test.ts).

### Environment variables

| Var | Required for entra | Example |
| --- | ------------------ | ------- |
| `AUTH_MODE` | yes | `entra` |
| `AUTH_TENANT_ID` | yes | your directory (tenant) id |
| `AUTH_AUDIENCE` | yes | `api://podstudio-api` or the API app client id |
| `AUTH_ISSUER` | optional override | `https://login.microsoftonline.com/<tenant>/v2.0` |
| `ALLOW_HEADER_AUTH` | only to run the insecure demo outside dev | `true` |

## 2. App registration (owner action)

Create the API app registration and expose **app roles** whose values exactly
match the domain roles (`Creator`, `ScientificReviewer`, `MedicalLegalReviewer`,
`AudioReviewer`, `Publisher`, `Administrator`, `Auditor`). Entra emits assigned
app roles in the `roles` claim.

```bash
tenant="$(az account show --query tenantId -o tsv)"

# 1) API app registration + Application ID URI (the token audience).
apiAppId=$(az ad app create --display-name "podstudio-api" --sign-in-audience AzureADMyOrg --query appId -o tsv)
az ad app update --id "$apiAppId" --identifier-uris "api://podstudio-api"

# 2) Define app roles (repeat for each role, or supply an --app-roles JSON array).
#    Each role: { "displayName","value","description","allowedMemberTypes":["User"],"isEnabled":true,"id":<new-guid> }
#    Set 'value' to the AppRole name (e.g. "ScientificReviewer").
az ad app update --id "$apiAppId" --app-roles @app-roles.json

# 3) Assign users/groups to roles in the Enterprise Application:
#    Portal → Entra ID → Enterprise applications → podstudio-api → Users and groups → Add.
```

Then point the Container App at it (starts enforcing on the next revision):

```bash
az containerapp update -n "$CONTAINERAPP_NAME" -g "$RESOURCE_GROUP" --set-env-vars \
  AUTH_MODE=entra \
  AUTH_TENANT_ID="$tenant" \
  AUTH_AUDIENCE="api://podstudio-api"
```

Roll back to the demo by removing `AUTH_MODE` **and** setting
`ALLOW_HEADER_AUTH=true` (the server will otherwise refuse to start).

## 3. SPA sign-in with MSAL (implemented — needs an app registration)

The SPA already contains the full MSAL flow. It activates automatically once the
three Vite variables below are set at **build time**; with them unset it keeps
the demo role selector so the in-browser walkthrough still works.

1. Register a **SPA** app (or add a SPA redirect URI to the API app) with redirect
   URI = the Static Web App origin (e.g. `https://<your-swa>.azurestaticapps.net`),
   and grant it the API's exposed scope.
2. Set the build variables (see [apps/web/.env.example](../apps/web/.env.example)):

   | Var | Meaning |
   | --- | ------- |
   | `VITE_ENTRA_TENANT_ID` | directory (tenant) id |
   | `VITE_ENTRA_CLIENT_ID` | the SPA app registration's client id |
   | `VITE_ENTRA_API_SCOPE` | e.g. `api://podstudio-api/access_as_user` |
   | `VITE_ENTRA_REDIRECT_URI` | optional; defaults to the current origin |

3. Assign users to app roles in the Enterprise Application. The signed-in user's
   `roles` claim drives what the UI offers and what the API permits.

Once tokens are sent, the server derives id/name/roles from the token and the
`x-actor-*` headers are ignored — the role selector becomes a *view* of the
signed-in user's assigned roles rather than the identity itself.

> Note: these `VITE_*` values are **not secrets**. A SPA is a public client and
> holds no credential; every privileged decision is made server-side from the
> validated token.

## 4. Status summary

| Piece | State |
| ----- | ----- |
| Backend Entra JWT validation (hook, JWKS, issuer/audience, claim→role mapping) | ✅ implemented, typechecks/builds clean |
| Feature flag + fail-safe fallback + `/healthz` `auth` field | ✅ implemented |
| Header shim (demo) | ✅ unchanged, still default |
| App registration + app roles | 📝 documented (owner action) |
| SPA MSAL token acquisition | 📝 documented (owner action; not wired) |
| Live end-to-end validation in `entra` mode | ⬜ pending an app registration to test against |
