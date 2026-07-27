# Infrastructure (Bicep)

Infrastructure-as-Code for the Azure Scientific Podcast Studio, matching the
target architecture in the spec (§5). Templates compile with `bicep build` and
provision a **least-privilege, managed-identity-only** topology.

## Topology

```
main.bicep (resource-group scope)
├── identity      user-assigned managed identity (used by everything)
├── monitoring    Log Analytics + Application Insights
├── keyvault      Key Vault (RBAC, purge protection)
├── storage       StorageV2 — 9 private containers, versioning, lifecycle
├── cosmos        Cosmos DB (serverless SQL API), local-auth disabled
├── speech        Azure AI Speech (Cognitive Services), key-auth disabled
├── search        Azure AI Search, key-auth disabled
├── servicebus    Namespace + job queues, local-auth disabled
├── containerapp  Container Apps env + API app (uses the managed identity)
├── apim          API Management façade → Container Apps backend
└── staticwebapp  Static Web App to host the SPA
```

RBAC data-plane roles are granted to the single managed identity; no keys or
connection strings are emitted as outputs. See
[ADR-0005](../../docs/adr/0005-managed-identity-and-no-secrets.md).

## Storage containers (spec §4.10)

`source-quarantine`, `source-approved`, `research-extracted`, `scripts`,
`synthesis-input`, `audio-preview`, `audio-approved`, `publication-assets`,
`audit-exports` — all `publicAccess: None`, with blob versioning, soft delete,
and lifecycle rules (quarantine expiry; audio-preview tiering).

## Parameters

Edit [`main.bicepparam`](main.bicepparam):

| Parameter | Default | Notes |
| --------- | ------- | ----- |
| `namePrefix` | `podstudio` | Short lowercase prefix for names. |
| `environment` | `dev` | `dev` \| `test` \| `prod` — drives SKUs/redundancy. |
| `apimPublisherEmail` / `apimPublisherName` | Contoso placeholders | Required by APIM. |
| `adminPrincipalId` | `''` | Optional Entra object id granted Key Vault admin. |
| `location` | resource-group location | Region for all resources. |

## Validate

```bash
az bicep build --file infra/bicep/main.bicep
```

## Deploy

> Requires permission to create **RBAC role assignments** at the target scope
> (Owner or User Access Administrator).

```bash
# 1. Create a resource group
az group create -n rg-podstudio-dev -l westeurope

# 2. What-if (preview changes)
az deployment group what-if \
  -g rg-podstudio-dev \
  -f infra/bicep/main.bicep \
  -p infra/bicep/main.bicepparam

# 3. Deploy
az deployment group create \
  -g rg-podstudio-dev \
  -f infra/bicep/main.bicep \
  -p infra/bicep/main.bicepparam
```

## Production hardening (not enabled by default)

For demo simplicity, data services use `publicNetworkAccess: 'Enabled'`.
Before production, switch these to `Disabled` and add **private endpoints /
VNet integration**, enable Microsoft Defender for Cloud, apply Azure Policy
guardrails, and substitute the API container image (currently a placeholder
quickstart image) via CI/CD.
