$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$o = Join-Path $env:TEMP 'foundry-probe5.txt'
if (Test-Path $o) { Remove-Item $o }
. "$PSScriptRoot/../_env.ps1"
Assert-StudioSetting FoundryProjectEndpoint
$proj = $Studio.FoundryProjectEndpoint
$tok = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv 2>&1
$H = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }

$prompt = @'
Write a host-expert podcast script in locale en-US about: Doravirine/Islatravir switch study.
Target length: about 3 minutes.

Return ONLY valid JSON (no markdown, no code fences, no commentary) with EXACTLY this shape:
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

$body = @{ agent_reference = @{ type = 'agent_reference'; name = 'podcast-script-generator' }; input = $prompt } | ConvertTo-Json -Depth 6
try {
  $r = Invoke-WebRequest -Method POST -Uri "$proj/openai/v1/responses" -Headers $H -Body $body -UseBasicParsing
  $resp = $r.Content | ConvertFrom-Json
  "status=$($resp.status)" | Add-Content $o
  $texts = @()
  foreach ($item in $resp.output) {
    if ($item.type -eq 'message') {
      foreach ($c in $item.content) { if ($c.type -eq 'output_text') { $texts += $c.text } }
    }
  }
  "== joined output_text ==" | Add-Content $o
  ($texts -join "`n") | Add-Content $o
} catch {
  $s = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 }
  "ERR $s : $($_.ErrorDetails.Message)" | Add-Content $o
}
Get-Content $o
