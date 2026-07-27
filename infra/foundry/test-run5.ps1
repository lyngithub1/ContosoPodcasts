$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$o = Join-Path $env:TEMP 'foundry-testrun5.txt'
if (Test-Path $o) { Remove-Item $o }
. "$PSScriptRoot/../_env.ps1"
Assert-StudioSetting FoundryProjectEndpoint
$proj = $Studio.FoundryProjectEndpoint
$av = $Studio.FoundryApiVersion
$tok = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv 2>&1
$H = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }

function Get2($url) {
  try { $r = Invoke-WebRequest -Method GET -Uri $url -Headers $H -UseBasicParsing; return $r.Content }
  catch { return "ERR $([int]$_.Exception.Response.StatusCode): $($_.ErrorDetails.Message)" }
}

"===== /agents raw (first 1200 chars) =====" | Add-Content $o
$ag = Get2 "$proj/agents?api-version=$av"
$ag.Substring(0, [Math]::Min(1200, $ag.Length)) | Add-Content $o

"`n===== /assistants raw (first 1200 chars) =====" | Add-Content $o
$asst = Get2 "$proj/assistants?api-version=$av"
$asst.Substring(0, [Math]::Min(1200, $asst.Length)) | Add-Content $o

Get-Content $o
