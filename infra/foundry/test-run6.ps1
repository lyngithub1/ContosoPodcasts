$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$o = Join-Path $env:TEMP 'foundry-testrun6.txt'
if (Test-Path $o) { Remove-Item $o }
. "$PSScriptRoot/../_env.ps1"
Assert-StudioSetting FoundryProjectEndpoint
$proj = $Studio.FoundryProjectEndpoint
$av = $Studio.FoundryApiVersion
$tok = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv 2>&1
$H = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }

function Call($method, $url, $body) {
  try {
    $r = Invoke-WebRequest -Method $method -Uri $url -Headers $H -Body $body -UseBasicParsing
    return @{ ok = $true; status = [int]$r.StatusCode; body = $r.Content }
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 }
    return @{ ok = $false; status = $status; body = $_.ErrorDetails.Message }
  }
}

$thread = (Call 'POST' "$proj/threads?api-version=$av" '{}')
$tid = ($thread.body | ConvertFrom-Json).id
$msgBody = @{ role='user'; content='Reply with only this exact minified JSON and nothing else: {"title":"t","segments":[{"speaker":"Host","heading":null,"directionCue":null,"text":"hello","claimIds":[]}]}' } | ConvertTo-Json -Depth 5
Call 'POST' "$proj/threads/$tid/messages?api-version=$av" $msgBody | Out-Null

$run = (Call 'POST' "$proj/threads/$tid/runs?api-version=$av" '{"assistant_id":"podcast-script-generator"}')
"run w/ assistant_id=name: ok=$($run.ok) status=$($run.status)" | Add-Content $o
if (-not $run.ok) { "run body: $($run.body)" | Add-Content $o; Get-Content $o; exit }
$rid = ($run.body | ConvertFrom-Json).id
$st = ($run.body | ConvertFrom-Json).status
"run id=$rid start status=$st" | Add-Content $o
$deadline = (Get-Date).AddSeconds(90)
while ($st -in @('queued','in_progress','requires_action')) {
  if ((Get-Date) -gt $deadline) { "TIMEOUT" | Add-Content $o; break }
  Start-Sleep -Milliseconds 1500
  $rr = (Call 'GET' "$proj/threads/$tid/runs/$rid?api-version=$av" $null)
  $st = ($rr.body | ConvertFrom-Json).status
}
"final status=$st" | Add-Content $o
$data = ((Call 'GET' "$proj/threads/$tid/messages?api-version=$av" $null).body | ConvertFrom-Json).data
$a = $data | Where-Object { $_.role -eq 'assistant' } | Select-Object -First 1
"assistant text: $($a.content[0].text.value)" | Add-Content $o
Get-Content $o
