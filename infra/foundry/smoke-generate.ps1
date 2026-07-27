# Smoke test: real Foundry grounded script generation via POST /api/projects/:id/generate-script
# Seeds a project + structured evidence + accepted claims, generates a grounded
# script with the deployed podcast-script-generator agent, checks grounding and
# role enforcement, then cleans up all test data.
$ProgressPreference = 'SilentlyContinue'
. "$PSScriptRoot/../_env.ps1"
Assert-StudioSetting ApiBaseUrl
$base = $Studio.ApiBaseUrl
$creator  = @{ 'x-actor-id' = 'u-smoke';  'x-actor-name' = 'Smoke Creator';  'x-actor-roles' = 'Creator' }
$reviewer = @{ 'x-actor-id' = 'u-smoke2'; 'x-actor-name' = 'Smoke Reviewer'; 'x-actor-roles' = 'AudioReviewer' }
$pass = 0; $fail = 0
function Check($name, $cond, $detail) {
  if ($cond) { Write-Host ("PASS  {0}" -f $name) -ForegroundColor Green; $script:pass++ }
  else { Write-Host ("FAIL  {0}  -- {1}" -f $name, $detail) -ForegroundColor Red; $script:fail++ }
}
function Req($method, $url, $headers, $body) {
  try {
    $p = @{ Method = $method; Uri = $url; Headers = $headers; UseBasicParsing = $true }
    if ($null -ne $body) { $p.Body = $body; $p.ContentType = 'application/json' }
    $resp = Invoke-WebRequest @p
    return @{ status = [int]$resp.StatusCode; body = $resp.Content }
  } catch {
    $code = 0; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    return @{ status = $code; body = $_.ErrorDetails.Message }
  }
}

$projId  = 'proj-smoke-gen'
$emptyId = 'proj-smoke-empty'

# 0) Health
$h = Req 'GET' "$base/healthz" $null $null
$hs = ($h.body | ConvertFrom-Json).services
Check 'health foundry:true' ($hs.foundry -eq $true) $h.body

# 1) Seed project with grounding material
$proj = @{ id = $projId; entity = 'project'; title = 'In vivo CRISPR base editing for transthyretin amyloidosis'
  topic = 'Early-phase gene editing trial'; state = 'SCRIPT_DRAFT'; scriptForm = 'host-expert'
  outputLocale = 'en-US'; targetDurationMinutes = 6 } | ConvertTo-Json
$r = Req 'POST' "$base/api/collections/projects" $creator $proj
Check 'seed project' ($r.status -eq 200) "$($r.status) $($r.body)"

$ev = @{ id = 'se-smoke'; projectId = $projId
  researchQuestion = 'Does a single dose of an in vivo CRISPR base editor reduce serum transthyretin?'
  studyDesign = 'Phase 1 open-label single-ascending-dose study'
  population = '10 adults with hereditary transthyretin amyloid polyneuropathy'
  interventionComparator = 'Single intravenous infusion; no concurrent comparator arm'
  endpoints = @('Serum TTR reduction at day 28', 'Treatment-emergent adverse events')
  efficacyResults = @('Mean serum TTR reduction of 87 percent at the highest dose by day 28')
  safetyResults = @('Mostly mild infusion-related reactions; one transient grade 3 liver enzyme elevation')
  limitations = @('Very small sample size', 'No control arm', 'Only 28-day follow-up')
  uncertainty = @('Durability of effect beyond 28 days is unknown', 'Long-term off-target effects are not yet characterized')
  disclosureRequirements = @('State that this is an early-phase investigational therapy', 'Note that voices are AI-generated') } | ConvertTo-Json
$r = Req 'POST' "$base/api/collections/structuredEvidence" $creator $ev
Check 'seed structured evidence' ($r.status -eq 200) "$($r.status) $($r.body)"

$claimSet = @(
  @{ id = 'clm-smoke-eff'; projectId = $projId; kind = 'reported-fact'; excluded = $false
     statement = 'At the highest dose, mean serum transthyretin fell by 87 percent at day 28.' },
  @{ id = 'clm-smoke-safety'; projectId = $projId; kind = 'reported-fact'; excluded = $false
     statement = 'Adverse events were mostly mild infusion reactions, with one transient grade 3 liver enzyme rise.' },
  @{ id = 'clm-smoke-interp'; projectId = $projId; kind = 'author-interpretation'; excluded = $false
     statement = 'These early results suggest in vivo base editing could become a one-time treatment, though that is not yet proven.' }
)
foreach ($c in $claimSet) {
  $r = Req 'POST' "$base/api/collections/claims" $creator ($c | ConvertTo-Json)
  Check "seed claim $($c.id)" ($r.status -eq 200) "$($r.status) $($r.body)"
}
$acceptedIds = $claimSet | ForEach-Object { $_.id }

# 2) Generate grounded script as Creator
Write-Host "`nGenerating grounded script (calling Foundry agent)..." -ForegroundColor Cyan
$g = Req 'POST' "$base/api/projects/$projId/generate-script" $creator '{}'
Check 'generate-script returns 200' ($g.status -eq 200) "$($g.status) $($g.body)"
if ($g.status -eq 200) {
  $out = $g.body | ConvertFrom-Json
  $seg = $out.script.segments
  Check 'script has >= 2 segments' ($seg.Count -ge 2) "count=$($seg.Count)"
  $first = $seg[0]
  Check 'first segment is disclosure (no claim ids)' (($first.claimIds | Measure-Object).Count -eq 0) "claimIds=$($first.claimIds -join ',')"
  $cited = @(); foreach ($s in $seg) { $cited += $s.claimIds }
  $cited = $cited | Where-Object { $_ } | Select-Object -Unique
  $bad = $cited | Where-Object { $acceptedIds -notcontains $_ }
  Check 'all cited claim ids are within accepted set' (($bad | Measure-Object).Count -eq 0) "unexpected=$($bad -join ',')"
  Check 'at least one claim was cited' (($cited | Measure-Object).Count -ge 1) "cited=$($cited -join ',')"
  Check 'audit event is script.generated' ($out.audit.eventType -eq 'script.generated') "$($out.audit.eventType)"
  Write-Host ("  title: {0}" -f $out.script.title)
  Write-Host ("  segments: {0} | speakers: {1}" -f $seg.Count, (($out.script.speakers.label) -join ', '))
  Write-Host ("  cited claim ids: {0}" -f ($cited -join ', '))
  Write-Host ("  first segment: {0}" -f ($first.text.Substring(0, [Math]::Min(160, $first.text.Length))))
  $genScriptId = $out.script.id
  $genAuditId  = $out.audit.id
}

# 3) Grounding enforcement: a project with no evidence/claims must be refused (422)
$empty = @{ id = $emptyId; entity = 'project'; title = 'Empty smoke project'; state = 'SCRIPT_DRAFT'
  scriptForm = 'plain-narration'; outputLocale = 'en-US'; targetDurationMinutes = 4 } | ConvertTo-Json
Req 'POST' "$base/api/collections/projects" $creator $empty | Out-Null
$e = Req 'POST' "$base/api/projects/$emptyId/generate-script" $creator '{}'
Check 'no-grounding project returns 422' ($e.status -eq 422) "$($e.status) $($e.body)"

# 4) Role enforcement: non-Creator must be refused (403)
$rr = Req 'POST' "$base/api/projects/$projId/generate-script" $reviewer '{}'
Check 'non-Creator returns 403' ($rr.status -eq 403) "$($rr.status) $($rr.body)"

# 5) Cleanup
Write-Host "`nCleaning up test data..." -ForegroundColor Cyan
if ($genScriptId) { Req 'DELETE' "$base/api/collections/scripts/$genScriptId`?pk=$projId" $creator $null | Out-Null }
if ($genAuditId)  { Req 'DELETE' "$base/api/collections/auditEvents/$genAuditId`?pk=$projId" $creator $null | Out-Null }
foreach ($c in $claimSet) { Req 'DELETE' "$base/api/collections/claims/$($c.id)`?pk=$projId" $creator $null | Out-Null }
Req 'DELETE' "$base/api/collections/structuredEvidence/se-smoke`?pk=$projId" $creator $null | Out-Null
Req 'DELETE' "$base/api/collections/projects/$projId`?pk=$projId" $creator $null | Out-Null
Req 'DELETE' "$base/api/collections/projects/$emptyId`?pk=$emptyId" $creator $null | Out-Null
Write-Host 'Cleanup done.'

$resultColor = if ($fail -eq 0) { 'Green' } else { 'Red' }
Write-Host ("`nRESULT: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $resultColor
