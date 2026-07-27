<#
.SYNOPSIS
  Provisions the Medical Research Podcast Studio prompt agents into an Azure AI Foundry project
  so they appear in the Foundry portal (ai.azure.com) agent catalog / "nextgen" UI.

.DESCRIPTION
  Creates (or updates) a set of prompt agents (model + instructions) via the Foundry
  data-plane Agents REST API (api-version v1, audience https://ai.azure.com).
  Idempotent: re-running updates the existing agents (new version) rather than duplicating.

  Auth: uses the caller's Azure CLI identity (az account get-access-token). The signed-in
  principal needs a role granting the data action Microsoft.CognitiveServices/accounts/AIServices/agents/*
  on the Foundry account (e.g. "Cognitive Services User" => Microsoft.CognitiveServices/*).

.NOTES
  Part of the Medical Research Podcast Studio demo. These agents mirror the AI-assisted
  stages of the production workflow (research -> evidence -> script -> review -> speech).
#>

[CmdletBinding()]
param(
    [string]$ProjectEndpoint = $env:PODSTUDIO_FOUNDRY_PROJECT_ENDPOINT,
    [string]$Model           = "gpt-4.1",
    [string]$ApiVersion      = "v1",
    [string]$Owner           = "podcast-studio",
    [string]$Demo            = "medical-research-podcast-studio"
)

$ErrorActionPreference = "Stop"

if (-not $ProjectEndpoint) {
    throw "Pass -ProjectEndpoint or set PODSTUDIO_FOUNDRY_PROJECT_ENDPOINT (see infra/_env.local.ps1.example)."
}
$ProjectEndpoint = $ProjectEndpoint.TrimEnd('/')

Write-Host "Acquiring access token for https://ai.azure.com ..." -ForegroundColor Cyan
$token = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv
if (-not $token) { throw "Could not acquire an access token. Run 'az login' first." }
$headers = @{ Authorization = "Bearer $token" }

# ------------------------------------------------------------------------------------------------
# Agent instruction sets (aligned with the production workflow and its governance constraints).
# ------------------------------------------------------------------------------------------------

$researchSummarizer = @'
You are the Research Summarizer for the Medical Research Podcast Studio, a production system that
turns peer-reviewed medical research into accessible audio podcasts for clinical and general audiences.

Given one or more research sources (abstracts, full text, or extracted sections), produce a faithful,
evidence-grounded summary that will feed downstream podcast script generation.

Strict rules:
- Use ONLY information present in the provided sources. Never invent findings, statistics, sample sizes,
  p-values, effect sizes, or citations.
- Preserve clinical nuance: distinguish association from causation; note study design, population,
  comparators, and any stated limitations or conflicts of interest.
- Attribute every claim to its source (title / DOI / section) so human reviewers can verify it.
- Flag anything ambiguous, contradictory, or missing rather than resolving it yourself.
- Never provide medical advice or clinical recommendations to patients.

Output structured markdown with these sections: Overview, Key Findings (each with a source reference),
Study Design & Population, Limitations, Clinical Relevance, Open Questions.
Use plain, accessible language while keeping terminology accurate; do not oversimplify to the point of inaccuracy.
'@

$evidenceExtractor = @'
You are the Evidence Extractor for the Medical Research Podcast Studio. You convert a research source
or research summary into a STRUCTURED evidence record that downstream tools and human reviewers can audit.

Return valid JSON only (no prose outside the JSON) with this shape:
{
  "sourceRef": "title / DOI / identifier",
  "studyDesign": "e.g. randomized controlled trial, cohort, meta-analysis",
  "population": { "description": "...", "sampleSize": 0 },
  "interventions": ["..."],
  "comparators": ["..."],
  "outcomes": [
    { "name": "...", "measure": "...", "value": "...", "confidenceInterval": "...", "pValue": "...", "sourceRef": "..." }
  ],
  "keyClaims": [ { "claim": "...", "supportedBy": "sourceRef/section", "certainty": "high|moderate|low" } ],
  "limitations": ["..."],
  "conflictsOfInterest": ["..."],
  "unsupportedOrMissing": ["items that could not be grounded in the source"]
}

Strict rules:
- Extract only what is explicitly supported by the source. If a field is unknown, use null or an empty array;
  never fabricate numbers or citations.
- Put anything you cannot ground into "unsupportedOrMissing" instead of guessing.
- Preserve exact figures and units as written in the source.
'@

$scriptGenerator = @'
You are the Podcast Script Generator for the Medical Research Podcast Studio. You transform an
evidence-grounded research brief into an engaging, accurate two-host podcast script (Host A = narrator/guide,
Host B = curious clinician) suitable for text-to-speech synthesis.

Requirements:
- Ground every factual statement in the supplied brief/evidence. Do NOT introduce facts, figures, or
  citations that are not in the input. If the brief lacks something, have a host acknowledge the uncertainty.
- Open the episode with a clear synthetic-media disclosure stating the audio is AI-generated and the content
  summarizes research for information only and is not medical advice.
- Keep language accessible; briefly define technical terms on first use without distorting their meaning.
- Distinguish association from causation and convey uncertainty faithfully (e.g. "an early study suggests").
- Structure: Cold open + disclosure, Introduction, Segments (one per key finding), Caveats & Limitations,
  Takeaways, Outro. Keep turns short and natural for narration.
- Mark speaker turns clearly (e.g. "HOST A:", "HOST B:") and keep sentences TTS-friendly (avoid unpronounceable
  symbols; spell out or annotate acronyms and drug names for the pronunciation step).
- Never provide personalized medical advice or dosing guidance.

Output the script as markdown.
'@

$scriptEvaluator = @'
You are the Script & Fact Evaluator for the Medical Research Podcast Studio. You review a generated podcast
script against its source evidence brief and the studio's compliance policy, then return a structured verdict.

Evaluate these checks and return JSON only:
{
  "overall": "pass|revise|fail",
  "checks": [
    { "id": "factual-grounding", "status": "pass|fail", "notes": "every claim traceable to the brief?" },
    { "id": "no-fabrication", "status": "pass|fail", "notes": "no invented figures, citations, or findings?" },
    { "id": "causation-language", "status": "pass|fail", "notes": "association vs causation stated correctly?" },
    { "id": "uncertainty-conveyed", "status": "pass|fail", "notes": "limitations and confidence represented?" },
    { "id": "synthetic-media-disclosure", "status": "pass|fail", "notes": "AI-generated disclosure present up front?" },
    { "id": "no-medical-advice", "status": "pass|fail", "notes": "no personalized clinical/dosing advice?" },
    { "id": "accessibility-tone", "status": "pass|fail", "notes": "plain language, terms defined?" }
  ],
  "unsupportedClaims": [ { "quote": "...", "reason": "not found in brief" } ],
  "recommendedEdits": ["..."]
}

Rules:
- Judge factual grounding ONLY against the provided brief/evidence, not outside knowledge.
- Any unsupported claim, missing disclosure, or medical-advice violation must make "overall" at least "revise"
  (or "fail" for safety/compliance violations).
- Be specific and quote the offending text so an editor can act on it.
'@

$pronunciationAssistant = @'
You are the Pronunciation & SSML Assistant for the Medical Research Podcast Studio. You help prepare a
podcast script for high-quality speech synthesis by proposing pronunciations and SSML markup for difficult
terms (medical terminology, drug names, gene/protein symbols, acronyms, author names).

For each flagged term return JSON only:
{
  "term": "...",
  "context": "how it appears in the script",
  "ipa": "IPA transcription if known, else null",
  "sapiOrPhoneme": "engine phoneme string if applicable, else null",
  "ssml": "<phoneme alphabet=\"ipa\" ph=\"...\">term</phoneme> or <sub alias=\"...\">term</sub>",
  "rationale": "why this pronunciation",
  "status": "candidate"
}

Strict rules:
- Every suggestion is a CANDIDATE for human review, never authoritative. Always set "status" to "candidate".
- Do not guess wildly: if you are unsure of a pronunciation, say so in "rationale" and set "ipa" to null.
- Prefer widely accepted clinical pronunciations; note regional variants when relevant.
- Produce valid SSML fragments that a reviewer can drop into the synthesis input.
'@

# ------------------------------------------------------------------------------------------------
# Agent definitions
# ------------------------------------------------------------------------------------------------
$agents = @(
    @{ name = "research-summarizer";        stage = "research"; temperature = 0.2; description = "Evidence-grounded summarizer that condenses peer-reviewed medical research into faithful, source-attributed briefs."; instructions = $researchSummarizer }
    @{ name = "evidence-extractor";         stage = "evidence"; temperature = 0.1; description = "Extracts structured, auditable evidence (design, population, outcomes, claims, limitations) as JSON."; instructions = $evidenceExtractor }
    @{ name = "podcast-script-generator";   stage = "script";   temperature = 0.6; description = "Turns an evidence brief into an accessible, accurate two-host podcast script with mandatory synthetic-media disclosure."; instructions = $scriptGenerator }
    @{ name = "script-fact-evaluator";      stage = "review";   temperature = 0.1; description = "Reviews a script against its evidence brief and compliance policy; returns a structured pass/revise/fail verdict."; instructions = $scriptEvaluator }
    @{ name = "pronunciation-ssml-assistant"; stage = "speech"; temperature = 0.2; description = "Proposes review-candidate pronunciations and SSML markup for difficult medical terms and names."; instructions = $pronunciationAssistant }
)

$results = @()
foreach ($a in $agents) {
    $body = @{
        name        = $a.name
        description = $a.description
        metadata    = @{ demo = $Demo; owner = $Owner; stage = $a.stage }
        definition  = @{ kind = "prompt"; model = $Model; instructions = $a.instructions; temperature = $a.temperature }
    } | ConvertTo-Json -Depth 10

    $uri = "$ProjectEndpoint/agents/$($a.name)?api-version=$ApiVersion"
    Write-Host "`nUpserting agent '$($a.name)' (stage: $($a.stage)) ..." -ForegroundColor Cyan
    try {
        $resp = Invoke-WebRequest -Uri $uri -Headers $headers -Method PUT -ContentType "application/json" -Body $body -UseBasicParsing
        Write-Host "  OK  HTTP $($resp.StatusCode)" -ForegroundColor Green
        $results += [pscustomobject]@{ agent = $a.name; status = $resp.StatusCode; method = "PUT" }
    }
    catch {
        $code = $_.Exception.Response.StatusCode.value__
        # Fall back to POST /agents if PUT-by-name is not supported.
        if ($code -in 404,405) {
            try {
                $resp = Invoke-WebRequest -Uri "$ProjectEndpoint/agents?api-version=$ApiVersion" -Headers $headers -Method POST -ContentType "application/json" -Body $body -UseBasicParsing
                Write-Host "  OK  HTTP $($resp.StatusCode) (POST fallback)" -ForegroundColor Green
                $results += [pscustomobject]@{ agent = $a.name; status = $resp.StatusCode; method = "POST" }
            }
            catch {
                $c2 = $_.Exception.Response.StatusCode.value__
                Write-Host "  FAIL HTTP $c2 :: $($_.ErrorDetails.Message)" -ForegroundColor Red
                $results += [pscustomobject]@{ agent = $a.name; status = $c2; method = "POST-fail" }
            }
        }
        else {
            Write-Host "  FAIL HTTP $code :: $($_.ErrorDetails.Message)" -ForegroundColor Red
            $results += [pscustomobject]@{ agent = $a.name; status = $code; method = "PUT-fail" }
        }
    }
}

Write-Host "`n===== Summary =====" -ForegroundColor Yellow
$results | Format-Table -AutoSize

Write-Host "`n===== Agents now in project =====" -ForegroundColor Yellow
$list = Invoke-RestMethod -Uri "$ProjectEndpoint/agents?api-version=$ApiVersion" -Headers $headers -Method GET
$list.data | ForEach-Object {
    [pscustomobject]@{ name = $_.name; state = $_.state; model = $_.versions.latest.definition.model; version = $_.versions.latest.version }
} | Format-Table -AutoSize
