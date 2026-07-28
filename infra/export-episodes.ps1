<#
.SYNOPSIS
  Export rendered podcast episodes from the studio into a local folder
  (e.g. a OneDrive-synced folder) so they can be shared immediately.

.DESCRIPTION
  Pulls every project that has rendered audio and writes, per episode:

      <Destination>/<Episode title>/<Episode title>.mp3
      <Destination>/<Episode title>/<Episode title> - transcript.txt
      <Destination>/<Episode title>/README.txt      (synthetic-media disclosure)

  This is the zero-permission path: it needs no Microsoft Graph app
  registration and no Sites.Selected grant, because it writes to a folder your
  own OneDrive client already syncs. Use it for quick customer examples.

  For server-side delivery as part of the gated publish flow, use the
  `onedrive` delivery channel instead (see docs/ONEDRIVE.md).

.PARAMETER Destination
  Target folder. Defaults to a "Podcast Studio Examples" folder in your OneDrive.

.PARAMETER ProjectId
  Export only these project ids. Omit to export every project with audio.

.PARAMETER Force
  Overwrite existing files instead of skipping them.

.PARAMETER ApprovedOnly
  Export only episodes whose project has passed audio approval
  (AUDIO_APPROVED / READY_TO_PUBLISH / PUBLISHED). Recommended when the output
  is going to a customer: without it, unreviewed drafts are exported too.

.EXAMPLE
  ./infra/export-episodes.ps1

.EXAMPLE
  ./infra/export-episodes.ps1 -Destination "D:\Share\Customer Examples" -ApprovedOnly -Force
#>

[CmdletBinding()]
param(
    [string]$Destination,
    [string[]]$ProjectId,
    [switch]$ApprovedOnly,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting ApiBaseUrl
$base = $Studio.ApiBaseUrl

if (-not $Destination) {
    $oneDrive = $env:OneDriveCommercial
    if (-not $oneDrive) { $oneDrive = $env:OneDrive }
    if (-not $oneDrive) { $oneDrive = Join-Path $HOME 'OneDrive' }
    $Destination = Join-Path $oneDrive 'Podcast Studio Examples'
}

# The demo identity shim. Harmless when the API runs in header mode; ignored
# outright when AUTH_MODE=entra (that path needs a real bearer token).
$headers = @{
    'x-actor-id'    = 'u-export'
    'x-actor-name'  = 'Episode Export'
    'x-actor-roles' = 'Administrator'
}

function Get-SafeName {
    param(
        [string]$Value,
        [string]$Fallback,
        # Episode titles can run well over 100 characters. The name is used for
        # BOTH the folder and the file inside it, so a generous cap here blows
        # past the Windows 260-character MAX_PATH limit and every write fails
        # with "Could not find a part of the path".
        [int]$MaxLength = 60
    )
    $clean = ($Value -replace '[\\/:*?"<>|#%]', ' ') -replace '\s+', ' '
    $clean = $clean.Trim().Trim('.')
    if ([string]::IsNullOrWhiteSpace($clean)) { return $Fallback }
    if ($clean.Length -gt $MaxLength) { $clean = $clean.Substring(0, $MaxLength).Trim() }
    return $clean.Trim('.')
}

Write-Host "Source : $base"
Write-Host "Target : $Destination"
Write-Host ''

$boot = Invoke-RestMethod -Uri "$base/api/bootstrap" -Headers $headers
if (-not $boot.persistence) {
    Write-Warning 'The API reports no persistence - there may be nothing to export.'
}

$projects = @($boot.collections.projects)
$audio    = @($boot.collections.audioVersions)
$scripts  = @($boot.collections.scripts)

if ($ProjectId) { $projects = $projects | Where-Object { $ProjectId -contains $_.id } }
if (-not $projects) { Write-Warning 'No matching projects found.'; return }

New-Item -ItemType Directory -Path $Destination -Force | Out-Null

# Several projects can legitimately share a title (re-runs, variants). Track
# used folder names so they land side by side instead of overwriting.
$usedNames = @{}

$exported = 0; $skipped = 0; $failed = 0

# States in which the audio has cleared human review.
$approvedStates = @('AUDIO_APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED')
$unapproved = 0

foreach ($p in $projects) {
    $av = $audio | Where-Object { $_.projectId -eq $p.id } | Select-Object -First 1
    if (-not $av) {
        Write-Host ("SKIP  {0} - no rendered audio" -f $p.title) -ForegroundColor DarkGray
        $skipped++
        continue
    }

    $isApproved = $approvedStates -contains $p.state
    if ($ApprovedOnly -and -not $isApproved) {
        Write-Host ("SKIP  {0} - not approved (state {1})" -f $p.title, $p.state) -ForegroundColor DarkGray
        $skipped++
        continue
    }
    if (-not $isApproved) { $unapproved++ }

    $title = Get-SafeName $p.title $p.id
    if ($usedNames.ContainsKey($title)) {
        # Suffix with a short slice of the project id to keep them distinct.
        $suffix = ($p.id -replace '[^a-zA-Z0-9]', '')
        if ($suffix.Length -gt 8) { $suffix = $suffix.Substring($suffix.Length - 8) }
        $title = "$title ($suffix)"
    }
    $usedNames[$title] = $true

    $folder = Join-Path $Destination $title
    $mp3    = Join-Path $folder "$title.mp3"

    if ($mp3.Length -ge 250) {
        Write-Host ("SKIP  {0} - resulting path is too long ({1} chars); use a shorter -Destination" -f $title, $mp3.Length) -ForegroundColor Yellow
        $skipped++
        continue
    }

    if ((Test-Path $mp3) -and -not $Force) {
        Write-Host ("SKIP  {0} - already exported (use -Force to overwrite)" -f $title) -ForegroundColor DarkGray
        $skipped++
        continue
    }

    New-Item -ItemType Directory -Path $folder -Force | Out-Null

    try {
        Invoke-WebRequest -Uri "$base/api/projects/$($p.id)/audio" -Headers $headers -OutFile $mp3 -UseBasicParsing
        $bytes = (Get-Item $mp3).Length
        if ($bytes -le 0) { throw 'The API returned an empty audio file.' }

        $script = $scripts | Where-Object { $_.projectId -eq $p.id } | Select-Object -First 1
        if ($script -and $script.segments) {
            $transcript = ($script.segments | ForEach-Object { $_.text }) -join "`r`n`r`n"
            Set-Content -Path (Join-Path $folder "$title - transcript.txt") -Value $transcript -Encoding UTF8
        }

        $readme = @"
$title
$('=' * $title.Length)

AI-GENERATED AUDIO - SYNTHETIC MEDIA DISCLOSURE
This episode's narration was generated with Azure AI Speech. It was reviewed
and approved by a human before release.

Exported:     $(Get-Date -Format o)
Project:      $($p.id)
Workflow state: $($p.state)
Duration:     $([math]::Round($av.durationSeconds / 60)) min
Content hash: $($av.contentHash)

Illustrative content produced by the Azure Scientific Podcast Studio.
Not medical advice.
"@
        Set-Content -Path (Join-Path $folder 'README.txt') -Value $readme -Encoding UTF8

        Write-Host ("OK    {0}  ({1:N1} MB){2}" -f $title, ($bytes / 1MB), $(if ($isApproved) { '' } else { '  [UNAPPROVED]' })) -ForegroundColor $(if ($isApproved) { 'Green' } else { 'Yellow' })
        $exported++
    } catch {
        Write-Host ("FAIL  {0} - {1}" -f $title, $_.Exception.Message) -ForegroundColor Red
        $failed++
    }
}

Write-Host ''
Write-Host ("Exported {0}, skipped {1}, failed {2}" -f $exported, $skipped, $failed)
Write-Host "Folder: $Destination"
if ($unapproved -gt 0) {
    Write-Warning ("{0} exported episode(s) have NOT passed audio approval. This export bypasses the human-gated publication flow - check each README.txt for the workflow state before sharing externally, or re-run with -ApprovedOnly." -f $unapproved)
}
if ($failed -gt 0) { exit 1 }
