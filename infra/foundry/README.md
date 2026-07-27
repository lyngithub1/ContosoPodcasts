# Medical Research Podcast Studio — Foundry Prompt Agents

This folder provisions the studio's AI‑assisted production steps as **prompt agents** in an
Azure AI **Foundry** project, so they surface in the Foundry portal (the "nextgen" UI at
`ai.azure.com`) agent catalog. This gives customers a hands‑on **Playground** path for each
step of the research‑to‑podcast workflow.

> Prompt agents = model + instructions (no custom container/code). They are created through the
> Foundry Agents data‑plane API and are versioned immutably on each update.

## Where they live

The agents are provisioned into **your own** Foundry project — nothing here is tied to a
particular subscription. Configure the coordinates once in `infra/_env.local.ps1`
(copy `infra/_env.local.ps1.example`), or export the environment variables directly:

| Property | Setting | Example |
|----------|---------|---------|
| Foundry account | `PODSTUDIO_FOUNDRY_ACCOUNT` | `<your-foundry-account>` |
| Resource group | `PODSTUDIO_FOUNDRY_RESOURCE_GROUP` | `<your-foundry-rg>` |
| Foundry project | *(part of the endpoint)* | `<your-project>` |
| Project endpoint | `PODSTUDIO_FOUNDRY_PROJECT_ENDPOINT` | `https://<account>.services.ai.azure.com/api/projects/<project>` |
| Model deployment | `-Model` parameter | `gpt-4.1` |
| API | — | Agents data plane, `api-version=v1`, token audience `https://ai.azure.com` |

> The main podcast‑studio infrastructure (`infra/bicep`) does **not** include a Foundry project.
> These agents intentionally reuse an existing medical‑themed Foundry project for a fast demo path.

## The agents (mapped to the workflow)

| Agent | Stage | Model | Temp | Purpose |
|-------|-------|-------|------|---------|
| `research-summarizer` | Research | gpt-4.1 | 0.2 | Faithful, source‑attributed summaries of peer‑reviewed research. |
| `evidence-extractor` | Evidence | gpt-4.1 | 0.1 | Structured, auditable JSON evidence (design, population, outcomes, claims, limitations). |
| `podcast-script-generator` | Script | gpt-4.1 | 0.6 | Two‑host, accessible script with mandatory synthetic‑media disclosure. |
| `script-fact-evaluator` | Review | gpt-4.1 | 0.1 | Structured pass/revise/fail verdict of a script against its evidence + policy. |
| `pronunciation-ssml-assistant` | Speech | gpt-4.1 | 0.2 | Review‑**candidate** pronunciations + SSML for difficult medical terms/names. |

Governance baked into the instructions mirrors the studio's rules: evidence‑grounded (no
fabrication), association‑vs‑causation discipline, up‑front AI/synthetic‑media disclosure, no
medical advice, and pronunciation suggestions treated as human‑review candidates (never authoritative).

## Open in the Foundry portal (nextgen UI)

`provision-agents.ps1` prints a deep link for each agent it creates. The shape is:

```
https://ai.azure.com/nextgen/r/<url-safe-base64-subscription-id>,<resource-group>,,<account>,<project>/build/agents/<agent-name>/build?version=1
```

Easiest path: open the project in the portal and pick the agents from the **Agents** list.

## (Re)provision

Idempotent — re‑running updates the agents (creating a new version) instead of duplicating them:

```powershell
./provision-agents.ps1
# optional overrides:
./provision-agents.ps1 -Model clinical-gpt4o -ProjectEndpoint "https://<account>.services.ai.azure.com/api/projects/<project>"
```

### Prerequisites

- `az login` as a principal with a role granting the data action
  `Microsoft.CognitiveServices/accounts/AIServices/agents/*` on the Foundry account
  (e.g. **Cognitive Services User**, which grants `Microsoft.CognitiveServices/*`).
- Python (only used to compute the portal link's URL‑safe base64 subscription id, not required to provision).

> Note: the Azure MCP tools authenticate with a separate, isolated identity from the Azure CLI.
> This script deliberately uses the **Azure CLI** identity via `az account get-access-token`.

## Verify

```powershell
$tok = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv
$ep  = $env:PODSTUDIO_FOUNDRY_PROJECT_ENDPOINT
(Invoke-RestMethod "$ep/agents?api-version=v1" -Headers @{Authorization="Bearer $tok"}).data |
  Select-Object name,state,@{n='model';e={$_.versions.latest.definition.model}}
```

## Remove (if needed)

```powershell
$tok = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv
$ep  = $env:PODSTUDIO_FOUNDRY_PROJECT_ENDPOINT
foreach ($n in 'research-summarizer','evidence-extractor','podcast-script-generator','script-fact-evaluator','pronunciation-ssml-assistant') {
  Invoke-WebRequest "$ep/agents/$n?api-version=v1" -Headers @{Authorization="Bearer $tok"} -Method DELETE -UseBasicParsing
}
```
