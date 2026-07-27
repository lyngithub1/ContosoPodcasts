$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
Clear-Host
. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting ApiBaseUrl
$base = $Studio.ApiBaseUrl
$pid_ = 'smoke-audio'
$hdr = @{ 'x-actor-id' = 'u-smoke'; 'x-actor-name' = 'Smoke Tester'; 'x-actor-roles' = 'Administrator' }

function Remove-Doc($key, $id, $pk) {
  try {
    Invoke-RestMethod -Method Delete -Uri "$base/api/collections/$key/$id?pk=$pk" -Headers $hdr | Out-Null
    Write-Host ("  deleted {0}/{1}" -f $key, $id)
  } catch {
    $code = try { [int]$_.Exception.Response.StatusCode } catch { '?' }
    Write-Host ("  skip {0}/{1} (HTTP {2})" -f $key, $id, $code) -ForegroundColor DarkGray
  }
}

Write-Host '1) Remove temporary Cognitive Services User role on Speech' -ForegroundColor Cyan
$me = az ad signed-in-user show --query id -o tsv
$scope = az cognitiveservices account show -n $Studio.SpeechAccountName -g $Studio.ResourceGroup --query id -o tsv
az role assignment delete --assignee $me --role "Cognitive Services User" --scope $scope -o none 2>&1 | Out-Null
Write-Host "  role removed (exit $LASTEXITCODE)"

Write-Host '2) Delete smoke Cosmos docs' -ForegroundColor Cyan
$boot = Invoke-RestMethod -Uri "$base/api/bootstrap"
$c = $boot.collections
$c.synthesisJobs | Where-Object { $_.projectId -eq $pid_ } | ForEach-Object { Remove-Doc 'synthesisJobs' $_.id $pid_ }
$c.audioVersions | Where-Object { $_.projectId -eq $pid_ } | ForEach-Object { Remove-Doc 'audioVersions' $_.id $pid_ }
$c.qualityReports | Where-Object { $_.projectId -eq $pid_ } | ForEach-Object { Remove-Doc 'qualityReports' $_.id $pid_ }
$c.auditEvents | Where-Object { $_.projectId -eq $pid_ } | ForEach-Object { Remove-Doc 'auditEvents' $_.id $pid_ }
Remove-Doc 'structuredEvidence' 'se-smoke' $pid_
Remove-Doc 'scripts' 'sc-smoke' $pid_
Remove-Doc 'projects' $pid_ $pid_
Remove-Doc 'pronunciationEntries' 'pe-smoke-1' 'en-US'
Remove-Doc 'pronunciationEntries' 'pe-smoke-2' 'en-US'
Remove-Doc 'voiceProfiles' 'vp-smoke' 'vp-smoke'

Write-Host "`nNOTE: orphaned preview blobs under audio-preview/smoke-audio/ remain (storage is private-endpoint only; harmless)." -ForegroundColor DarkGray
Write-Host 'DONE' -ForegroundColor Green

