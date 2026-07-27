$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting ApiBaseUrl
$base = $Studio.ApiBaseUrl
$out = Join-Path $env:TEMP 'podstudio-smoke-out.txt'
if (Test-Path $out) { Remove-Item $out }

function Req {
  param([string]$Method, [string]$Path, [hashtable]$Headers = @{}, $Body = $null)
  $url = "$base$Path"
  try {
    if ($null -ne $Body) {
      $r = Invoke-WebRequest -Method $Method -Uri $url -Headers $Headers -Body $Body -ContentType 'application/json' -UseBasicParsing
    } else {
      $r = Invoke-WebRequest -Method $Method -Uri $url -Headers $Headers -UseBasicParsing
    }
    return @{ status = [int]$r.StatusCode; body = $r.Content }
  } catch {
    $resp = $_.Exception.Response
    if ($null -eq $resp) { return @{ status = -1; body = $_.Exception.Message } }
    $status = [int]$resp.StatusCode
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $content = $sr.ReadToEnd()
    return @{ status = $status; body = $content }
  }
}

$results = New-Object System.Collections.ArrayList
function Check {
  param([string]$Desc, [int]$Expected, $Res)
  $ok = ($Res.status -eq $Expected)
  $line = "{0}: {1} (expected {2}, got {3})" -f ($(if ($ok) {'PASS'} else {'FAIL'})), $Desc, $Expected, $Res.status
  [void]$results.Add($line)
}

$creator = @{ 'x-actor-id'='user-avery'; 'x-actor-name'='Avery Ng'; 'x-actor-roles'='Creator' }
$audioRev = @{ 'x-actor-id'='user-avery'; 'x-actor-name'='Avery Ng'; 'x-actor-roles'='AudioReviewer' }
$publisher = @{ 'x-actor-id'='user-avery'; 'x-actor-name'='Avery Ng'; 'x-actor-roles'='Publisher' }
$now = (Get-Date).ToString('o')

function NewProject {
  param([string]$Id, [string]$State)
  return @{
    id = $Id; version = 1; parentVersionId = $null
    createdBy = @{ id='user-avery'; displayName='Avery Ng'; roles=@('Creator') }
    createdAt = $now
    modifiedBy = @{ id='user-avery'; displayName='Avery Ng'; roles=@('Creator') }
    modifiedAt = $now; contentHash = $null
    title = 'Smoke'; topic = 'test'; miniPrompt = 'test'; state = $State
    outputLocale = 'en-US'; scriptForm = 'dialogue'; therapeuticArea = 'test'
    audience = 'clinicians'; targetDurationMinutes = 5; ownerId = 'user-avery'; tags = @()
  } | ConvertTo-Json -Depth 6
}

$p1 = 'proj-smoke-1'; $p2 = 'proj-smoke-2'; $p3 = 'proj-smoke-3'
$capturedAudits = New-Object System.Collections.ArrayList

# 0. Health
$h = Req GET '/healthz'
Check 'health endpoint 200' 200 $h

# 1. Create p1 (DRAFT)
Check 'create p1 DRAFT via generic upsert' 200 (Req POST '/api/collections/projects' $creator (NewProject $p1 'DRAFT'))

# 2. Transition DRAFT -> RESEARCH_CONFIGURED as Creator (200) + capture audit
$t1 = Req POST "/api/projects/$p1/transition" $creator (@{ to='RESEARCH_CONFIGURED' } | ConvertTo-Json)
Check 'transition DRAFT->RESEARCH_CONFIGURED as Creator' 200 $t1
try { $j = $t1.body | ConvertFrom-Json; if ($j.audit.id) { [void]$capturedAudits.Add($j.audit.id); [void]$results.Add("INFO: audit written id=$($j.audit.id) state=$($j.project.state)") } } catch {}

# 3. Wrong role: RESEARCH_CONFIGURED -> RESEARCH_RUNNING as AudioReviewer (403)
Check 'transition as wrong role (AudioReviewer) -> 403' 403 (Req POST "/api/projects/$p1/transition" $audioRev (@{ to='RESEARCH_RUNNING' } | ConvertTo-Json))

# 4. Illegal edge: RESEARCH_CONFIGURED -> PUBLISHED as Creator (422)
Check 'illegal edge RESEARCH_CONFIGURED->PUBLISHED -> 422' 422 (Req POST "/api/projects/$p1/transition" $creator (@{ to='PUBLISHED' } | ConvertTo-Json))

# 5. Generic upsert state bypass -> 409
Check 'generic upsert state-change bypass -> 409' 409 (Req POST '/api/collections/projects' $creator (NewProject $p1 'PUBLISHED'))

# 6. QA gate: p2 at AUDIO_REVIEW + blocking quality report -> AUDIO_APPROVED = 409
Check 'create p2 at AUDIO_REVIEW' 200 (Req POST '/api/collections/projects' $creator (NewProject $p2 'AUDIO_REVIEW'))
$qr = @{ id='qr-smoke-1'; version=1; parentVersionId=$null; createdBy=@{id='sys';displayName='sys';roles=@()}; createdAt=$now; modifiedBy=@{id='sys';displayName='sys';roles=@()}; modifiedAt=$now; contentHash=$null; projectId=$p2; audioVersionId='av-x'; overallConfidence=0.5; transcriptPath=$null; termChecks=@(); audioChecks=@(); hasBlockingIssues=$true } | ConvertTo-Json -Depth 6
Check 'create blocking qualityReport' 200 (Req POST '/api/collections/qualityReports' $creator $qr)
Check 'QA gate blocks AUDIO_APPROVED -> 409' 409 (Req POST "/api/projects/$p2/transition" $audioRev (@{ to='AUDIO_APPROVED' } | ConvertTo-Json))

# 7. Publish gates: p3 at READY_TO_PUBLISH
Check 'create p3 at READY_TO_PUBLISH' 200 (Req POST '/api/collections/projects' $creator (NewProject $p3 'READY_TO_PUBLISH'))
# 7a. Publish as Creator (not Publisher) -> 403
Check 'publish as non-Publisher -> 403' 403 (Req POST "/api/projects/$p3/publish" $creator (@{ audioVersionId='av1'; scriptVersionId='sv1'; channel='internal-link'; recipientIds=@('rcpt-1'); disclosureStatement='AI-generated audio.'; acceptedSourceIds=@(); expiresAt=$null } | ConvertTo-Json))
# 7b. Publish as Publisher, empty disclosure -> 422
Check 'publish missing disclosure -> 422' 422 (Req POST "/api/projects/$p3/publish" $publisher (@{ audioVersionId='av1'; scriptVersionId='sv1'; channel='internal-link'; recipientIds=@('rcpt-1'); disclosureStatement=''; acceptedSourceIds=@(); expiresAt=$null } | ConvertTo-Json))
# 7c. Publish as Publisher, no recipients -> 422
Check 'publish no recipients -> 422' 422 (Req POST "/api/projects/$p3/publish" $publisher (@{ audioVersionId='av1'; scriptVersionId='sv1'; channel='internal-link'; recipientIds=@(); disclosureStatement='AI-generated audio.'; acceptedSourceIds=@(); expiresAt=$null } | ConvertTo-Json))
# 7d. Publish valid -> 201
$pub = Req POST "/api/projects/$p3/publish" $publisher (@{ audioVersionId='av1'; scriptVersionId='sv1'; channel='internal-link'; recipientIds=@('rcpt-1','rcpt-2'); disclosureStatement='This audio was generated by AI.'; acceptedSourceIds=@('src-1'); expiresAt=$null } | ConvertTo-Json)
Check 'publish valid -> 201' 201 $pub
$pubId = $null; $receiptIds = @()
try { $pj = $pub.body | ConvertFrom-Json; $pubId = $pj.publication.id; $receiptIds = $pj.receipts | ForEach-Object { $_.id }; if ($pj.audit.id) { [void]$capturedAudits.Add($pj.audit.id) }; [void]$results.Add("INFO: pub=$pubId receipts=$($receiptIds.Count) projState=$($pj.project.state)") } catch { [void]$results.Add("WARN: could not parse publish body") }
# 7e. Publication immutability: overwrite via generic upsert -> 409
if ($pubId) {
  $dupPub = @{ id=$pubId; projectId=$p3; version=1; parentVersionId=$null; createdBy=@{id='x';displayName='x';roles=@()}; createdAt=$now; modifiedBy=@{id='x';displayName='x';roles=@()}; modifiedAt=$now; contentHash=$null; revoked=$true } | ConvertTo-Json -Depth 6
  Check 'publication immutable (overwrite -> 409)' 409 (Req POST '/api/collections/publications' $publisher $dupPub)
}

# --- Cleanup ---
[void]$results.Add('--- cleanup ---')
Req DELETE "/api/collections/projects/$p1" | Out-Null
Req DELETE "/api/collections/projects/$p2" | Out-Null
Req DELETE "/api/collections/projects/$p3" | Out-Null
Req DELETE "/api/collections/qualityReports/qr-smoke-1?pk=$p2" | Out-Null
if ($pubId) { Req DELETE "/api/collections/publications/$pubId?pk=$p3" | Out-Null }
foreach ($rid in $receiptIds) { Req DELETE "/api/collections/deliveryReceipts/$rid?pk=$pubId" | Out-Null }
foreach ($aid in $capturedAudits) {
  Req DELETE "/api/collections/auditEvents/$aid`?pk=$p1" | Out-Null
  Req DELETE "/api/collections/auditEvents/$aid`?pk=$p3" | Out-Null
}
# Verify projects clean
$boot = Req GET '/api/bootstrap'
try { $b = $boot.body | ConvertFrom-Json; $pc = ($b.collections.projects | Where-Object { $_.id -like 'proj-smoke-*' }).Count; [void]$results.Add("INFO: remaining smoke projects=$pc (persistence=$($b.persistence))") } catch {}

$results | Set-Content -Path $out
Get-Content $out
