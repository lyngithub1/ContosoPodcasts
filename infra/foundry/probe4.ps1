$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$o = Join-Path $env:TEMP 'foundry-probe4.txt'
if (Test-Path $o) { Remove-Item $o }
. "$PSScriptRoot/../_env.ps1"
Assert-StudioSetting FoundryProjectEndpoint
$proj = $Studio.FoundryProjectEndpoint
$tok = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv 2>&1
$H = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }

function ReadErr($ex) {
  $d = $ex.ErrorDetails.Message
  if ($d) { return $d }
  if ($ex.Exception.Response) { try { $sr = New-Object System.IO.StreamReader($ex.Exception.Response.GetResponseStream()); return $sr.ReadToEnd() } catch { return '' } }
  return ''
}
function P($label, $url, $body) {
  "----- $label -----" | Add-Content $o
  "POST $url" | Add-Content $o
  try {
    $r = Invoke-WebRequest -Method POST -Uri $url -Headers $H -Body $body -UseBasicParsing
    "OK $([int]$r.StatusCode)" | Add-Content $o
    $c = $r.Content; $c.Substring(0,[Math]::Min(1600,$c.Length)) | Add-Content $o
  } catch {
    $s = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 }
    "ERR $s : $(ReadErr $_)" | Add-Content $o
  }
  "" | Add-Content $o
}

$body = '{"agent_reference":{"type":"agent_reference","name":"podcast-script-generator"},"input":"Reply with only the single word OK."}'

P 'openai/v1/responses (no api-version)' "$proj/openai/v1/responses" $body
P 'openai/v1/responses (api-version=v1)' "$proj/openai/v1/responses?api-version=v1" $body

Get-Content $o
