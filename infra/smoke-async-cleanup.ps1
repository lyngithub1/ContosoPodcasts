$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
Clear-Host
. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting ApiBaseUrl
$base = $Studio.ApiBaseUrl
$proj = 'smoke-async'
$hdr = @{ 'x-actor-id' = 'u-smoke'; 'x-actor-name' = 'Smoke Tester'; 'x-actor-roles' = 'Creator,AudioReviewer,Administrator' }

# id -> collection key + partition key value
$docs = @(
  @{ key = 'projects'; id = $proj; pk = $proj },
  @{ key = 'scripts'; id = 'sc-async'; pk = $proj },
  @{ key = 'structuredEvidence'; id = 'se-async'; pk = $proj },
  @{ key = 'voiceProfiles'; id = 'vp-async'; pk = 'vp-async' },
  @{ key = 'pronunciationEntries'; id = 'pe-async-1'; pk = 'en-US' },
  @{ key = 'pronunciationEntries'; id = 'pe-async-2'; pk = 'en-US' }
)

# Also delete any generated synthesisJobs / audioVersions / qualityReports / auditEvents for the project
$b = Invoke-RestMethod -Method Get -Uri "$base/api/bootstrap" -Headers $hdr
foreach ($k in 'synthesisJobs', 'audioVersions', 'qualityReports', 'auditEvents') {
  foreach ($d in @($b.collections.$k | Where-Object { $_.projectId -eq $proj })) {
    $docs += @{ key = $k; id = $d.id; pk = $proj }
  }
}

foreach ($d in $docs) {
  $uri = "$base/api/collections/$($d.key)/$($d.id)?pk=$([uri]::EscapeDataString($d.pk))"
  try {
    Invoke-RestMethod -Method Delete -Uri $uri -Headers $hdr | Out-Null
    Write-Host (" deleted {0}/{1}" -f $d.key, $d.id) -ForegroundColor Green
  } catch {
    $code = $null; try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    Write-Host (" skip {0}/{1} (HTTP {2})" -f $d.key, $d.id, $code) -ForegroundColor DarkGray
  }
}
Write-Host "`n=== cleanup done ===" -ForegroundColor Cyan
