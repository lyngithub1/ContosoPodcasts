/**
 * Typed domain schemas (Specification Section 6).
 *
 * These interfaces model the full research-to-podcast lifecycle. Versioned
 * entities extend {@link VersionedEntity}. Non-versioned reference data uses
 * lighter shapes but still carries identity + timestamps for audit.
 */

import type {
  AcceptanceStatus,
  ActorRef,
  CapabilityStatus,
  ContentHash,
  EntityId,
  IsoTimestamp,
  Locale,
  VersionedEntity,
} from './common.js';
import type { WorkflowState } from './workflow.js';

// ---------------------------------------------------------------------------
// Project & research intent
// ---------------------------------------------------------------------------

export type ScriptForm =
  | 'plain-narration'
  | 'structured-narration'
  | 'host-expert'
  | 'custom-template';

export type AudienceSophistication =
  | 'general-public'
  | 'patient'
  | 'allied-health'
  | 'clinician'
  | 'researcher'
  | 'regulatory';

export type EvidenceClass =
  | 'systematic-review'
  | 'meta-analysis'
  | 'rct'
  | 'cohort'
  | 'case-control'
  | 'case-series'
  | 'preprint'
  | 'guideline'
  | 'regulatory'
  | 'conference-abstract'
  | 'org-document'
  | 'other';

export type ResearchType =
  | 'peer-reviewed'
  | 'systematic-review'
  | 'clinical-trial-registry'
  | 'regulatory'
  | 'conference-abstract'
  | 'org-document'
  | 'uploaded-document'
  | 'approved-website'
  | 'identifier';

export type SourcePolicy =
  | 'peer-reviewed-only'
  | 'include-preprints-labeled'
  | 'exclude-non-allowlisted';

export interface Project extends VersionedEntity {
  title: string;
  topic: string;
  miniPrompt: string;
  state: WorkflowState;
  outputLocale: Locale;
  scriptForm: ScriptForm;
  therapeuticArea: string;
  audience: AudienceSophistication;
  targetDurationMinutes: number;
  ownerId: EntityId;
  tags: string[];
}

export interface ResearchPlan extends VersionedEntity {
  projectId: EntityId;
  researchTypes: ResearchType[];
  sourcePolicies: SourcePolicy[];
  publicationDateFrom: IsoTimestamp | null;
  publicationDateTo: IsoTimestamp | null;
  geography: string[];
  languages: Locale[];
  studyPhase: string | null;
  evidenceHierarchy: EvidenceClass[];
  allowlistedDomains: string[];
  denylistedDomains: string[];
  queries: ResearchQuery[];
  /** Must be reviewed/edited before acquisition begins (Section 4.1). */
  approvedForAcquisition: boolean;
}

export interface ResearchQuery {
  id: EntityId;
  text: string;
  sourceCategory: ResearchType;
  filters: Record<string, string | number | boolean>;
  targetDomains: string[];
}

// ---------------------------------------------------------------------------
// Sources & evidence
// ---------------------------------------------------------------------------

export interface SourceArtifact extends VersionedEntity {
  projectId: EntityId;
  title: string;
  authors: string[];
  publication: string | null;
  publishedDate: IsoTimestamp | null;
  doi: string | null;
  pmid: string | null;
  url: string | null;
  researchType: ResearchType;
  evidenceClass: EvidenceClass;
  acquiredAt: IsoTimestamp;
  /** Hash of the original acquired file/content. */
  originalHash: ContentHash;
  language: Locale | string;
  licenseNotes: string | null;
  /** Trust/status flags surfaced to reviewers (e.g. "preprint", "paywalled"). */
  trustFlags: string[];
  status: AcceptanceStatus;
  /** Set when status is rejected/failed. */
  statusReason: string | null;
  storageContainer: 'source-quarantine' | 'source-approved';
  storagePath: string;
}

export interface EvidencePassage extends VersionedEntity {
  sourceId: EntityId;
  projectId: EntityId;
  /** Extracted text of the passage. */
  text: string;
  /** Human-readable anchor, e.g. "p.4 §Results, Table 2". */
  anchor: string;
  pageNumber: number | null;
  sectionPath: string | null;
  language: Locale | string;
  keyFinding: string | null;
  evidenceStrength: 'high' | 'moderate' | 'low' | 'very-low';
  /** Terms flagged as pronunciation candidates within this passage. */
  pronunciationCandidates: string[];
}

export type ClaimKind = 'reported-fact' | 'author-interpretation' | 'generated-transition';

export interface EvidenceClaim extends VersionedEntity {
  projectId: EntityId;
  statement: string;
  kind: ClaimKind;
  /** Passages supporting this claim; empty = unsupported (must be surfaced). */
  supportingPassageIds: EntityId[];
  /** Passages that contradict this claim (surface, do not blend away). */
  contradictingPassageIds: EntityId[];
  /** Whether a reviewer has pinned this claim into the script. */
  pinned: boolean;
  excluded: boolean;
  clinicalQualifiers: string[];
}

// ---------------------------------------------------------------------------
// Structured evidence model (Section 4.4)
// ---------------------------------------------------------------------------

export interface StructuredEvidence extends VersionedEntity {
  projectId: EntityId;
  researchQuestion: string;
  studyDesign: string;
  population: string;
  interventionComparator: string;
  endpoints: string[];
  efficacyResults: string[];
  safetyResults: string[];
  limitations: string[];
  uncertainty: string[];
  citations: EntityId[];
  pronunciationCandidates: string[];
  disclosureRequirements: string[];
}

// ---------------------------------------------------------------------------
// Scripts, speakers, and speech annotations
// ---------------------------------------------------------------------------

export interface ScriptTemplate {
  id: EntityId;
  name: string;
  form: ScriptForm;
  description: string;
  /** Section skeleton with default delivery cues. */
  sections: Array<{ heading: string; directionCue: string | null }>;
  /** Locked, mandatory safety/disclosure boilerplate (Section 10). */
  mandatoryBoilerplate: string[];
  requiresSpeakers: boolean;
}

export interface Speaker {
  id: EntityId;
  /** Display name shown to reviewers, e.g. "Host", "Expert", "Narrator". */
  label: string;
  role: 'narrator' | 'host' | 'expert' | 'guest';
  /** Preferred voice profile id for this speaker. */
  voiceProfileId: EntityId | null;
}

export interface ScriptSegment {
  id: EntityId;
  order: number;
  speakerId: EntityId | null;
  /** Optional section heading (structured narration). */
  heading: string | null;
  /** Friendly delivery direction, e.g. "calm, explanatory". */
  directionCue: string | null;
  text: string;
  /** Claim ids whose statements appear in this segment (citation mapping). */
  claimIds: EntityId[];
  /** Provider-neutral speech annotations attached to text ranges. */
  annotations: SpeechAnnotation[];
}

export interface ScriptVersion extends VersionedEntity {
  projectId: EntityId;
  templateId: EntityId;
  form: ScriptForm;
  locale: Locale;
  title: string;
  speakers: Speaker[];
  segments: ScriptSegment[];
  approved: boolean;
  estimatedDurationSeconds: number;
}

/**
 * Provider-neutral annotation model (Section 9). Stored instead of raw SSML.
 * At synthesis time these are validated against voice capability and projected
 * to SSML (or a documented fallback).
 */
export interface SpeechAnnotation {
  id: EntityId;
  range: { segmentId: EntityId; start: number; end: number };
  pronunciation?: {
    /** "sounds like" plain spelling. */
    soundsLike?: string;
    /** IPA expert mode. */
    ipa?: string;
    locale?: Locale;
    /** Reference to an organization glossary entry. */
    glossaryEntryId?: EntityId;
  };
  rate?: 'x-slow' | 'slow' | 'medium' | 'fast' | 'x-fast' | number;
  emphasis?: 'none' | 'subtle' | 'moderate' | 'strong';
  pauseBeforeMs?: number;
  pauseAfterMs?: number;
  pitch?: 'x-low' | 'low' | 'medium' | 'high' | 'x-high' | number;
  volume?: 'softer' | 'standard' | 'stronger';
  style?: SpeechStyle;
  /** Language treatment for mixed-language passages. */
  languageMode?: Locale | 'auto';
  /** Normalization directive: how to speak the selected text. */
  speakAs?: SpeakAs;
}

export type SpeechStyle =
  | 'calm'
  | 'authoritative'
  | 'explanatory'
  | 'conversational'
  | 'cautious'
  | 'energetic'
  | 'empathetic'
  | 'neutral';

export type SpeakAs =
  | 'acronym'
  | 'characters'
  | 'cardinal'
  | 'ordinal'
  | 'date'
  | 'dosage'
  | 'unit'
  | 'trial-id'
  | 'doi'
  | 'url';

// ---------------------------------------------------------------------------
// Pronunciation library (Section 4.6)
// ---------------------------------------------------------------------------

export interface PronunciationEntry extends VersionedEntity {
  /** Canonical written form, e.g. "Doravirine". */
  canonicalForm: string;
  locale: Locale;
  /** Alias / spoken form (sounds-like). */
  spokenForm: string | null;
  ipa: string | null;
  /** Supported phoneme alphabet when not IPA (e.g. "x-sampa"). */
  phonemeAlphabet: string | null;
  /** Optional uploaded audio reference (blob path). */
  audioReferencePath: string | null;
  therapeuticArea: string | null;
  tags: string[];
  approvalStatus: 'draft' | 'in-review' | 'approved' | 'rejected';
  /** Source or rationale / provenance — never encode a "correct" answer blindly. */
  rationale: string | null;
  reviewHistory: ReviewDecision[];
  /** Part of the curated golden regression set. */
  inGoldenSet: boolean;
}

// ---------------------------------------------------------------------------
// Voices, synthesis, and audio
// ---------------------------------------------------------------------------

export interface VoiceProfile {
  id: EntityId;
  /** Azure Speech voice short name, e.g. "de-DE-KatjaNeural". */
  voiceName: string;
  displayName: string;
  provider: 'azure-speech' | 'azure-speech-hd' | 'foundry-audio';
  locale: Locale;
  gender: 'female' | 'male' | 'neutral';
  useCase: string;
  supportedStyles: SpeechStyle[];
  /** Supported SSML features for capability-aware projection. */
  supportedSsml: {
    prosodyRate: boolean;
    prosodyPitch: boolean;
    prosodyVolume: boolean;
    emphasis: boolean;
    breakTag: boolean;
    phoneme: boolean;
    sayAs: boolean;
    lexicon: boolean;
    lang: boolean;
  };
  status: CapabilityStatus;
  region: string;
  notes: string | null;
}

export type SynthesisMode = 'realtime-preview' | 'batch-longform';

export interface SynthesisJob extends VersionedEntity {
  projectId: EntityId;
  scriptVersionId: EntityId;
  mode: SynthesisMode;
  voiceAssignments: Record<EntityId, EntityId>; // speakerId -> voiceProfileId
  /** Hash of the immutable synthesis input (script + annotations). */
  synthesisInputHash: ContentHash;
  /** Hash of generated SSML artifact. */
  ssmlHash: ContentHash | null;
  lexiconVersion: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
  retries: number;
  segmentsTotal: number;
  segmentsCompleted: number;
  startedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
  logPath: string | null;
}

export interface AudioVersion extends VersionedEntity {
  projectId: EntityId;
  synthesisJobId: EntityId;
  scriptVersionId: EntityId;
  durationSeconds: number;
  /** Blob paths for archival + distribution renditions. */
  wavPath: string;
  distributionPath: string; // mp3 or m4a
  transcriptPath: string;
  chaptersPath: string | null;
  loudnessLufs: number;
  truePeakDb: number;
  approved: boolean;
  storageContainer: 'audio-preview' | 'audio-approved';
  qualityReportId: EntityId | null;
}

export interface QualityReport extends VersionedEntity {
  projectId: EntityId;
  audioVersionId: EntityId;
  /** Overall confidence 0..1 of the pronunciation QA pass. */
  overallConfidence: number;
  transcriptPath: string;
  termChecks: PronunciationTermCheck[];
  audioChecks: {
    clippingDetected: boolean;
    unexpectedSilenceMs: number;
    loudnessConsistent: boolean;
  };
  /** True when any critical-term mismatch blocks approval. */
  hasBlockingIssues: boolean;
}

export interface PronunciationTermCheck {
  term: string;
  expectedSpokenForm: string;
  transcribedAs: string;
  confidence: number;
  matched: boolean;
  critical: boolean;
  /** A reviewer may accept despite a warning, but must give a reason. */
  reviewerOverride: { by: ActorRef; reason: string; at: IsoTimestamp } | null;
}

// ---------------------------------------------------------------------------
// Reviews & audit
// ---------------------------------------------------------------------------

export type ReviewAction = 'approve' | 'reject' | 'request-changes' | 'delegate';

export type RejectionCategory =
  | 'pronunciation'
  | 'factual-script'
  | 'timing'
  | 'voice'
  | 'prosody'
  | 'volume'
  | 'edit-mastering'
  | 'policy-compliance'
  | 'other';

export interface ReviewDecision {
  id: EntityId;
  projectId: EntityId;
  /** Which artifact + version the decision applies to. */
  targetId: EntityId;
  targetVersion: number;
  targetContentHash: ContentHash;
  stage: 'research' | 'script' | 'audio' | 'pronunciation' | 'publication';
  action: ReviewAction;
  by: ActorRef;
  at: IsoTimestamp;
  comment: string | null;
  rejectionCategory: RejectionCategory | null;
  delegatedTo: ActorRef | null;
}

export interface AuditEvent {
  id: EntityId;
  projectId: EntityId | null;
  at: IsoTimestamp;
  actor: ActorRef;
  /** e.g. "state.transition", "source.accepted", "audio.published". */
  eventType: string;
  summary: string;
  /** Redacted, structured detail. Tokens/secrets must never appear here. */
  detail: Record<string, string | number | boolean | null>;
  contentHash: ContentHash | null;
}

// ---------------------------------------------------------------------------
// Recipients, distribution, publication (Sections 4.11–4.12)
// ---------------------------------------------------------------------------

export interface Recipient {
  id: EntityId;
  displayName: string;
  /** Email or Entra identity; never exposed cross-recipient by default. */
  identity: string;
  isExternal: boolean;
  organization: string | null;
}

export interface DistributionList extends VersionedEntity {
  name: string;
  purpose: string;
  ownerId: EntityId;
  recipientIds: EntityId[];
  containsExternal: boolean;
}

export type DeliveryChannel = 'secure-email' | 'internal-link' | 'webhook-api';

export interface Publication extends VersionedEntity {
  projectId: EntityId;
  audioVersionId: EntityId;
  scriptVersionId: EntityId;
  channel: DeliveryChannel;
  distributionListId: EntityId | null;
  recipientIds: EntityId[];
  disclosureStatement: string;
  acceptedSourceIds: EntityId[];
  publishedBy: ActorRef;
  publishedAt: IsoTimestamp;
  /** Access expiry for time-limited links. */
  expiresAt: IsoTimestamp | null;
  /** Immutable once published; corrections create a new version. */
  revoked: boolean;
}

export interface DeliveryReceipt {
  id: EntityId;
  publicationId: EntityId;
  recipientId: EntityId;
  channel: DeliveryChannel;
  status: 'pending' | 'delivered' | 'failed' | 'revoked';
  attemptedAt: IsoTimestamp;
  deliveredAt: IsoTimestamp | null;
  failureReason: string | null;
  /** Idempotency key ensures retries never duplicate successful deliveries. */
  idempotencyKey: string;
}
