$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
Clear-Host
. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting ApiBaseUrl
$base = $Studio.ApiBaseUrl
$pid_ = 'smoke-audio'
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
  $code = $null
  try { $code = [int]$err.Exception.Response.StatusCode } catch {}
  $detail = $null
  try { $detail = $err.ErrorDetails.Message } catch {}
  Write-Host ("  [{0}] HTTP {1} :: {2}" -f $label, $code, $detail) -ForegroundColor Yellow
}

Write-Host '=== Seeding test data ===' -ForegroundColor Cyan

Post-Coll 'voiceProfiles' @{ id = 'vp-smoke'; voiceName = 'en-US-AvaNeural'; locale = 'en-US'; displayName = 'Ava (smoke)'; gender = 'female'; styleList = @() } | Out-Null
Write-Host ' voiceProfile vp-smoke'

Post-Coll 'projects' @{
  id = $pid_; title = 'Smoke Audio Project'; state = 'SCRIPT_APPROVED'; outputLocale = 'en-US';
  therapeuticArea = 'HIV'; scriptForm = 'host-expert'; locale = 'en-US'
} | Out-Null
Write-Host ' project smoke-audio'

$segments = @(
  @{ order = 1; speakerId = 'spk-host'; text = 'Welcome to the show. Today we discuss dolutegravir and tenofovir in H I V therapy.' },
  @{ order = 2; speakerId = 'spk-host'; text = 'Dolutegravir is an integrase inhibitor. Tenofovir supports the backbone regimen.' }
)
Post-Coll 'scripts' @{
  id = 'sc-smoke'; projectId = $pid_; locale = 'en-US'; status = 'approved'; scriptForm = 'host-expert';
  speakers = @(@{ id = 'spk-host'; label = 'Host'; role = 'host'; voiceProfileId = 'vp-smoke' });
  segments = $segments
} | Out-Null
Write-Host ' script sc-smoke (2 segments)'

Post-Coll 'structuredEvidence' @{
  id = 'se-smoke'; projectId = $pid_;
  pronunciationCandidates = @('dolutegravir', 'tenofovir');
  disclosureRequirements = @()
} | Out-Null
Write-Host ' structuredEvidence se-smoke'

Post-Coll 'pronunciationEntries' @{ id = 'pe-smoke-1'; locale = 'en-US'; canonicalForm = 'Dolutegravir'; spokenForm = 'Dolutegravir'; inGoldenSet = $true; approvalStatus = 'approved'; tags = @() } | Out-Null
Post-Coll 'pronunciationEntries' @{ id = 'pe-smoke-2'; locale = 'en-US'; canonicalForm = 'Tenofovir'; spokenForm = 'Tenofovir'; inGoldenSet = $true; approvalStatus = 'approved'; tags = @() } | Out-Null
Write-Host ' pronunciationEntries pe-smoke-1, pe-smoke-2'

Write-Host "`n=== #4 POST /synthesize ===" -ForegroundColor Cyan
try {
  $syn = Invoke-RestMethod -Method Post -Uri "$base/api/projects/$pid_/synthesize" -Headers $hdr -Body '{}'
  Write-Host (' OK: audioVersion={0} v={1} job={2} durationS={3} path={4}' -f $syn.audioVersion.id, $syn.audioVersion.version, $syn.synthesisJob.id, $syn.audioVersion.durationSeconds, $syn.audioVersion.distributionPath) -ForegroundColor Green
  Write-Host (' synthesisJob.status={0} segmentsCompleted={1}/{2}' -f $syn.synthesisJob.status, $syn.synthesisJob.segmentsCompleted, $syn.synthesisJob.segmentsTotal)
} catch { Show-Err 'synthesize' $_ }

Write-Host "`n=== #4 GET /audio ===" -ForegroundColor Cyan
try {
  $out = Join-Path $env:TEMP 'smoke-audio.mp3'
  Invoke-WebRequest -Uri "$base/api/projects/$pid_/audio" -Headers $hdr -OutFile $out
  $sz = (Get-Item $out).Length
  $magic = [System.IO.File]::ReadAllBytes($out)[0..2] -join ','
  Write-Host (' OK: {0} bytes -> {1} (first3 bytes={2})' -f $sz, $out, $magic) -ForegroundColor Green
} catch { Show-Err 'audio' $_ }

Write-Host "`n=== #3 POST /pronunciation-qa (REAL STT) ===" -ForegroundColor Cyan
try {
  $qa = Invoke-RestMethod -Method Post -Uri "$base/api/projects/$pid_/pronunciation-qa" -Headers $hdr -Body '{}'
  Write-Host (' OK: qr={0} overallConfidence={1} blocking={2}' -f $qa.qualityReport.id, $qa.qualityReport.overallConfidence, $qa.qualityReport.hasBlockingIssues) -ForegroundColor Green
  Write-Host ' termChecks:'
  $qa.qualityReport.termChecks | ForEach-Object {
    Write-Host ("   - {0} expected='{1}' heard='{2}' conf={3} matched={4} critical={5}" -f $_.term, $_.expectedSpokenForm, $_.transcribedAs, $_.confidence, $_.matched, $_.critical)
  }
  Write-Host "`n --- TRANSCRIPT (real STT output) ---" -ForegroundColor DarkCyan
  Write-Host ('   "{0}"' -f $qa.transcript)
} catch { Show-Err 'pronunciation-qa' $_ }

Write-Host "`n=== DONE ===" -ForegroundColor Cyan
