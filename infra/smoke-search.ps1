$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
Clear-Host
. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting ApiBaseUrl
$base = $Studio.ApiBaseUrl
$proj = 'smoke-search'
$hdr = @{
  'x-actor-id'    = 'u-smoke'
  'x-actor-name'  = 'Smoke Tester'
  'x-actor-roles' = 'Creator,Administrator'
  'Content-Type'  = 'application/json'
}
function Post-Coll($key, $obj) { Invoke-RestMethod -Method Post -Uri "$base/api/collections/$key" -Headers $hdr -Body ($obj | ConvertTo-Json -Depth 12 -Compress) }
function Show-Err($label, $err) {
  $code = $null; try { $code = [int]$err.Exception.Response.StatusCode } catch {}
  $detail = $null; try { $detail = $err.ErrorDetails.Message } catch {}
  Write-Host ("  [{0}] HTTP {1} :: {2}" -f $label, $code, $detail) -ForegroundColor Yellow
}

Write-Host '=== Seed project + evidence + claims ===' -ForegroundColor Cyan
Post-Coll 'projects' @{ id = $proj; title = 'Smoke Search Project'; state = 'RESEARCH_CONFIGURED'; outputLocale = 'en-US'; therapeuticArea = 'HIV'; scriptForm = 'host-expert'; locale = 'en-US' } | Out-Null
Post-Coll 'structuredEvidence' @{ id = 'se-search'; projectId = $proj; researchQuestion = 'Does dolutegravir improve virologic suppression versus efavirenz?'; studyDesign = 'Randomized controlled trial'; efficacyResults = @('88% virologic suppression at week 48'); safetyResults = @('Favorable renal and bone profile with tenofovir alafenamide'); limitations = @('Open-label design'); pronunciationCandidates = @('dolutegravir', 'tenofovir') } | Out-Null
Post-Coll 'claims' @{ id = 'cl-search-1'; projectId = $proj; statement = 'Dolutegravir plus abacavir-lamivudine achieved 88 percent suppression at week 48.'; excluded = $false } | Out-Null
Post-Coll 'claims' @{ id = 'cl-search-2'; projectId = $proj; statement = 'Tenofovir alafenamide has improved renal safety versus tenofovir disoproxil fumarate.'; excluded = $false } | Out-Null
Write-Host ' seed complete'

Write-Host "`n=== #6 POST /extract-source (Document Intelligence, HTML) ===" -ForegroundColor Cyan
$html = '<html><body><h1>Dolutegravir and Tenofovir in HIV therapy</h1><p>Dolutegravir is an integrase strand transfer inhibitor. In a randomized trial, dolutegravir plus abacavir and lamivudine achieved 88% virologic suppression at week 48. Tenofovir alafenamide is a nucleotide reverse transcriptase inhibitor with improved renal and bone safety compared with tenofovir disoproxil fumarate.</p></body></html>'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($html))
$srcId = $null
try {
  $ex = Invoke-RestMethod -Method Post -Uri "$base/api/projects/$proj/extract-source" -Headers $hdr -Body (@{ title = 'HIV therapy overview'; url = 'https://example.org/hiv'; contentType = 'text/html'; contentBase64 = $b64; index = $true } | ConvertTo-Json -Compress)
  $srcId = $ex.source.id
  Write-Host (' OK: source={0} extractedChars={1} pages={2} indexed={3}' -f $srcId, $ex.extractedChars, $ex.pages, $ex.indexed) -ForegroundColor Green
  Write-Host ('   extracted text (first 160): "{0}"' -f $ex.source.title) -ForegroundColor DarkCyan
} catch { Show-Err 'extract-source' $_ }

Write-Host "`n=== #6 POST /index-evidence (AI Search) ===" -ForegroundColor Cyan
try {
  $ix = Invoke-RestMethod -Method Post -Uri "$base/api/projects/$proj/index-evidence" -Headers $hdr -Body '{}'
  Write-Host (' OK: indexed={0} breakdown sources={1} claims={2} evidence={3}' -f $ix.indexed, $ix.breakdown.sources, $ix.breakdown.claims, $ix.breakdown.evidence) -ForegroundColor Green
} catch { Show-Err 'index-evidence' $_ }

Write-Host "`n=== #6 GET /search?q=dolutegravir renal safety (retrieval) ===" -ForegroundColor Cyan
$hits = $null
for ($i = 1; $i -le 10; $i++) {
  try {
    $r = Invoke-RestMethod -Method Get -Uri "$base/api/projects/$proj/search?q=dolutegravir%20renal%20safety&top=5" -Headers $hdr
    if ($r.count -gt 0) { $hits = $r; break }
    Write-Host ("  [{0}] index still warming (0 hits)..." -f $i)
  } catch { Show-Err 'search' $_ }
  Start-Sleep -Seconds 2
}
if ($hits) {
  Write-Host (' OK: {0} hit(s)' -f $hits.count) -ForegroundColor Green
  $hits.hits | ForEach-Object { Write-Host ("   [{0}] score={1} {2} :: {3}" -f $_.kind, ([math]::Round($_.score, 3)), $_.title, ($_.content.Substring(0, [Math]::Min(90, $_.content.Length)))) }
} else { Write-Host ' no hits after warmup' -ForegroundColor Yellow }

Write-Host "`n=== Audit trail ===" -ForegroundColor Cyan
$b = Invoke-RestMethod -Method Get -Uri "$base/api/bootstrap" -Headers $hdr
@($b.collections.auditEvents | Where-Object { $_.projectId -eq $proj } | Sort-Object at) | ForEach-Object { Write-Host ("   {0}  {1}" -f $_.eventType, $_.summary) }

Write-Host "`n=== DONE ===" -ForegroundColor Cyan
