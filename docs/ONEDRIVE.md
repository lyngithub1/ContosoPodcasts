# Publishing episodes to OneDrive / SharePoint

The publish step supports a **`onedrive`** delivery channel that writes an
approved episode into a OneDrive or SharePoint folder via Microsoft Graph.

Unlike the other channels, this one is a **real delivery adapter** — the upload
actually happens, and it happens *before* the publication is committed.

---

## Two ways to get episodes into OneDrive

| | Needs Graph permission? | Runs where? | Use it for |
| --- | --- | --- | --- |
| **`infra/export-episodes.ps1`** | No | Your machine, into a synced folder | Quick customer examples, ad-hoc shares |
| **`onedrive` publish channel** | Yes | The deployed API | The governed, audited, human-gated publish flow |

If you just need a few episodes in a folder to send someone, use the script —
it needs no app registration at all:

```powershell
$env:PODSTUDIO_API_BASE_URL = 'https://<your-api>.azurecontainerapps.io'
./infra/export-episodes.ps1
# or: ./infra/export-episodes.ps1 -Destination "D:\Share\Customer Examples" -Force
```

It writes `<Episode>/<Episode>.mp3`, a transcript, and a `README.txt` carrying
the synthetic-media disclosure.

---

## The publish channel

### What it writes

For each published episode, under the configured base folder:

```
<ONEDRIVE_FOLDER_PATH>/<Episode title>/
    <Episode title>.mp3
    <Episode title> - transcript.txt
    README.txt          ← synthetic-media disclosure + provenance
```

The `README.txt` sidecar is deliberate: the disclosure travels with the audio,
so the file cannot be separated from the statement that it is AI-generated.

### It fails closed

The upload is attempted **before** the immutable publication is written. If it
fails, the API returns `502`, **nothing** is persisted, and the project stays in
`READY_TO_PUBLISH` so the publisher can retry. A project marked `PUBLISHED` via
this channel therefore always means the artifact really landed.

### It is idempotent

Paths are deterministic and uploads use `conflictBehavior: replace`, so a retry
overwrites rather than producing `Episode (1).mp3`.

### Large files

Graph caps a single-request upload at 4 MiB. A ten-minute 128 kbps episode is
roughly 9–10 MB, so the adapter automatically switches to a **resumable upload
session** in 1.6 MiB chunks above that threshold.

---

## Configuration

| Env var | Required | Meaning |
| --- | --- | --- |
| `GRAPH_DRIVE_ID` | yes | The target drive id. **Unset = channel disabled.** |
| `ONEDRIVE_FOLDER_PATH` | no | Base folder. Default `Podcast Studio/Published`. |
| `GRAPH_ENDPOINT` | no | Default `https://graph.microsoft.com`. Override for sovereign clouds. |

Both are wired through Bicep (`graphDriveId`, `oneDriveFolderPath` in
[main.bicep](../infra/bicep/main.bicep)) and surfaced on `/healthz` as
`services.oneDrive`.

### Finding the drive id

```bash
# A SharePoint / Teams document library (recommended)
az rest --method GET --url "https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{site-path}" --query id -o tsv
az rest --method GET --url "https://graph.microsoft.com/v1.0/sites/{site-id}/drives" --query "value[].{name:name,id:id}" -o table

# A specific user's OneDrive
az rest --method GET --url "https://graph.microsoft.com/v1.0/users/{upn}/drive" --query id -o tsv
```

---

## Permissions (owner action)

> **Pick `Sites.Selected`.** The API authenticates to Graph as the platform
> user-assigned managed identity using an **app-only** token — there is no
> signed-in user in the publish path. `Files.ReadWrite.All` would work but grants
> the app read/write access to **every drive in the tenant**, which is a poor
> trade for writing to one folder. `Sites.Selected` grants nothing by default;
> you then authorize the app on exactly one site.

```bash
miObjectId=$(az identity show -n podstudio-id -g "$RESOURCE_GROUP" --query principalId -o tsv)
graphSpId=$(az ad sp list --filter "appId eq '00000003-0000-0000-c000-000000000000'" --query "[0].id" -o tsv)

# 1) Grant the Sites.Selected APPLICATION role to the managed identity.
roleId=$(az ad sp show --id "$graphSpId" --query "appRoles[?value=='Sites.Selected' && contains(allowedMemberTypes,'Application')].id | [0]" -o tsv)
az rest --method POST \
  --url "https://graph.microsoft.com/v1.0/servicePrincipals/$miObjectId/appRoleAssignments" \
  --body "{\"principalId\":\"$miObjectId\",\"resourceId\":\"$graphSpId\",\"appRoleId\":\"$roleId\"}"

# 2) Authorize it on ONE site only (this is the step that actually grants access).
az rest --method POST \
  --url "https://graph.microsoft.com/v1.0/sites/{site-id}/permissions" \
  --body '{
    "roles": ["write"],
    "grantedToIdentities": [{ "application": { "id": "<managed identity CLIENT id>", "displayName": "podstudio-id" } }]
  }'
```

Both steps need a directory role that can consent to Graph application
permissions (Privileged Role Administrator or Global Administrator).

### Why not a personal OneDrive?

App-only Graph tokens have no user context, so reaching a personal OneDrive
requires the tenant-wide `Files.ReadWrite.All`. There is no per-user equivalent
of `Sites.Selected`. If episodes must land in an individual's OneDrive, either:

- put them in a SharePoint/Teams library that person has access to (recommended), or
- use `infra/export-episodes.ps1`, which writes through their own synced client, or
- wait for delegated auth: once Entra sign-in is enabled end-to-end
  (see [AUTH.md](AUTH.md)), an on-behalf-of flow could write as the signed-in
  publisher with only `Files.ReadWrite` delegated scope. **Not implemented.**

---

## Verifying

```bash
curl -s https://<api>/healthz | jq .services.oneDrive     # expect true
```

Then publish a project with `"channel": "onedrive"`. The response includes a
`delivery` object with the destination folder and the item URL, the audit event
records `destination` and `filesDelivered`, and each delivery receipt carries
`deliveredUrl`.

Common failures:

| Symptom | Cause |
| --- | --- |
| `501 ... Set GRAPH_DRIVE_ID` | Channel not configured. |
| `502 ... accessDenied` | The managed identity has no write grant on that site/drive. |
| `502 ... itemNotFound` | Wrong `GRAPH_DRIVE_ID`. |
| `422 ... no stored distribution path` | The episode has not been rendered yet. |
