$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$o = Join-Path $env:TEMP 'foundry-testrun.txt'
if (Test-Path $o) { Remove-Item $o }
. "$PSScriptRoot/../_env.ps1"
Assert-StudioSetting FoundryProjectEndpoint
$proj = $Studio.FoundryProjectEndpoint
$av = $Studio.FoundryApiVersion
$tok = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv 2>&1
$H = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }

$prompt = @'
Write a host-expert podcast script in locale en-US about: Doravirine/Islatravir switch study.
Target length: about 3 minutes.

Return ONLY valid minified JSON (no markdown, no code fences, no commentary) with EXACTLY this shape:
{"title": string, "segments": [{"speaker": string, "heading": string|null, "directionCue": string|null, "text": string, "claimIds": string[]}]}

Rules:
- Ground every factual statement ONLY in the EVIDENCE and CLAIMS below. Do not add facts not present.
- The FIRST segment must be a synthetic-media disclosure (AI-generated; informational, not medical advice).
- Use ONLY these speaker labels: Host, Expert.
- In "claimIds", cite claims by their EXACT id from the CLAIMS list. Use [] for disclosure/intro/transitions. Never invent ids.
- Write all "text" in en-US. TTS-friendly.

EVIDENCE:
Research question: In suppressed adults with HIV-1, is doravirine/islatravir non-inferior to B/F/TAF at week 48?
Efficacy results: 90% vs 94% suppression at week 48; difference -4pp (95% CI -9 to +1)
Safety results: One DRESS case; HBV reactivation caution; comparable CD4
Limitations: Small sample; short follow-up; exploratory endpoints

CLAIMS (cite by id):
- clm-efficacy [reported-fact]: At week 48, 90% of the doravirine/islatravir arm maintained HIV-1 RNA below 50 copies/mL vs 94% for B/F/TAF.
- clm-safety [reported-fact]: One DRESS case was reported; HBV co-infection requires monitoring; CD4 comparable.
- clm-limits [author-interpretation]: Findings are hypothesis-generating due to small sample, short follow-up, and exploratory endpoints.

REQUIRED DISCLOSURE POINTS:
- This audio was generated using synthetic speech.
- This content is informational and is not medical advice.
'@

try {
  $thread = Invoke-RestMethod -Method POST -Uri "$proj/threads?api-version=$av" -Headers $H -Body '{}'
  "thread=$($thread.id)" | Add-Content $o
  $msgBody = @{ role = 'user'; content = $prompt } | ConvertTo-Json -Depth 5
  Invoke-RestMethod -Method POST -Uri "$proj/threads/$($thread.id)/messages?api-version=$av" -Headers $H -Body $msgBody | Out-Null
  $runBody = @{ agent_id = 'podcast-script-generator' } | ConvertTo-Json
  $run = Invoke-RestMethod -Method POST -Uri "$proj/threads/$($thread.id)/runs?api-version=$av" -Headers $H -Body $runBody
  "run=$($run.id) status=$($run.status)" | Add-Content $o
  $deadline = (Get-Date).AddSeconds(90)
  while ($run.status -in @('queued','in_progress','requires_action')) {
    if ((Get-Date) -gt $deadline) { "TIMEOUT" | Add-Content $o; break }
    Start-Sleep -Milliseconds 1500
    $run = Invoke-RestMethod -Method GET -Uri "$proj/threads/$($thread.id)/runs/$($run.id)?api-version=$av" -Headers $H
  }
  "final status=$($run.status)" | Add-Content $o
  $msgs = Invoke-RestMethod -Method GET -Uri "$proj/threads/$($thread.id)/messages?api-version=$av" -Headers $H
  $assistant = $msgs.data | Where-Object { $_.role -eq 'assistant' } | Select-Object -First 1
  "== assistant content type: $($assistant.content.GetType().Name) ==" | Add-Content $o
  ($assistant.content | ConvertTo-Json -Depth 8) | Add-Content $o
} catch {
  "ERROR: $($_.Exception.Message)" | Add-Content $o
  if ($_.Exception.Response) {
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    "BODY: $($sr.ReadToEnd())" | Add-Content $o
  }
}
Get-Content $o
