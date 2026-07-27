$ProgressPreference = 'SilentlyContinue'
Clear-Host
. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting ApiBaseUrl
$base = $Studio.ApiBaseUrl
$boot = Invoke-RestMethod -Uri "$base/api/bootstrap"
$c = $boot.collections

Write-Host "=== persistence ===" $boot.persistence
Write-Host "=== collections present ===" ($c.PSObject.Properties.Name -join ', ')

Write-Host "`n=== projects ==="
$c.projects | ForEach-Object { Write-Host (" - {0} | id={1} | state={2} | locale={3} | scriptForm={4}" -f $_.title, $_.id, $_.state, $_.locale, $_.scriptForm) }

$proj = $c.projects | Where-Object { $_.id -eq 'p1' } | Select-Object -First 1
Write-Host "`n=== project p1 ==="
$proj | ConvertTo-Json -Depth 6

$scripts = $c.scripts | Where-Object { $_.projectId -eq 'p1' }
Write-Host "`n=== scripts for p1 (count=$($scripts.Count)) ==="
$scripts | ForEach-Object {
  Write-Host (" script id={0} v={1} status={2} speakers={3} segments={4}" -f $_.id, $_.version, $_.status, ($_.speakers | Measure-Object).Count, ($_.segments | Measure-Object).Count)
}
$script = $scripts | Sort-Object version -Descending | Select-Object -First 1
Write-Host "`n=== latest script speakers ==="
$script.speakers | ConvertTo-Json -Depth 6
Write-Host "`n=== latest script first 3 segments ==="
$script.segments | Select-Object -First 3 | ConvertTo-Json -Depth 6

Write-Host "`n=== structuredEvidence for p1 ==="
$c.structuredEvidence | Where-Object { $_.projectId -eq 'p1' } | ForEach-Object {
  Write-Host (" se id={0} candidates={1}" -f $_.id, ($_.pronunciationCandidates -join '; '))
}

Write-Host "`n=== voiceProfiles ==="
$c.voiceProfiles | ForEach-Object { Write-Host (" - id={0} voiceName={1} locale={2}" -f $_.id, $_.voiceName, $_.locale) }

Write-Host "`n=== pronunciationEntries (de-DE) ==="
$c.pronunciationEntries | Where-Object { $_.locale -eq 'de-DE' } | ForEach-Object {
  Write-Host (" - canonical={0} spoken={1} golden={2}" -f $_.canonicalForm, $_.spokenForm, $_.inGoldenSet)
}

Write-Host "`n=== existing audioVersions for p1 ==="
$c.audioVersions | Where-Object { $_.projectId -eq 'p1' } | ForEach-Object {
  Write-Host (" - id={0} v={1} distributionPath={2} qrId={3}" -f $_.id, $_.version, $_.distributionPath, $_.qualityReportId)
}
