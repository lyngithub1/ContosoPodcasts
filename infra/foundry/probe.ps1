$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$o = Join-Path $env:TEMP 'foundry-probe.txt'
if (Test-Path $o) { Remove-Item $o }
. "$PSScriptRoot/../_env.ps1"
Assert-StudioSetting FoundryProjectEndpoint
$proj = $Studio.FoundryProjectEndpoint
$av = $Studio.FoundryApiVersion
$tok = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv 2>&1
$H = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }

function Try($label, $method, $url, $body) {
  "----- $label -----" | Add-Content $o
  "$method $url" | Add-Content $o
  try {
    $r = Invoke-WebRequest -Method $method -Uri $url -Headers $H -Body $body -UseBasicParsing
    "OK $([int]$r.StatusCode)" | Add-Content $o
    $c = $r.Content; $c.Substring(0,[Math]::Min(700,$c.Length)) | Add-Content $o
  } catch {
    $s = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 }
    "ERR $s : $($_.ErrorDetails.Message)" | Add-Content $o
  }
  "" | Add-Content $o
}

# Agent detail
Try 'agent-detail' 'GET' "$proj/agents/podcast-script-generator?api-version=$av" $null

$in = '{"input":"Reply with only OK."}'
$inMsgs = '{"input":[{"role":"user","content":"Reply with only OK."}]}'

Try 'agents/{id}/runs input-str'  'POST' "$proj/agents/podcast-script-generator/runs?api-version=$av" $in
Try 'agents/{id}/runs input-msgs' 'POST' "$proj/agents/podcast-script-generator/runs?api-version=$av" $inMsgs
Try 'agents/{id}:run'             'POST' "$proj/agents/podcast-script-generator:run?api-version=$av" $inMsgs
Try 'responses agent-name'        'POST' "$proj/responses?api-version=$av" '{"agent":{"type":"agent_reference","name":"podcast-script-generator"},"input":"Reply with only OK."}'
Try 'responses model-name'        'POST' "$proj/responses?api-version=$av" '{"model":"podcast-script-generator","input":"Reply with only OK."}'

Get-Content $o
