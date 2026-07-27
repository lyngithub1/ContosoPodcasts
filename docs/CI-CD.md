# CI/CD, Defender for Cloud & Azure Policy

This document describes the delivery pipeline for the Azure Scientific Podcast
Studio and the security guardrails that should wrap it. It is written to the
**honesty principle**: everything that is *provided as runnable artifacts* is
called out separately from everything that *still requires an owner action*
(pushing to a repo, creating credentials, enabling paid plans).

## 1. Pipelines (provided)

| Workflow | File | Trigger | What it does |
| -------- | ---- | ------- | ------------ |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | PR + push to `main` | `npm ci`, `npm run typecheck`, `npm test` (domain + ssml), `npm run build`, `npm run build:api`. No cloud access. |
| Deploy | [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) | manual + push to `main` touching `apps/**`, `packages/**`, `infra/**` | OIDC login → `az acr build` the API image → `az containerapp update` → health-gate → build the SPA with the API URL baked in → publish to Static Web Apps. |

Both mirror the manual loop that has been validated against the live environment.

### Alternative: `azd`

[azure.yaml](../azure.yaml) maps the `api` (Container App) and `web` (Static Web
App) services onto the Bicep in `infra/bicep`, so `azd up` / `azd deploy` is an
alternative to the imperative workflow. See the honesty note in that file: the
Bicep does not yet include Document Intelligence or the private endpoints added
in the latest iteration, so a clean `azd provision` currently stands up a
slightly reduced stack.

## 2. Secretless Azure sign-in (owner action required)

The Deploy workflow uses **Microsoft Entra Workload Identity Federation (OIDC)** —
no client secret or publish profile is stored in GitHub. To enable it, the
repository owner runs (values for this environment shown):

```bash
# App registration (or reuse the platform managed identity's app) used by GitHub.
appId=$(az ad app create --display-name "gh-contosopodcasts" --query appId -o tsv)
az ad sp create --id "$appId"

# Federated credential: trust GitHub Actions on the main branch of this repo.
az ad app federated-credential create --id "$appId" --parameters '{
  "name": "gh-contosopodcasts-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<OWNER>/<REPO>:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'

# Least-privilege roles for the deploy identity.
spId=$(az ad sp show --id "$appId" --query id -o tsv)
acrId=$(az acr show -n "$ACR_NAME" --query id -o tsv)
caId=$(az containerapp show -n "$CONTAINERAPP_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)
az role assignment create --assignee-object-id "$spId" --assignee-principal-type ServicePrincipal --role AcrPush --scope "$acrId"
az role assignment create --assignee-object-id "$spId" --assignee-principal-type ServicePrincipal --role Contributor --scope "$caId"
```

Then set, in **Settings → Secrets and variables → Actions**:

- **Secrets:** `AZURE_CLIENT_ID` (= `$appId`), `AZURE_TENANT_ID`,
  `AZURE_SUBSCRIPTION_ID`, `SWA_DEPLOYMENT_TOKEN`.
- **Variables:** `AZURE_RESOURCE_GROUP`, `ACR_NAME`, `CONTAINERAPP_NAME`,
  `API_BASE_URL` (the APIM façade URL, e.g.
  `https://<apim-name>.azure-api.net/studio`).

> Fill these in from **your** environment — no subscription, tenant, or resource
> identifiers are committed to this repository.

> These commands and the credential itself are **not** created by this repo — they
> require an owner with directory + RBAC rights.

## 3. Microsoft Defender for Cloud (owner action required)

Defender plans are billed, so they are documented rather than enabled here. Turn
on the plans relevant to this workload:

```bash
sub="$(az account show --query id -o tsv)"
# CSPM is free; the workload plans below are paid.
az security pricing create -n CloudPosture     --tier Standard   # Defender CSPM
az security pricing create -n Containers        --tier Standard   # ACR + Container Apps/AKS
az security pricing create -n StorageAccounts   --tier Standard   # malware/anomaly on Blob
az security pricing create -n KeyVaults         --tier Standard
az security pricing create -n CosmosDbs         --tier Standard
az security pricing create -n Api               --tier Standard   # API Management
```

Recommended follow-ups: enable **agentless container vulnerability assessment**
(so the `podstudio-api` image is scanned in ACR), turn on **auto-provisioning**
of the Log Analytics agent, and route Defender alerts to the existing App
Insights / Log Analytics workspace.

## 4. Azure Policy guardrails (owner action required)

Assign built-in initiatives + policies at the resource-group (or subscription)
scope so drift from the intended posture is caught. The environment already
satisfies most of these (managed identity, disabled local/key auth, private
endpoints on Cosmos/Blob/Search/Document Intelligence/Key Vault); policy makes
them enforceable.

```bash
rg="/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP"

# Microsoft Cloud Security Benchmark (broad baseline).
az policy assignment create --name mcsb --display-name "Microsoft cloud security benchmark" \
  --policy-set-definition "1f3afdf9-d0c9-4c3d-847f-89da613e70a8" --scope "$rg"

# Targeted deny/audit policies that match this design's intent.
# - Cognitive Services should disable public network access
az policy assignment create --name deny-cs-public --scope "$rg" \
  --policy "0725b4dd-7e76-479c-a735-68e7ee23d5ca" --params '{"effect":{"value":"Audit"}}'
# - Storage accounts should use private link
az policy assignment create --name audit-storage-pe --scope "$rg" \
  --policy "6edd7eda-6dd8-40f7-810d-67160c639cd9"
# - Key Vault should use private link
az policy assignment create --name audit-kv-pe --scope "$rg" \
  --policy "5f0bc445-3935-4915-9981-011aa2b46147"
```

> Policy GUIDs are Azure built-ins; verify current definition IDs with
> `az policy definition list` / `az policy set-definition list` before assigning,
> as built-ins are periodically versioned.

## 5. Status summary

| Piece | State |
| ----- | ----- |
| CI workflow (build/test) | ✅ provided, runnable as-is |
| Deploy workflow (OIDC → ACR → Container App → SWA) | ✅ provided; needs the owner to create the federated credential + secrets/vars |
| `azure.yaml` for azd | ✅ provided; Bicep needs Document Intelligence + private endpoints back-ported for a full `azd provision` |
| Defender for Cloud plans | 📝 documented (billed; owner enables) |
| Azure Policy guardrails | 📝 documented (owner assigns) |
