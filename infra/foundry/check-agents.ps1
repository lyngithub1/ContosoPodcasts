$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$o = Join-Path $env:TEMP 'foundry-agents.txt'
if (Test-Path $o) { Remove-Item $o }

. "$PSScriptRoot/../_env.ps1"
Assert-StudioSetting FoundryProjectEndpoint, FoundryAccount, FoundryResourceGroup
$proj = $Studio.FoundryProjectEndpoint
$acctId = az cognitiveservices account show -n $Studio.FoundryAccount -g $Studio.FoundryResourceGroup --query id -o tsv 2>&1
"== account id ==" | Add-Content $o
$acctId | Add-Content $o

"== agents list (my az token, audience ai.azure.com) ==" | Add-Content $o
$tok = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv 2>&1
try {
  $r = Invoke-RestMethod -Method GET -Uri "$proj/agents?api-version=v1" -Headers @{ Authorization = "Bearer $tok" }
  ($r.data | ForEach-Object { $_.name }) -join ', ' | Add-Content $o
} catch {
  "AGENTS ERROR: $($_.Exception.Message)" | Add-Content $o
  if ($_.Exception.Response) { "HTTP $([int]$_.Exception.Response.StatusCode)" | Add-Content $o }
}

"== can I write role assignments here? (existing assignments on account) ==" | Add-Content $o
az role assignment list --scope $acctId --query "length(@)" -o tsv 2>&1 | Add-Content $o
"== my signed-in identity ==" | Add-Content $o
az account show --query "user.name" -o tsv 2>&1 | Add-Content $o

Get-Content $o
