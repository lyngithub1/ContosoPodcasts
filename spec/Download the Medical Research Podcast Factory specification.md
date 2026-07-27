# Medical Research Podcast Factory — Build Specification

**Version:** 1.0  
**Target coding agent:** GitHub Copilot Agent Mode using Claude Opus 4.8  
**Primary platform:** Microsoft Azure  
**Frontend:** React + TypeScript SPA  
**Priority order:** Speech quality and medical pronunciation > factual grounding > reviewer control > security/compliance > usability > speed > cost

---

## 0. Instructions to the Coding Agent

You are the lead product designer, UX architect, full-stack engineer, Azure architect, accessibility engineer, test engineer, and DevSecOps engineer for this project.

Build the application described in this specification as a production-oriented, modular solution. Do not reduce the experience to a chat window or a collection of generic forms. Create a polished, coherent scientific media-production workspace.

### Mandatory operating rules

1. Read this entire specification before writing code.
2. Create and maintain a `PLAN.md` with milestones, dependencies, risks, and completion status.
3. Create architecture decision records in `/docs/adr` for consequential implementation choices.
4. Use small, reviewable commits and do not combine unrelated changes.
5. Prefer TypeScript end to end where practical.
6. Use Azure-native managed services unless a requirement explicitly calls for another component.
7. Use managed identity and Microsoft Entra ID; do not put credentials in source code, client bundles, or configuration files.
8. Treat generated scripts, pronunciation overrides, reviewer decisions, research evidence, and published audio as versioned artifacts.
9. Preserve a complete audit trail from user research request through publication.
10. Never publish automatically. Publication requires explicit human approval after audio review.
11. Do not hide uncertainty. Unsupported claims, missing sources, failed pronunciation checks, and unavailable voice features must be visible to the user.
12. Optimize for German and English medical/scientific narration quality, including mixed-language passages.
13. Keep raw SSML available in an advanced panel, but never require normal users to edit SSML.
14. Generate synthetic-audio disclosure metadata and a configurable spoken disclosure.
15. Include seed/demo data based on the attached reference: three script modes—plain narration, structured narration with direction cues, and a two-speaker host/expert discussion.

---

## 1. Product Vision

Create a self-service “research-to-podcast” factory for scientific and healthcare users. The system acquires research material, builds a cited evidence set, drafts a podcast script, supports human review, converts approved text into high-quality speech, lets nontechnical reviewers fine-tune pronunciation and delivery visually, stores the approved media in Azure, and distributes it to selected recipients only after final approval.

The application must feel like a premium scientific production studio rather than an administrative business application.

### Product name

Use the working name **Azure Scientific Podcast Studio**. Isolate product name, logos, color tokens, and legal copy in configuration so branding can be changed without rewriting components.

### Core outcomes

- Turn a topic or mini-prompt into a traceable research collection.
- Generate an evidence-grounded, scientifically credible script.
- Make editorial and medical/legal review explicit and auditable.
- Produce natural English and German audio with trustworthy medical pronunciation.
- Give non-SSML experts intuitive word- and phrase-level speech controls.
- Compare multiple speech models or voices without losing approved script state.
- Store versioned media and securely distribute it to reusable recipient lists.

---

## 2. Users and Roles

Implement role-based access with Microsoft Entra ID groups and application roles.

### Roles

- **Creator** — starts projects, selects sources, generates scripts, requests review, and creates audio previews.
- **Scientific Reviewer** — validates factual accuracy, citations, terminology, and scientific balance.
- **Medical/Legal Reviewer** — reviews disclosures, approved language, safety language, and publication readiness.
- **Audio Reviewer** — reviews pronunciation, voices, pacing, prosody, loudness, and mastering.
- **Publisher** — approves recipient lists and explicitly publishes an approved version.
- **Administrator** — manages source allowlists, vocabularies, voice/model availability, retention, templates, and distribution channels.
- **Auditor/Read-only** — can inspect evidence, versions, decisions, and publication history but cannot alter content.

One user may hold multiple roles. Enforce least privilege server-side, not only in the SPA.

---

## 3. End-to-End Workflow and State Machine

Use a durable workflow with the following states:

`DRAFT` → `RESEARCH_CONFIGURED` → `RESEARCH_RUNNING` → `RESEARCH_REVIEW` → `SCRIPT_DRAFT` → `SCRIPT_REVIEW` → `SCRIPT_APPROVED` → `AUDIO_PREVIEW` → `AUDIO_REVIEW` → `AUDIO_APPROVED` → `READY_TO_PUBLISH` → `PUBLISHED`

Rejection paths:

- `RESEARCH_REVIEW` → `RESEARCH_CONFIGURED`
- `SCRIPT_REVIEW` → `SCRIPT_DRAFT`
- `AUDIO_REVIEW` → `SCRIPT_DRAFT` when wording changes are required
- `AUDIO_REVIEW` → `AUDIO_PREVIEW` when delivery-only changes are required
- `READY_TO_PUBLISH` → `AUDIO_REVIEW`

Cancellation or archival is allowed from any non-published state. Published versions are immutable; corrections create a new version and can optionally revoke the prior distribution link.

### Gating rules

- Research cannot be finalized without at least one accepted source.
- Every material scientific claim in the script must map to one or more accepted sources.
- Script generation must not imply approval.
- Audio generation is disabled until a script version is approved.
- Publication is disabled until audio approval, disclosure checks, recipient validation, and distribution review pass.
- A rejection always requires a reason and creates a new task for the appropriate stage.

---

## 4. Functional Requirements

### 4.1 Project creation and research intent

The new-project experience must let the user:

- Enter a project title and short scientific topic.
- Enter a mini-prompt describing the intended research question.
- Select research types:
  - peer-reviewed journal articles
  - systematic reviews/meta-analyses
  - clinical-trial registries
  - regulatory or health-authority publications
  - conference abstracts
  - approved organization documents
  - uploaded PDFs/DOCX/PPTX/TXT/HTML
  - approved websites
  - DOI, PMID, URL, or repository identifier
- Set publication date range, geography, language, study phase, audience, therapeutic area, and evidence hierarchy.
- Choose source policies such as “peer-reviewed only,” “include preprints but label them,” and “exclude non-allowlisted domains.”
- Choose output language and locale:
  - English: at minimum `en-US` and `en-GB`
  - German: at minimum `de-DE`, `de-AT`, and `de-CH`
- Choose script form:
  - plain single-narrator
  - structured single-narrator with delivery cues
  - host/expert discussion
  - configurable custom template
- Choose target duration and audience sophistication.

Show an editable “research plan” before acquisition begins. The user must understand which queries, source categories, filters, and domains the application will use.

### 4.2 Research acquisition

Build a connector abstraction. The first implementation should support:

- User uploads stored in a quarantine container before validation.
- Approved public web URLs.
- DOI/PMID resolution through a configurable research connector.
- Bing-based web search or an approved search API through a server-side adapter.
- Optional enterprise sources through Microsoft Graph/Search adapters when enabled.

For every acquired item capture:

- title, authors, publication, date, DOI/PMID/URL
- source type and evidence class
- acquisition timestamp
- original file hash
- extracted text and page/section anchors
- license/access notes when known
- language
- trust/status flags
- user acceptance/rejection

Do not treat search snippets as final evidence. Retrieve and process source content where permitted. Respect robots, access controls, licenses, paywalls, and configured domain policies.

### 4.3 Evidence workspace

Display sources as a research evidence board with:

- source cards and filters
- accepted, rejected, pending, duplicate, and failed states
- concise source summaries
- extracted key findings
- exact page/section anchors
- evidence-strength and source-type labels
- contradiction and disagreement indicators
- side-by-side comparison of outcomes, population, design, limitations, and safety findings
- user notes

The user can pin or exclude findings before script generation. Excluded evidence remains in the audit record.

### 4.4 Grounded summarization and script creation

Create a structured evidence model before prose generation. At minimum include:

- research question
- study design
- population
- intervention/comparator
- endpoints
- efficacy results
- safety results
- limitations
- uncertainty
- source citations
- pronunciation candidates
- approved disclosure requirements

Script generation must:

- use only accepted evidence
- include claim-level citation mappings in metadata
- distinguish reported facts, author interpretation, and generated transition language
- preserve clinically relevant qualifiers
- avoid treatment recommendations unless the source and approved template explicitly require them
- include limitations and safety context
- produce the selected format
- create spoken-form normalization for numbers, acronyms, units, DOI strings, trial IDs, and drug names
- allow target-duration controls without deleting critical limitations or safety information

Create three seed templates mirroring the attached reference:

1. **Plain narration** — continuous explanatory script.
2. **Structured narration** — sections with friendly delivery directions such as calm, explanatory, deliberate, dynamic, and pauses.
3. **Host/Expert** — clearly assigned speakers and conversational transitions.

### 4.5 Script review

Provide a professional document editor with:

- tracked changes
- comments and @mentions
- paragraph-level citations
- claim-to-source drill-down
- scientific terminology highlighting
- numbers/units/acronyms validation
- pronunciation candidate highlighting
- missing-citation warnings
- change comparison between versions
- approve, reject, request changes, and delegate actions

Every approval records user, role, timestamp, content hash, comments, and approved version.

### 4.6 Pronunciation and speech-quality workbench

This is the highest-priority feature.

#### Nontechnical interaction model

Users must be able to select a word, phrase, sentence, or speaker turn and open a plain-language “How should this sound?” panel.

Provide friendly controls:

- **Pronunciation** — “sounds like,” phonetic spelling, IPA expert mode, play alternatives, save to glossary.
- **Speed** — slower/faster presets plus a bounded slider.
- **Emphasis** — none, subtle, medium, strong.
- **Pause before/after** — none, short, medium, long.
- **Pitch** — lower/higher with safe bounds.
- **Volume impact** — softer/standard/stronger with normalized output protection.
- **Tone/style** — calm, authoritative, explanatory, conversational, cautious, energetic, empathetic, neutral; only show styles supported by the selected voice.
- **Language treatment** — pronounce as German, English, or automatic for mixed-language text.
- **Speak as** — acronym, characters, cardinal number, ordinal, date, dosage, unit, trial identifier, DOI, URL.

The UI must generate standards-compliant SSML or an equivalent speech-control representation behind the scenes. Show a live preview of only the selected region to make iteration fast.

#### Pronunciation library

Implement a versioned organization glossary:

- canonical written form
- language/locale
- alias or spoken form
- IPA and/or supported phoneme alphabet
- optional audio reference uploaded by an authorized reviewer
- therapeutic area/tag
- approval state
- effective version and review history
- source or rationale

Use a PLS/custom lexicon where the selected Azure voice supports it; otherwise emit word-level SSML or normalized spoken text. Never silently drop an unsupported directive. Warn and provide a compatible alternative.

#### Automated pronunciation QA

For each generated preview:

1. Generate speech.
2. Transcribe the audio with a high-accuracy speech-to-text model.
3. Compare the transcription against expected medical terms, numbers, drug names, trial IDs, and units.
4. Produce a pronunciation QA report with confidence and mismatches.
5. Flag critical-term mismatches as blockers until reviewed.
6. Allow a reviewer to accept the audio despite a warning, but require a reason.

Support a curated “golden pronunciation set” for regression testing across voice/model updates.

### 4.7 Voice and model comparison

The user can select a few configured speech options to hear differences. Do not expose the entire platform catalog by default.

Provide:

- curated voice cards by locale and use case
- single-speaker and host/expert combinations
- A/B/C rendering of the same short segment
- blind comparison mode
- quality notes, supported controls, locale, model status, and known constraints
- save preferred voice pair per template/therapeutic area

Design for provider/model adapters so an administrator can configure Azure Speech neural voices, higher-definition options when available, or approved Foundry audio models without rewriting the UI.

Model availability, region, supported SSML elements, preview status, and quotas must be configuration-driven and verified at deployment time.

### 4.8 Audio generation and mastering

After script approval:

- Convert the approved script plus speech-control annotations into immutable synthesis input.
- Split long content at safe semantic boundaries.
- Render segments with idempotent jobs and retry policies.
- Join segments without audible clicks or inconsistent loudness.
- Support optional intro/outro, bumper, and licensed background audio.
- Apply loudness normalization and peak protection.
- Produce WAV archival output and MP3 or M4A distribution output.
- Generate chapters and transcript files.
- Add configurable metadata, cover art, disclosure, source list, and version ID.
- Store synthesis logs, chosen voice/model, lexicon version, SSML hash, and quality metrics.

Prioritize naturalness and correctness over rendering speed and cost. Use batch synthesis for long-form output when appropriate.

### 4.9 Audio review

Create a waveform-based review workspace with:

- scrub, play/pause, skip, variable playback speed
- synchronized script highlighting
- marker placement on words or time ranges
- comments attached to selected text/audio
- regenerate selection, sentence, section, or full episode
- compare previous and current audio versions
- pronunciation QA panel
- approve, reject, or request changes

A reviewer must be able to reject with structured reasons: pronunciation, factual/script issue, timing, voice, prosody, volume, edit/mastering, policy/compliance, or other.

### 4.10 Azure storage and artifact versioning

Use Azure Storage with private access.

Recommended containers:

- `source-quarantine`
- `source-approved`
- `research-extracted`
- `scripts`
- `synthesis-input`
- `audio-preview`
- `audio-approved`
- `publication-assets`
- `audit-exports`

Requirements:

- private endpoints where required
- encryption at rest
- lifecycle rules by artifact class
- immutable/versioned published artifacts where policy requires
- no public blob access
- short-lived, scoped access links generated server-side
- content-type and content-disposition headers
- malware scanning for uploads
- hashes for evidence and artifacts

### 4.11 Recipients and distribution lists

Users can:

- add a recipient by name and email/identity
- select existing recipients
- create reusable named distribution lists
- assign list owner and purpose
- mark internal/external recipients
- require publisher approval for external recipients
- remove duplicates
- import a list from an approved source
- see prior publication history

Do not expose one recipient’s address to another recipient unless the selected channel intentionally supports that behavior.

### 4.12 Publication

Provide a publication review page showing:

- approved episode and version
- audio player
- final transcript
- accepted source list
- disclosure statement
- recipients and delivery channel
- expiration/access policy
- publisher identity

Initial delivery channels:

- secure email notification containing a time-limited authenticated link
- internal sharing link
- optional webhook/API adapter for an approved podcast host or portal

The Publish button must show a final confirmation summary and require explicit action. Publication must be idempotent and generate a receipt for each recipient/channel. Failed deliveries are retriable without duplicating successful deliveries.

---

## 5. Proposed Azure Architecture

### Frontend

- React, TypeScript, Vite or a supported React framework
- Fluent UI React components and custom design tokens
- MSAL for Entra authentication
- hosted on Azure Static Web Apps or Azure App Service
- Web Audio API plus a production waveform component

### API and orchestration

- Azure Functions or Azure Container Apps for domain APIs
- Durable Functions or Logic Apps Standard for long-running gated workflows
- Azure API Management as the API façade
- Event Grid and/or Service Bus for job events
- managed identity for service-to-service authentication

### AI and research

- Microsoft Foundry model deployments for summarization, structured extraction, script generation, and evaluation
- Azure AI Search for indexed research passages, hybrid retrieval, filters, and citation anchors
- Azure AI Document Intelligence and/or approved parsers for PDF/document extraction
- search connectors behind an adapter interface
- optional content safety and prompt-injection defenses for untrusted acquired content

### Speech

- Azure AI Speech text-to-speech for controlled narration
- Azure Speech batch synthesis for long-form jobs when appropriate
- Azure Speech speech-to-text for closed-loop pronunciation QA
- custom lexicon/PLS and SSML projection layer
- model/voice capability registry stored in application configuration

### Data

- Azure Cosmos DB or Azure SQL for projects, workflow state, reviews, recipients, and audit metadata
- Azure Blob Storage for source documents and media
- Azure AI Search for evidence retrieval
- Azure Key Vault for secrets that cannot use managed identity

### Security and operations

- Microsoft Entra ID, app roles, and Conditional Access alignment
- private endpoints/VNet integration where required
- Azure Monitor, Application Insights, Log Analytics, and OpenTelemetry
- Microsoft Defender for Cloud and storage upload scanning
- Azure Policy and infrastructure-as-code controls
- optional Microsoft Purview integration for classifications and lineage

---

## 6. Domain Model

Implement typed schemas for at least:

- `Project`
- `ResearchPlan`
- `ResearchQuery`
- `SourceArtifact`
- `EvidencePassage`
- `EvidenceClaim`
- `ScriptTemplate`
- `ScriptVersion`
- `ScriptSegment`
- `Speaker`
- `SpeechAnnotation`
- `PronunciationEntry`
- `VoiceProfile`
- `SynthesisJob`
- `AudioVersion`
- `QualityReport`
- `ReviewDecision`
- `Recipient`
- `DistributionList`
- `Publication`
- `DeliveryReceipt`
- `AuditEvent`

Every versioned entity must have an immutable ID, version, created/modified identity, timestamps, status, parent version, and content hash.

---

## 7. API Surface

Create OpenAPI-documented endpoints grouped by domain:

- `/projects`
- `/research-plans`
- `/sources`
- `/evidence`
- `/scripts`
- `/reviews`
- `/pronunciations`
- `/voices`
- `/synthesis-jobs`
- `/audio`
- `/recipients`
- `/distribution-lists`
- `/publications`
- `/audit`

Use optimistic concurrency with ETags or row versions. Long-running actions return job IDs and expose status/events. Validate authorization and state transitions server-side.

---

## 8. UX and Visual Design Requirements

The SPA must be smooth, futuristic, high-tech, scientific, and unmistakably Azure-inspired without becoming visually noisy.

### Visual language

- Use Microsoft/Azure blues, cyan accents, deep navy surfaces, neutral grays, and restrained scientific gradients.
- Use Fluent UI principles and accessible contrast.
- Use subtle grid, spectral, waveform, molecular, or data-flow motifs as non-distracting background details.
- Prefer generous spacing, crisp typography, layered translucent panels, and purposeful motion.
- Avoid generic chatbot bubbles as the primary interaction.
- Avoid excessive neon, gaming aesthetics, fake 3D, and dense dashboards.

### Shell

- Left rail: projects, templates, pronunciation library, recipient lists, admin.
- Top bar: project state, locale, current role/action, notifications.
- Main workspace: step-aware production canvas.
- Right inspector: evidence, speech controls, comments, or metadata based on selection.
- Bottom transport: audio controls when audio exists.

### Guided production timeline

Show the stages Research → Evidence → Script → Speech → Review → Publish as a persistent timeline with gates, blockers, and completion status.

### Accessibility

Meet WCAG 2.2 AA:

- keyboard-complete script and audio editing
- visible focus
- accessible sliders and waveform alternatives
- captions/transcripts
- screen-reader labels
- reduced-motion support
- no color-only statuses
- localization-ready text

### Performance perception

- use skeleton states and progress events
- never freeze the whole SPA during research or synthesis
- allow safe navigation while jobs run
- show deterministic stage status and retry options

---

## 9. Script-to-SSML Projection

Store user intent as a provider-neutral annotation model rather than embedding raw SSML directly in editor content.

Example:

```json
{
  "range": { "segmentId": "seg-42", "start": 12, "end": 27 },
  "pronunciation": { "locale": "de-DE", "ipa": "..." },
  "rate": "slow",
  "emphasis": "moderate",
  "pauseAfterMs": 350,
  "languageMode": "en-US"
}
```

At synthesis time:

1. Validate the selected voice capability profile.
2. Convert supported annotations to SSML.
3. Resolve organization lexicon entries.
4. Normalize unsupported annotations using a documented fallback.
5. Display warnings before rendering when fidelity may change.
6. Store generated SSML as an immutable synthesis artifact.

Protect against XML injection and invalid nesting. Add schema validation and unit tests for every supported annotation combination.

---

## 10. Scientific and Medical Quality Controls

### Factuality

- Claim-level source mapping is mandatory.
- Numbers, percentages, units, endpoints, and group labels must be compared to extracted evidence.
- Contradictory source findings must be surfaced, not blended away.
- Generated transitions must not introduce new clinical claims.
- The script must retain important study limitations.

### Pronunciation

- Detect candidate terms: drug names, INN/USAN terms, genes, proteins, acronyms, trial IDs, Latin terms, units, disease abbreviations, author names, and journal titles.
- Run glossary match before synthesis.
- Require active review for low-confidence critical terms.
- Regression-test the golden pronunciation set whenever a voice/model or lexicon version changes.

### Medical/legal workflow

Make approvals configurable rather than hard-coding one organization’s process. Support sequential or parallel gates, mandatory reviewers, substitute reviewers, due dates, and escalation.

### Safety and adverse-event language

Allow templates to include mandatory safety and pharmacovigilance language. Lock approved boilerplate unless the user has permission to change it.

---

## 11. Security, Privacy, and Compliance

- Use Entra ID authentication and server-side authorization.
- Use managed identities for Azure service access.
- Isolate environments and data by tenant and deployment stage.
- Encrypt data in transit and at rest.
- Do not use customer content to train models outside approved service terms.
- Log access, state transitions, content changes, review decisions, model/voice choices, and publication events.
- Redact tokens, secrets, and unnecessary personal data from telemetry.
- Apply configurable retention by artifact type.
- Validate external URLs and defend against SSRF.
- Treat acquired web/document content as untrusted; defend against indirect prompt injection.
- Scan uploads and validate MIME type, extension, size, and file structure.
- Require explicit permission for external recipients.
- Provide configurable synthetic-media disclosure.

Do not claim that the application is HIPAA, GxP, MLR, or regulatory compliant merely because it uses Azure. Provide the technical controls and evidence needed for the deploying organization’s own validation and governance process.

---

## 12. Observability and Evaluation

### Operational telemetry

Track:

- research acquisition success/failure
- document extraction quality
- retrieval latency and hit quality
- script generation latency
- synthesis job duration and retries
- pronunciation QA failures
- approval/rejection cycle counts
- distribution receipts
- storage and model usage

### Quality evaluation

Create an evaluators package with repeatable datasets and thresholds for:

- groundedness and citation correctness
- factual consistency of numbers and units
- critical omission detection
- language/locale adherence
- script style adherence
- pronunciation term accuracy
- speaker consistency
- audio clipping, unexpected silence, and loudness consistency

Quality gates must be configurable and runnable in CI for deterministic components and in a controlled evaluation pipeline for model-dependent components.

---

## 13. Testing Requirements

- Unit tests for domain rules, state transitions, SSML projection, and glossary resolution.
- Contract tests for speech, research, storage, and distribution adapters.
- Integration tests using emulators/mocks where appropriate.
- Playwright tests for the full workflow.
- Accessibility tests with automated checks plus keyboard scenarios.
- Security tests for authorization, upload validation, URL handling, and prompt injection.
- Audio golden tests for a curated set of English/German medical terms.
- Visual regression tests for major SPA surfaces.
- Load tests for concurrent research and synthesis jobs.
- Failure-injection tests for partial synthesis, storage timeout, and failed delivery.

Create a demo evaluation set using terms and structures from the attached reference, including:

- Doravirine
- Islatravir
- Bictegravir
- Emtricitabin
- Tenofovir-Alafenamid
- HIV-1 RNA
- CD4
- DRESS
- Hepatitis B / HBV
- mixed German/English journal and identifier phrases
- percentages, confidence intervals, dosages, and week numbers

Do not encode one “correct” pronunciation in source without reviewer/configuration provenance. Seed them as review candidates.

---

## 14. DevOps and Repository Structure

Suggested monorepo:

```text
/apps/web
/apps/api
/apps/workers
/packages/domain
/packages/ui
/packages/research-adapters
/packages/model-adapters
/packages/speech-adapters
/packages/ssml
/packages/evaluators
/infra/bicep
/docs/adr
/docs/runbooks
/tests/e2e
/sample-data
```

### CI/CD

Use GitHub Actions with:

- lint, format, typecheck
- unit/integration tests
- dependency and secret scans
- infrastructure validation
- accessibility and Playwright smoke tests
- container/image scanning when containers are used
- deployment with workload identity federation
- environment approvals for production
- post-deployment smoke tests
- model/voice capability validation

Provide Bicep modules for all Azure resources and environment parameter files with no secrets.

---

## 15. Configuration

All potentially changing product capabilities must be configuration-driven:

- Foundry model deployments
- Azure regions
- speech voices/models
- voice capabilities and supported SSML features
- search connectors
- source allow/deny lists
- maximum file sizes
- retention periods
- workflow gates
- email/webhook publisher adapters
- disclosure text
- locale and dialect availability
- quality thresholds

The admin UI must clearly distinguish configured, verified, degraded, preview, and unavailable capabilities.

---

## 16. MVP Definition

The MVP is complete only when a user can:

1. Sign in with Entra ID.
2. Create a project from a topic/mini-prompt.
3. Select research types and add URLs/files.
4. Review accepted sources and evidence summaries.
5. Generate one of the three script formats with citations.
6. Review, comment, revise, reject, and approve the script.
7. Select an English or German locale and compare at least two configured voices/options.
8. Select a word/phrase and adjust pronunciation, pace, pause, emphasis, pitch, and volume through friendly controls.
9. Generate and review a podcast preview.
10. See automated pronunciation QA results.
11. Reject and request targeted changes or approve the audio.
12. Store the approved media in private Azure Storage.
13. Select or create recipients/distribution lists.
14. Publish through a secure notification/link flow.
15. Inspect a complete audit trail.

---

## 17. Post-MVP Backlog

- custom organization/brand voice subject to approval and consent
- podcast RSS/hosting connectors
- Microsoft Teams and SharePoint publishing adapters
- multilingual translation and separate localized script approval
- cover-art generation with brand controls
- collaborative live editing
- automated reviewer assignment
- therapeutic-area lexicon packs
- pronunciation learning suggestions from accepted edits
- advanced audio mastering and music ducking
- analytics for listening completion and recipient engagement, subject to privacy policy
- mobile-optimized reviewer experience

---

## 18. Acceptance Criteria

### Research and grounding

- Every substantive generated claim has a visible citation mapping.
- Rejected sources cannot influence a new script generation.
- The system surfaces conflicting evidence.
- Source and evidence artifacts are versioned and auditable.

### Script workflow

- No audio can be created from an unapproved script version.
- A rejection records reason and creates a new revision path.
- Approved content hashes are immutable.

### Speech quality

- A normal user can tune a term without seeing SSML.
- Advanced users can inspect generated SSML.
- Unsupported selections produce a warning and fallback, not silent loss.
- Critical pronunciation mismatches are visible before approval.
- English and German locale selection affects voices, normalization, and QA.

### Audio workflow

- The user can review and comment against synchronized text/audio.
- Targeted regeneration does not invalidate unchanged approved segments unnecessarily.
- Approved audio is stored privately with version and metadata.

### Distribution

- The user can reuse a prior recipient list.
- External recipients are clearly identified.
- Publication requires final explicit confirmation.
- Delivery receipts and failures are auditable and idempotent.

### UX

- The full process is understandable without Azure, SSML, or audio-engineering expertise.
- The experience meets WCAG 2.2 AA.
- The visual design is polished, scientific, responsive, and Microsoft/Azure-aligned.

---

## 19. Initial Implementation Sequence

1. Scaffold monorepo, domain types, Entra authentication, design tokens, and shell.
2. Implement project/workflow state machine and audit service.
3. Implement upload, URL acquisition, extraction, and evidence workspace.
4. Implement model adapter and grounded structured-summary/script pipeline.
5. Implement script editor, citations, comments, and approval gate.
6. Implement pronunciation library and annotation model.
7. Implement voice registry, SSML projection, and short preview synthesis.
8. Implement full synthesis jobs, storage, waveform review, and QA transcription loop.
9. Implement recipients, reusable lists, publication, and delivery receipts.
10. Add evaluation harness, observability, accessibility, security hardening, and IaC.
11. Load seed templates and demo content based on the attached three-version German script example.
12. Run end-to-end acceptance tests and produce deployment/runbook documentation.

---

## 20. Required Deliverables

- working SPA and APIs
- infrastructure-as-code
- OpenAPI specification
- architecture diagram in Mermaid and exported SVG
- threat model
- data-flow and retention documentation
- reviewer and administrator runbooks
- pronunciation glossary schema and seed data
- evaluation datasets and reports
- CI/CD workflows
- environment setup guide
- demo script using the attached reference structure
- `KNOWN_LIMITATIONS.md` that explicitly lists model, voice, locale, SSML, regional, quota, and preview constraints discovered during implementation

---

## 21. Definition of Done

The solution is done when the MVP acceptance criteria pass in a deployed Azure environment, the repository can be recreated from infrastructure-as-code, no secrets are stored in source, the attached three script patterns can be demonstrated end to end, and a nontechnical reviewer can correct a medical term’s pronunciation and publish an approved podcast without editing SSML.
