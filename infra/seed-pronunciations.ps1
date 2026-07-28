<#
.SYNOPSIS
  Load the pronunciation library from sample-data/pronunciation-seed.json into
  Cosmos DB via the deployed API.

.DESCRIPTION
  The SPA ships a seeded pronunciation library in its client bundle, but those
  entries live only in the browser. Closed-loop pronunciation QA runs
  server-side, so unless the library is also in Cosmos the QA finds **zero**
  terms to check and reports a vacuous "100% confidence, 0/0 terms verified".

  This script closes that gap: it upserts each seed entry through
  POST /api/collections/pronunciationEntries (partitioned by locale).

  Entries are REVIEW CANDIDATES, not authoritative pronunciations. Only entries
  with inGoldenSet=true are checked by QA, and a mismatch on one of those BLOCKS
  audio approval - so the golden set is deliberately limited to genuinely
  pronunciation-critical terms (drug names), not every long compound word.

.PARAMETER SeedFile
  Path to the seed JSON. Defaults to sample-data/pronunciation-seed.json.

.PARAMETER WhatIf
  Show what would be sent without writing anything.

.EXAMPLE
  $env:PODSTUDIO_API_BASE_URL = 'https://<api>.azurecontainerapps.io'
  ./infra/seed-pronunciations.ps1
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SeedFile
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting ApiBaseUrl
$base = $Studio.ApiBaseUrl

if (-not $SeedFile) { $SeedFile = Join-Path $PSScriptRoot '..\sample-data\pronunciation-seed.json' }
if (-not (Test-Path $SeedFile)) { throw "Seed file not found: $SeedFile" }

# Administrator role: writing the shared lexicon is a curation action.
$headers = @{
    'x-actor-id'    = 'u-seed'
    'x-actor-name'  = 'Pronunciation Seed'
    'x-actor-roles' = 'Administrator'
}

$seed = Get-Content $SeedFile -Raw -Encoding UTF8 | ConvertFrom-Json
# Skip any structural/comment-only objects.
$entries = @($seed.entries | Where-Object { $_.canonicalForm })

Write-Host "Source : $SeedFile"
Write-Host "Target : $base"
Write-Host "Entries: $($entries.Count)"
Write-Host ''

function Get-StableId {
    param([string]$Canonical, [string]$Locale)
    $slug = ($Canonical.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
    return "pron-$Locale-$slug".ToLowerInvariant()
}

function Get-ContentHash {
    param([string]$Value)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Value))
        return 'sha256:' + (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally { $sha.Dispose() }
}

$now = (Get-Date).ToUniversalTime().ToString('o')
$actor = @{ id = 'u-seed'; displayName = 'Pronunciation Seed'; roles = @('Administrator') }

$ok = 0; $failed = 0; $golden = 0

foreach ($e in $entries) {
    $locale = if ($e.locale) { $e.locale } else { 'de-DE' }
    $doc = [ordered]@{
        id               = Get-StableId -Canonical $e.canonicalForm -Locale $locale
        version          = 1
        parentVersionId  = $null
        createdBy        = $actor
        createdAt        = $now
        modifiedBy       = $actor
        modifiedAt       = $now
        contentHash      = Get-ContentHash ($e.canonicalForm + $e.ipa + $e.spokenForm)
        canonicalForm    = $e.canonicalForm
        locale           = $locale
        spokenForm       = $e.spokenForm
        ipa              = $e.ipa
        phonemeAlphabet  = $(if ($e.ipa) { 'ipa' } else { $null })
        audioReferencePath = $null
        therapeuticArea  = $e.therapeuticArea
        tags             = @($e.tags)
        approvalStatus   = $e.approvalStatus
        rationale        = $e.rationale
        inGoldenSet      = [bool]$e.inGoldenSet
        createdFromProjectId = $null
    }

    if ($e.inGoldenSet) { $golden++ }

    if ($PSCmdlet.ShouldProcess($e.canonicalForm, 'upsert pronunciation entry')) {
        try {
            $json  = $doc | ConvertTo-Json -Depth 6 -Compress
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            Invoke-WebRequest -Method POST -Uri "$base/api/collections/pronunciationEntries" `
                -Headers $headers -ContentType 'application/json; charset=utf-8' `
                -Body $bytes -UseBasicParsing | Out-Null
            $flag = if ($e.inGoldenSet) { '[golden]' } else { '' }
            Write-Host ("OK    {0,-24} -> {1,-30} {2}" -f $e.canonicalForm, $e.spokenForm, $flag) -ForegroundColor Green
            $ok++
        } catch {
            Write-Host ("FAIL  {0,-24} - {1}" -f $e.canonicalForm, $_.Exception.Message) -ForegroundColor Red
            $failed++
        }
    }
}

Write-Host ''
Write-Host ("Seeded {0}, failed {1}. {2} entries are in the golden set (checked by QA, blocking on mismatch)." -f $ok, $failed, $golden)
if ($failed -gt 0) { exit 1 }
