$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
Clear-Host
. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting ApiBaseUrl
$base = $Studio.ApiBaseUrl
$proj = 'smoke-search'
$hdr = @{ 'x-actor-id' = 'u-smoke'; 'x-actor-name' = 'Smoke'; 'x-actor-roles' = 'Creator,Administrator' }

$docs = @(
  @{ key = 'projects'; id = $proj; pk = $proj },
  @{ key = 'structuredEvidence'; id = 'se-search'; pk = $proj },
  @{ key = 'claims'; id = 'cl-search-1'; pk = $proj },
  @{ key = 'claims'; id = 'cl-search-2'; pk = $proj }
)
$b = Invoke-RestMethod -Method Get -Uri "$base/api/bootstrap" -Headers $hdr
foreach ($k in 'sources', 'auditEvents') {
  foreach ($d in @($b.collections.$k | Where-Object { $_.projectId -eq $proj })) { $docs += @{ key = $k; id = $d.id; pk = $proj } }
}
foreach ($d in $docs) {
  $uri = "$base/api/collections/$($d.key)/$($d.id)?pk=$([uri]::EscapeDataString($d.pk))"
  try { Invoke-RestMethod -Method Delete -Uri $uri -Headers $hdr | Out-Null; Write-Host (" deleted {0}/{1}" -f $d.key, $d.id) -ForegroundColor Green }
  catch { $c = $null; try { $c = [int]$_.Exception.Response.StatusCode } catch {}; Write-Host (" skip {0}/{1} (HTTP {2})" -f $d.key, $d.id, $c) -ForegroundColor DarkGray }
}
Write-Host "`nNOTE: 4 demo docs remain in the AI Search 'research-index' (project filter smoke-search)." -ForegroundColor DarkYellow
Write-Host "      They are harmless demo data; the MI (not this CLI identity) holds index write access." -ForegroundColor DarkYellow
Write-Host "=== cleanup done ===" -ForegroundColor Cyan
