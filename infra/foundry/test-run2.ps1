$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$o = Join-Path $env:TEMP 'foundry-testrun2.txt'
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
    $detail = $_.ErrorDetails.Message
    return @{ ok = $false; status = $status; body = $detail }
  }
}

$thread = (Call 'POST' "$proj/threads?api-version=$av" '{}')
"thread call: ok=$($thread.ok) status=$($thread.status) body=$($thread.body)" | Add-Content $o
$tid = ($thread.body | ConvertFrom-Json).id
"tid=$tid" | Add-Content $o

# Try content as a plain string
$m1 = Call 'POST' "$proj/threads/$tid/messages?api-version=$av" (@{ role='user'; content='Hello, respond with the single word OK.' } | ConvertTo-Json)
"msg string-content: ok=$($m1.ok) status=$($m1.status) body=$($m1.body)" | Add-Content $o

# Try content as an array of typed parts
$arrBody = '{"role":"user","content":[{"type":"text","text":"Hello, respond with the single word OK."}]}'
$m2 = Call 'POST' "$proj/threads/$tid/messages?api-version=$av" $arrBody
"msg array-content: ok=$($m2.ok) status=$($m2.status) body=$($m2.body)" | Add-Content $o

Get-Content $o
