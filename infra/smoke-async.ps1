$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
Clear-Host
. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting ApiBaseUrl
$base = $Studio.ApiBaseUrl
$proj = 'smoke-async'
$hdr = @{
  'x-actor-id'    = 'u-smoke'
  'x-actor-name'  = 'Smoke Tester'
  'x-actor-roles' = 'Creator,AudioReviewer,Administrator'
  'Content-Type'  = 'application/json'
}

function Post-Coll($key, $obj) {
  $body = $obj | ConvertTo-Json -Depth 12 -Compress
  return Invoke-RestMethod -Method Post -Uri "$base/api/collections/$key" -Headers $hdr -Body $body
}
function Show-Err($label, $err) {
  $code = $null; try { $code = [int]$err.Exception.Response.StatusCode } catch {}
  $detail = $null; try { $detail = $err.ErrorDetails.Message } catch {}
  Write-Host ("  [{0}] HTTP {1} :: {2}" -f $label, $code, $detail) -ForegroundColor Yellow
}
function Get-Coll($key) {
  $b = Invoke-RestMethod -Method Get -Uri "$base/api/bootstrap" -Headers $hdr
  return @($b.collections.$key)
}

Write-Host '=== Seeding async test data ===' -ForegroundColor Cyan
Post-Coll 'voiceProfiles' @{ id = 'vp-async'; voiceName = 'en-US-AvaNeural'; locale = 'en-US'; displayName = 'Ava (async)'; gender = 'female'; styleList = @() } | Out-Null
Post-Coll 'projects' @{ id = $proj; title = 'Smoke Async Project'; state = 'SCRIPT_APPROVED'; outputLocale = 'en-US'; therapeuticArea = 'HIV'; scriptForm = 'host-expert'; locale = 'en-US' } | Out-Null
$segments = @(
  @{ order = 1; speakerId = 'spk-host'; text = 'Welcome back. Today we review dolutegravir and tenofovir for H I V therapy.' },
  @{ order = 2; speakerId = 'spk-host'; text = 'Dolutegravir is an integrase inhibitor. Tenofovir anchors the backbone regimen.' }
)
Post-Coll 'scripts' @{ id = 'sc-async'; projectId = $proj; locale = 'en-US'; status = 'approved'; scriptForm = 'host-expert'; speakers = @(@{ id = 'spk-host'; label = 'Host'; role = 'host'; voiceProfileId = 'vp-async' }); segments = $segments } | Out-Null
Post-Coll 'structuredEvidence' @{ id = 'se-async'; projectId = $proj; pronunciationCandidates = @('dolutegravir', 'tenofovir'); disclosureRequirements = @() } | Out-Null
Post-Coll 'pronunciationEntries' @{ id = 'pe-async-1'; locale = 'en-US'; canonicalForm = 'Dolutegravir'; spokenForm = 'Dolutegravir'; inGoldenSet = $true; approvalStatus = 'approved'; tags = @() } | Out-Null
Post-Coll 'pronunciationEntries' @{ id = 'pe-async-2'; locale = 'en-US'; canonicalForm = 'Tenofovir'; spokenForm = 'Tenofovir'; inGoldenSet = $true; approvalStatus = 'approved'; tags = @() } | Out-Null
Write-Host ' seed complete'

Write-Host "`n=== #5 POST /synthesize-async (enqueue) ===" -ForegroundColor Cyan
$jobId = $null
try {
  $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$base/api/projects/$proj/synthesize-async" -Headers $hdr -Body '{}'
  $body = $r.Content | ConvertFrom-Json
  $jobId = $body.synthesisJob.id
  Write-Host (' HTTP {0}: queued job={1} status={2}' -f $r.StatusCode, $jobId, $body.synthesisJob.status) -ForegroundColor Green
} catch { Show-Err 'synthesize-async' $_; return }

Write-Host "`n=== Poll for worker to drain synthesis-jobs queue ===" -ForegroundColor Cyan
$jobDone = $false
for ($i = 1; $i -le 30; $i++) {
  Start-Sleep -Seconds 3
  $job = Get-Coll 'synthesisJobs' | Where-Object { $_.id -eq $jobId }
  $st = if ($job) { $job.status } else { '(missing)' }
  Write-Host ("  [{0}] job status = {1}" -f $i, $st)
  if ($st -eq 'succeeded') { $jobDone = $true; break }
  if ($st -eq 'failed') { Write-Host ('  job FAILED: {0}' -f $job.logPath) -ForegroundColor Red; break }
}
if ($jobDone) { Write-Host ' synthesis job processed by background worker' -ForegroundColor Green }

Write-Host "`n=== Poll for chained qa-jobs -> qualityReport ===" -ForegroundColor Cyan
$qaDone = $false
for ($i = 1; $i -le 30; $i++) {
  $qr = Get-Coll 'qualityReports' | Where-Object { $_.projectId -eq $proj }
  if ($qr) {
    Write-Host (' OK: qr={0} overallConfidence={1} blocking={2}' -f $qr.id, $qr.overallConfidence, $qr.hasBlockingIssues) -ForegroundColor Green
    $qr.termChecks | ForEach-Object { Write-Host ("   - {0} heard='{1}' conf={2} matched={3} critical={4}" -f $_.term, $_.transcribedAs, $_.confidence, $_.matched, $_.critical) }
    $qaDone = $true; break
  }
  Start-Sleep -Seconds 3
  Write-Host ("  [{0}] waiting for QA report..." -f $i)
}

Write-Host "`n=== GET /audio (rendered by worker) ===" -ForegroundColor Cyan
try {
  $out = Join-Path $env:TEMP 'smoke-async.mp3'
  Invoke-WebRequest -UseBasicParsing -Uri "$base/api/projects/$proj/audio" -Headers $hdr -OutFile $out
  Write-Host (' OK: {0} bytes -> {1}' -f (Get-Item $out).Length, $out) -ForegroundColor Green
} catch { Show-Err 'audio' $_ }

Write-Host "`n=== Audit trail (queued -> synthesized -> qa) ===" -ForegroundColor Cyan
$ae = Get-Coll 'auditEvents' | Where-Object { $_.projectId -eq $proj } | Sort-Object at
$ae | ForEach-Object { Write-Host ("   {0}  {1}" -f $_.eventType, $_.summary) }

Write-Host "`n=== DONE (jobDone=$jobDone qaDone=$qaDone) ===" -ForegroundColor Cyan
