# 5. Managed identity and no secrets in source

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

The specification is explicit (§1): *"Use managed identity and Microsoft Entra
ID; do not put credentials in source code, client bundles, or configuration
files."* Security/compliance is a top-tier priority, and the workload handles
medical content and controlled distribution.

## Decision

**No secrets anywhere in source, client bundles, or config.** Concretely:

- The front end contains **no** connection strings, keys, or tokens. The mock
  backend removes any need for client-side credentials; a production SPA would
  use **MSAL** with Entra and call the API via a token, never holding service
  credentials.
- Infrastructure provisions **one user-assigned managed identity** and grants it
  least-privilege **RBAC data-plane roles**:
  - Storage → *Storage Blob Data Contributor*
  - Cosmos DB → built-in *Data Contributor* (data-plane role assignment)
  - Speech → *Cognitive Services User*
  - AI Search → *Search Index Data Contributor* + *Search Service Contributor*
  - Service Bus → *Azure Service Bus Data Owner*
  - Key Vault → *Key Vault Secrets User*
- **Local/key auth is disabled** on Storage (`allowSharedKeyAccess: false`),
  Cosmos (`disableLocalAuth: true`), Speech (`disableLocalAuth: true`), Search
  (`disableLocalAuth: true`), and Service Bus (`disableLocalAuth: true`).
- **Key Vault** (RBAC-authorized, purge protection on) holds only the secrets
  that genuinely cannot use managed identity (e.g. a third-party podcast-host API
  key). No secret values appear in templates or parameter files.
- Bicep **outputs contain no secrets** (endpoints and resource names only). The
  one unavoidable shared key — the Log Analytics key consumed by the Container
  Apps environment — is passed **module-to-module** as a `@secure()` parameter
  and never exposed as a deployment output.
- The audit trail stores **redacted** structured detail; tokens/secrets must
  never be written to it (enforced by the `AuditEvent.detail` contract).

## Consequences

- The security-critical requirement is satisfied by construction; there is no
  credential material to leak.
- Deployers must run under an identity able to create **RBAC role assignments**
  (Owner or User Access Administrator on the target scope).
- Because data services default to `publicNetworkAccess: 'Enabled'` for
  demo simplicity, production hardening (private endpoints/VNet) is required and
  is called out in [KNOWN_LIMITATIONS.md](../../KNOWN_LIMITATIONS.md).
