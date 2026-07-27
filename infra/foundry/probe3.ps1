$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$o = Join-Path $env:TEMP 'foundry-probe3.txt'
if (Test-Path $o) { Remove-Item $o }
. "$PSScriptRoot/../_env.ps1"
Assert-StudioSetting FoundryProjectEndpoint
$proj = $Studio.FoundryProjectEndpoint
$av = $Studio.FoundryApiVersion
$tok = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv 2>&1
$H = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }
$url = "$proj/agents/podcast-script-generator:run?api-version=$av"

function ReadErr($ex) {
  $d = $ex.ErrorDetails.Message
  if ($d) { return $d }
  if ($ex.Exception.Response) {
    try { $sr = New-Object System.IO.StreamReader($ex.Exception.Response.GetResponseStream()); return $sr.ReadToEnd() } catch { return '' }
  }
  return ''
}

function P($label, $body) {
  "----- $label -----" | Add-Content $o
  "body=$body" | Add-Content $o
  try {
    $r = Invoke-WebRequest -Method POST -Uri $url -Headers $H -Body $body -UseBasicParsing
    "OK $([int]$r.StatusCode)" | Add-Content $o
    $c = $r.Content; $c.Substring(0,[Math]::Min(900,$c.Length)) | Add-Content $o
  } catch {
    $s = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 }
    "ERR $s : $(ReadErr $_)" | Add-Content $o
  }
  "" | Add-Content $o
}

P 'empty'            '{}'
P 'input-str'        '{"input":"Reply with only OK."}'
P 'input-msgs'      '{"input":[{"role":"user","content":"Reply with only OK."}]}'
P 'messages'         '{"messages":[{"role":"user","content":"Reply with only OK."}]}'
P 'prompt'           '{"prompt":"Reply with only OK."}'
P 'text'             '{"text":"Reply with only OK."}'
P 'additional-messages' '{"additional_messages":[{"role":"user","content":"Reply with only OK."}]}'
P 'conversation'     '{"conversation":{"messages":[{"role":"user","content":"Reply with only OK."}]}}'

Get-Content $o
