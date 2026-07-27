import type {
  AudioVersion,
  DeliveryReceipt,
  DistributionList,
  EvidenceClaim,
  EvidencePassage,
  Project,
  Publication,
  PronunciationEntry,
  QualityReport,
  Recipient,
  ResearchPlan,
  ReviewDecision,
  ScriptSegment,
  ScriptTemplate,
  ScriptVersion,
  SourceArtifact,
  SpeechAnnotation,
  StructuredEvidence,
  SynthesisJob,
  VoiceProfile,
  AuditEvent,
} from '@studio/domain';
import { currentUser, demoHash, iso, people } from './actors.js';
import { voiceProfiles } from './voices.js';
import { scriptTemplates } from './templates.js';
import { pronunciationEntries } from './pronunciations.js';

let seq = 0;
const nextId = (p: string) => `${p}-${(++seq).toString(36)}`;

function versioned(id: string, createdDaysAgo: number, hashSeed: string) {
  return {
    id,
    version: 1,
    parentVersionId: null,
    createdBy: currentUser,
    createdAt: iso(createdDaysAgo),
    modifiedBy: currentUser,
    modifiedAt: iso(Math.max(0, createdDaysAgo - 1)),
    contentHash: demoHash(hashSeed),
  };
}

/** Build a speech annotation from a substring match inside a segment. */
function annotate(
  segmentId: string,
  text: string,
  phrase: string,
  props: Omit<SpeechAnnotation, 'id' | 'range'>,
): SpeechAnnotation | null {
  const start = text.indexOf(phrase);
  if (start < 0) return null;
  return {
    id: nextId('ann'),
    range: { segmentId, start, end: start + phrase.length },
    ...props,
  };
}

// ---------------------------------------------------------------------------
// PROJECT 1 — HIV-1 briefing (advanced to AUDIO_REVIEW), host/expert form
// ---------------------------------------------------------------------------

const p1 = 'proj-hiv-doravirine';

const project1: Project = {
  ...versioned(p1, 12, 'hiv-doravirine-project'),
  title: 'HIV-1: Doravirine/Islatravir Phase-2b briefing',
  topic: 'Investigational two-drug regimen vs. B/F/TAF in virologically suppressed adults',
  miniPrompt:
    'Summarize the Phase-2b evidence comparing Doravirine + Islatravir against Bictegravir/Emtricitabin/Tenofovir-Alafenamid, preserving limitations and safety context.',
  state: 'AUDIO_REVIEW',
  outputLocale: 'de-DE',
  scriptForm: 'host-expert',
  therapeuticArea: 'Infectious disease / HIV',
  audience: 'clinician',
  targetDurationMinutes: 6,
  ownerId: currentUser.id,
  tags: ['HIV', 'antiretroviral', 'phase-2b', 'German'],
};

const researchPlan1: ResearchPlan = {
  ...versioned(nextId('plan'), 12, 'hiv-plan'),
  projectId: p1,
  researchTypes: ['peer-reviewed', 'clinical-trial-registry', 'regulatory'],
  sourcePolicies: ['peer-reviewed-only', 'exclude-non-allowlisted'],
  publicationDateFrom: '2022-01-01T00:00:00Z',
  publicationDateTo: '2026-07-01T00:00:00Z',
  geography: ['EU', 'US'],
  languages: ['de-DE', 'en-US'],
  studyPhase: 'Phase 2b',
  evidenceHierarchy: ['systematic-review', 'meta-analysis', 'rct'],
  allowlistedDomains: ['clinicaltrials.gov', 'ema.europa.eu', 'nejm.org', 'thelancet.com'],
  denylistedDomains: ['example-blog.net'],
  approvedForAcquisition: true,
  queries: [
    {
      id: nextId('q'),
      text: 'Doravirine Islatravir HIV-1 phase 2b virologic suppression week 48',
      sourceCategory: 'peer-reviewed',
      filters: { yearFrom: 2022, studyPhase: '2b' },
      targetDomains: ['nejm.org', 'thelancet.com'],
    },
    {
      id: nextId('q'),
      text: 'Doravirine Islatravir registration trial identifier',
      sourceCategory: 'clinical-trial-registry',
      filters: {},
      targetDomains: ['clinicaltrials.gov'],
    },
  ],
};

const sources1: SourceArtifact[] = [
  {
    ...versioned(nextId('src'), 11, 'src-nejm'),
    projectId: p1,
    title: 'Doravirine plus Islatravir in Virologically Suppressed Adults with HIV-1 (Phase 2b)',
    authors: ['Weber R', 'Martinez A', 'Schmidt K'],
    publication: 'New England Journal of Medicine (illustrative)',
    publishedDate: '2025-03-14T00:00:00Z',
    doi: '10.1056/NEJMoa-DEMO-2025',
    pmid: '40012345',
    url: 'https://www.nejm.org/doi/DEMO',
    researchType: 'peer-reviewed',
    evidenceClass: 'rct',
    acquiredAt: iso(11),
    originalHash: demoHash('nejm-pdf'),
    language: 'en-US',
    licenseNotes: 'Subscription content; abstract processed under demo license.',
    trustFlags: ['peer-reviewed'],
    status: 'accepted',
    statusReason: null,
    storageContainer: 'source-approved',
    storagePath: 'source-approved/proj-hiv/nejm-demo.pdf',
  },
  {
    ...versioned(nextId('src'), 11, 'src-nct'),
    projectId: p1,
    title: 'Registry record NCT04233879 — Doravirine/Islatravir switch study',
    authors: [],
    publication: 'ClinicalTrials.gov (illustrative)',
    publishedDate: '2024-11-02T00:00:00Z',
    doi: null,
    pmid: null,
    url: 'https://clinicaltrials.gov/study/NCT04233879',
    researchType: 'clinical-trial-registry',
    evidenceClass: 'regulatory',
    acquiredAt: iso(11),
    originalHash: demoHash('nct-record'),
    language: 'en-US',
    licenseNotes: 'Public registry.',
    trustFlags: ['registry'],
    status: 'accepted',
    statusReason: null,
    storageContainer: 'source-approved',
    storagePath: 'source-approved/proj-hiv/nct04233879.json',
  },
  {
    ...versioned(nextId('src'), 10, 'src-preprint'),
    projectId: p1,
    title: 'Real-world switch outcomes (preprint, not peer-reviewed)',
    authors: ['Anon Collaborative'],
    publication: 'medRxiv (illustrative)',
    publishedDate: '2026-05-20T00:00:00Z',
    doi: '10.1101/DEMO-preprint',
    pmid: null,
    url: 'https://www.medrxiv.org/DEMO',
    researchType: 'peer-reviewed',
    evidenceClass: 'preprint',
    acquiredAt: iso(10),
    originalHash: demoHash('preprint'),
    language: 'en-US',
    licenseNotes: 'Preprint.',
    trustFlags: ['preprint', 'not-peer-reviewed'],
    status: 'rejected',
    statusReason: 'Rejected under "peer-reviewed only" source policy. Retained in audit record.',
    storageContainer: 'source-quarantine',
    storagePath: 'source-quarantine/proj-hiv/preprint.pdf',
  },
];

const passages1: EvidencePassage[] = [
  {
    ...versioned(nextId('pas'), 11, 'pas-efficacy'),
    sourceId: sources1[0]!.id,
    projectId: p1,
    text: 'At week 48, 90% of participants in the doravirine/islatravir arm maintained HIV-1 RNA <50 copies/mL versus 94% in the B/F/TAF arm (difference −4 percentage points; 95% CI −9 to +1).',
    anchor: 'p.6 §Results, Table 2',
    pageNumber: 6,
    sectionPath: 'Results > Efficacy',
    language: 'en-US',
    keyFinding: '90% vs 94% virologic suppression at week 48; CI includes non-inferiority margin.',
    evidenceStrength: 'moderate',
    pronunciationCandidates: ['Doravirine', 'Islatravir', 'HIV-1 RNA'],
  },
  {
    ...versioned(nextId('pas'), 11, 'pas-safety'),
    sourceId: sources1[0]!.id,
    projectId: p1,
    text: 'One case of DRESS was reported. Participants with HBV co-infection required monitoring for reactivation on ART discontinuation. CD4 trajectories were comparable between arms.',
    anchor: 'p.7 §Safety',
    pageNumber: 7,
    sectionPath: 'Results > Safety',
    language: 'en-US',
    keyFinding: 'One DRESS case; HBV reactivation caution; comparable CD4.',
    evidenceStrength: 'moderate',
    pronunciationCandidates: ['DRESS', 'HBV', 'CD4'],
  },
  {
    ...versioned(nextId('pas'), 11, 'pas-limits'),
    sourceId: sources1[1]!.id,
    projectId: p1,
    text: 'Registry record indicates limited sample size and short follow-up; several endpoints were exploratory.',
    anchor: '§Study design',
    pageNumber: null,
    sectionPath: 'Design',
    language: 'en-US',
    keyFinding: 'Small sample, short follow-up, exploratory endpoints.',
    evidenceStrength: 'low',
    pronunciationCandidates: ['NCT04233879'],
  },
];

const claims1: EvidenceClaim[] = [
  {
    ...versioned(nextId('clm'), 10, 'clm-efficacy'),
    projectId: p1,
    statement:
      'At week 48, 90% of the doravirine/islatravir arm maintained HIV-1 RNA below 50 copies/mL vs 94% for B/F/TAF.',
    kind: 'reported-fact',
    supportingPassageIds: [passages1[0]!.id],
    contradictingPassageIds: [],
    pinned: true,
    excluded: false,
    clinicalQualifiers: ['week 48', '95% CI −9 to +1', 'non-inferiority not confirmed'],
  },
  {
    ...versioned(nextId('clm'), 10, 'clm-safety'),
    projectId: p1,
    statement: 'One DRESS case was reported; HBV co-infection requires monitoring; CD4 comparable.',
    kind: 'reported-fact',
    supportingPassageIds: [passages1[1]!.id],
    contradictingPassageIds: [],
    pinned: true,
    excluded: false,
    clinicalQualifiers: ['adverse event', 'HBV reactivation risk'],
  },
  {
    ...versioned(nextId('clm'), 10, 'clm-limits'),
    projectId: p1,
    statement: 'Findings are hypothesis-generating due to small sample, short follow-up, and exploratory endpoints.',
    kind: 'author-interpretation',
    supportingPassageIds: [passages1[2]!.id],
    contradictingPassageIds: [],
    pinned: true,
    excluded: false,
    clinicalQualifiers: ['limitations'],
  },
  {
    ...versioned(nextId('clm'), 9, 'clm-transition'),
    projectId: p1,
    statement: 'Let us turn to what these results mean for practice.',
    kind: 'generated-transition',
    supportingPassageIds: [],
    contradictingPassageIds: [],
    pinned: false,
    excluded: false,
    clinicalQualifiers: [],
  },
];

const structuredEvidence1: StructuredEvidence = {
  ...versioned(nextId('struct'), 10, 'struct-hiv'),
  projectId: p1,
  researchQuestion:
    'In virologically suppressed adults with HIV-1, is doravirine/islatravir non-inferior to B/F/TAF at week 48?',
  studyDesign: 'Randomized, active-controlled Phase-2b switch study',
  population: 'Virologically suppressed adults with HIV-1',
  interventionComparator: 'Doravirine + Islatravir vs. Bictegravir/Emtricitabin/Tenofovir-Alafenamid',
  endpoints: ['HIV-1 RNA <50 copies/mL at week 48', 'Change in CD4', 'Adverse events'],
  efficacyResults: ['90% vs 94% suppression at week 48', 'Difference −4pp (95% CI −9 to +1)'],
  safetyResults: ['One DRESS case', 'HBV reactivation caution', 'Comparable CD4'],
  limitations: ['Small sample', 'Short follow-up', 'Exploratory endpoints'],
  uncertainty: ['Non-inferiority not confirmed', 'Confidence interval crosses margin'],
  citations: [sources1[0]!.id, sources1[1]!.id],
  pronunciationCandidates: [
    'Doravirine',
    'Islatravir',
    'Bictegravir',
    'Emtricitabin',
    'Tenofovir-Alafenamid',
    'HIV-1 RNA',
    'CD4',
    'DRESS',
    'HBV',
  ],
  disclosureRequirements: [
    'This recording was generated using synthetic speech.',
    'This content is informational and is not medical advice.',
  ],
};

// ---- Host/Expert script version with speech annotations -------------------

const spkHost = { id: 'spk-host', label: 'Host', role: 'host' as const, voiceProfileId: 'voice-de-conrad' };
const spkExpert = { id: 'spk-expert', label: 'Expert', role: 'expert' as const, voiceProfileId: 'voice-de-katja' };

const seg1Text =
  'Willkommen zu unserer Forschungsbesprechung. Heute geht es um ein experimentelles HIV-1-Regime aus Doravirine und Islatravir.';
const seg2Text =
  'Der Prüfarm mit Doravirine plus Islatravir wurde gegen Bictegravir, Emtricitabin und Tenofovir-Alafenamid verglichen. Primärer Endpunkt war eine HIV-1-RNA unter fünfzig Kopien pro Milliliter in Woche 48.';
const seg3Text =
  'Neunzig Prozent im Prüfarm erreichten das virologische Ziel, gegenüber vierundneunzig Prozent im Vergleichsarm. Das Konfidenzintervall schloss die Nichtunterlegenheitsgrenze ein.';
const seg4Text =
  'Ein Fall eines DRESS-Syndroms wurde berichtet. Bei einer Hepatitis-B-Koinfektion, also HBV, ist Vorsicht geboten. Die CD4-Verläufe waren vergleichbar.';
const seg5Text =
  'Die Fallzahl war klein, die Nachbeobachtung kurz. Diese Daten begründen keine Therapieänderung, aber sie rechtfertigen größere Phase-3-Studien. Diese Aufnahme wurde synthetisch erzeugt.';

const seg1: ScriptSegment = {
  id: 'seg-1',
  order: 1,
  speakerId: spkHost.id,
  heading: 'Opening',
  directionCue: 'conversational',
  text: seg1Text,
  claimIds: [],
  annotations: [
    annotate('seg-1', seg1Text, 'Doravirine', {
      pronunciation: { ipa: 'ˌdoːʁaviˈʁiːn', locale: 'de-DE', glossaryEntryId: 'pron-1' },
      style: 'conversational',
    })!,
    annotate('seg-1', seg1Text, 'Islatravir', {
      pronunciation: { ipa: 'ɪsˈlatʁaviːɐ̯', locale: 'de-DE', glossaryEntryId: 'pron-2' },
    })!,
  ].filter(Boolean),
};

const seg2: ScriptSegment = {
  id: 'seg-2',
  order: 2,
  speakerId: spkExpert.id,
  heading: 'Discussion',
  directionCue: 'explanatory',
  text: seg2Text,
  claimIds: [],
  annotations: [
    annotate('seg-2', seg2Text, 'HIV-1-RNA', { speakAs: 'characters', pronunciation: { glossaryEntryId: 'pron-6' } })!,
    annotate('seg-2', seg2Text, 'Woche 48', { pauseBeforeMs: 250 })!,
  ].filter(Boolean),
};

const seg3: ScriptSegment = {
  id: 'seg-3',
  order: 3,
  speakerId: spkExpert.id,
  heading: 'Discussion',
  directionCue: 'dynamic',
  text: seg3Text,
  claimIds: [claims1[0]!.id],
  annotations: [
    annotate('seg-3', seg3Text, 'Nichtunterlegenheitsgrenze', { emphasis: 'moderate', rate: 'slow' })!,
  ].filter(Boolean),
};

const seg4: ScriptSegment = {
  id: 'seg-4',
  order: 4,
  speakerId: spkExpert.id,
  heading: 'Safety',
  directionCue: 'cautious',
  text: seg4Text,
  claimIds: [claims1[1]!.id],
  annotations: [
    annotate('seg-4', seg4Text, 'DRESS', { speakAs: 'acronym', pronunciation: { glossaryEntryId: 'pron-8' }, style: 'cautious' })!,
    annotate('seg-4', seg4Text, 'HBV', { speakAs: 'characters', pauseAfterMs: 200 })!,
    annotate('seg-4', seg4Text, 'CD4', { speakAs: 'characters', pronunciation: { glossaryEntryId: 'pron-7' } })!,
  ].filter(Boolean),
};

const seg5: ScriptSegment = {
  id: 'seg-5',
  order: 5,
  speakerId: spkHost.id,
  heading: 'Takeaways',
  directionCue: 'authoritative',
  text: seg5Text,
  claimIds: [claims1[2]!.id],
  annotations: [
    annotate('seg-5', seg5Text, 'Phase-3-Studien', { emphasis: 'subtle' })!,
  ].filter(Boolean),
};

const scriptV1: ScriptVersion = {
  ...versioned('script-hiv-v1', 8, 'script-hiv-hostexpert'),
  version: 3,
  projectId: p1,
  templateId: 'tmpl-host-expert',
  form: 'host-expert',
  locale: 'de-DE',
  title: 'HIV-1 Doravirine/Islatravir — Host/Expert (de-DE)',
  speakers: [spkHost, spkExpert],
  segments: [seg1, seg2, seg3, seg4, seg5],
  approved: true,
  estimatedDurationSeconds: 355,
};

const synthesisJob1: SynthesisJob = {
  ...versioned('job-hiv-1', 6, 'job-hiv'),
  projectId: p1,
  scriptVersionId: scriptV1.id,
  mode: 'batch-longform',
  voiceAssignments: { [spkHost.id]: 'voice-de-conrad', [spkExpert.id]: 'voice-de-katja' },
  synthesisInputHash: demoHash('synthesis-input-hiv'),
  ssmlHash: demoHash('ssml-hiv'),
  lexiconVersion: 'onco-hiv-lexicon-v2',
  status: 'succeeded',
  retries: 0,
  segmentsTotal: 5,
  segmentsCompleted: 5,
  startedAt: iso(6, 10),
  completedAt: iso(6, 11),
  logPath: 'audit-exports/proj-hiv/synthesis-job-hiv-1.log',
};

const qualityReport1: QualityReport = {
  ...versioned('qr-hiv-1', 6, 'qr-hiv'),
  projectId: p1,
  audioVersionId: 'audio-hiv-1',
  overallConfidence: 0.91,
  transcriptPath: 'audio-preview/proj-hiv/transcript.vtt',
  termChecks: [
    { term: 'Doravirine', expectedSpokenForm: 'Do-ra-vi-rin', transcribedAs: 'Do-ra-vi-rin', confidence: 0.96, matched: true, critical: true, reviewerOverride: null },
    { term: 'Islatravir', expectedSpokenForm: 'Is-la-tra-vir', transcribedAs: 'Is-la-tra-vir', confidence: 0.94, matched: true, critical: true, reviewerOverride: null },
    { term: 'Tenofovir-Alafenamid', expectedSpokenForm: 'Te-no-fo-vir A-la-fe-na-mid', transcribedAs: 'Te-no-fo-vir Ala-fena-mid', confidence: 0.72, matched: false, critical: true, reviewerOverride: null },
    { term: 'HIV-1 RNA', expectedSpokenForm: 'H-I-V-eins R-N-A', transcribedAs: 'H-I-V-eins R-N-A', confidence: 0.9, matched: true, critical: true, reviewerOverride: null },
    { term: 'DRESS', expectedSpokenForm: 'dress', transcribedAs: 'dress', confidence: 0.88, matched: true, critical: false, reviewerOverride: null },
  ],
  audioChecks: { clippingDetected: false, unexpectedSilenceMs: 0, loudnessConsistent: true },
  hasBlockingIssues: true,
};

const audioV1: AudioVersion = {
  ...versioned('audio-hiv-1', 6, 'audio-hiv'),
  projectId: p1,
  synthesisJobId: synthesisJob1.id,
  scriptVersionId: scriptV1.id,
  durationSeconds: 358,
  wavPath: 'audio-preview/proj-hiv/episode-v1.wav',
  distributionPath: 'audio-preview/proj-hiv/episode-v1.mp3',
  transcriptPath: 'audio-preview/proj-hiv/transcript.vtt',
  chaptersPath: 'audio-preview/proj-hiv/chapters.json',
  loudnessLufs: -16.1,
  truePeakDb: -1.2,
  approved: false,
  storageContainer: 'audio-preview',
  qualityReportId: qualityReport1.id,
};

const reviews1: ReviewDecision[] = [
  {
    id: nextId('rev'),
    projectId: p1,
    targetId: sources1[2]!.id,
    targetVersion: 1,
    targetContentHash: sources1[2]!.contentHash,
    stage: 'research',
    action: 'reject',
    by: people.lena!,
    at: iso(10, 14),
    comment: 'Preprint excluded per source policy.',
    rejectionCategory: 'policy-compliance',
    delegatedTo: null,
  },
  {
    id: nextId('rev'),
    projectId: p1,
    targetId: scriptV1.id,
    targetVersion: 3,
    targetContentHash: scriptV1.contentHash,
    stage: 'script',
    action: 'approve',
    by: people.lena!,
    at: iso(8, 15),
    comment: 'Claims mapped; limitations retained. Approved.',
    rejectionCategory: null,
    delegatedTo: null,
  },
];

// ---------------------------------------------------------------------------
// PROJECT 2 — Oncology (early stage: RESEARCH_REVIEW)
// ---------------------------------------------------------------------------

const p2 = 'proj-onco-immuno';
const project2: Project = {
  ...versioned(p2, 3, 'onco-project'),
  title: 'Immunotherapy sequencing in NSCLC',
  topic: 'Checkpoint inhibitor sequencing and biomarker selection',
  miniPrompt: 'Summarize evidence on sequencing checkpoint inhibitors in advanced NSCLC by PD-L1 status.',
  state: 'RESEARCH_REVIEW',
  outputLocale: 'en-US',
  scriptForm: 'structured-narration',
  therapeuticArea: 'Oncology',
  audience: 'clinician',
  targetDurationMinutes: 5,
  ownerId: currentUser.id,
  tags: ['oncology', 'NSCLC', 'immunotherapy'],
};

const researchPlan2: ResearchPlan = {
  ...versioned(nextId('plan'), 3, 'onco-plan'),
  projectId: p2,
  researchTypes: ['peer-reviewed', 'systematic-review'],
  sourcePolicies: ['include-preprints-labeled'],
  publicationDateFrom: '2021-01-01T00:00:00Z',
  publicationDateTo: null,
  geography: ['US'],
  languages: ['en-US'],
  studyPhase: null,
  evidenceHierarchy: ['systematic-review', 'meta-analysis', 'rct'],
  allowlistedDomains: ['pubmed.ncbi.nlm.nih.gov', 'jamanetwork.com'],
  denylistedDomains: [],
  approvedForAcquisition: false,
  queries: [
    {
      id: nextId('q'),
      text: 'checkpoint inhibitor sequencing NSCLC PD-L1 overall survival',
      sourceCategory: 'peer-reviewed',
      filters: { yearFrom: 2021 },
      targetDomains: ['pubmed.ncbi.nlm.nih.gov'],
    },
  ],
};

const sources2: SourceArtifact[] = [
  {
    ...versioned(nextId('src'), 2, 'src-onco-1'),
    projectId: p2,
    title: 'Sequencing immune checkpoint inhibitors in advanced NSCLC: a systematic review',
    authors: ['Tan L', 'Ibrahim H'],
    publication: 'JAMA Oncology (illustrative)',
    publishedDate: '2024-09-01T00:00:00Z',
    doi: '10.1001/DEMO-onco',
    pmid: '39012000',
    url: 'https://jamanetwork.com/DEMO',
    researchType: 'systematic-review',
    evidenceClass: 'systematic-review',
    acquiredAt: iso(2),
    originalHash: demoHash('onco-sr'),
    language: 'en-US',
    licenseNotes: null,
    trustFlags: ['peer-reviewed'],
    status: 'pending',
    statusReason: null,
    storageContainer: 'source-quarantine',
    storagePath: 'source-quarantine/proj-onco/jama-sr.pdf',
  },
];

// ---------------------------------------------------------------------------
// Recipients, distribution, audit
// ---------------------------------------------------------------------------

const recipients: Recipient[] = [
  { id: 'rcp-1', displayName: 'Infectious Disease Board', identity: 'id-board@contoso.example', isExternal: false, organization: 'Contoso' },
  { id: 'rcp-2', displayName: 'Dr. Lena Vogt', identity: 'lena.vogt@contoso.example', isExternal: false, organization: 'Contoso' },
  { id: 'rcp-3', displayName: 'External Advisory Panel', identity: 'panel@partner.example', isExternal: true, organization: 'Partner Institute' },
  { id: 'rcp-4', displayName: 'Medical Education Team', identity: 'meded@contoso.example', isExternal: false, organization: 'Contoso' },
];

const distributionLists: DistributionList[] = [
  {
    ...versioned('dist-id-clinicians', 20, 'dist-1'),
    name: 'ID Clinicians (internal)',
    purpose: 'Internal infectious-disease clinician updates',
    ownerId: currentUser.id,
    recipientIds: ['rcp-1', 'rcp-2', 'rcp-4'],
    containsExternal: false,
  },
  {
    ...versioned('dist-advisory', 18, 'dist-2'),
    name: 'External advisory (requires publisher approval)',
    purpose: 'External advisory panel briefings',
    ownerId: currentUser.id,
    recipientIds: ['rcp-3'],
    containsExternal: true,
  },
];

const publications: Publication[] = [];
const deliveryReceipts: DeliveryReceipt[] = [];

const auditEvents: AuditEvent[] = [
  { id: nextId('ae'), projectId: p1, at: iso(12, 9), actor: currentUser, eventType: 'project.created', summary: 'Project created from topic/mini-prompt', detail: { title: project1.title }, contentHash: project1.contentHash },
  { id: nextId('ae'), projectId: p1, at: iso(11, 10), actor: currentUser, eventType: 'source.accepted', summary: 'NEJM source accepted', detail: { sourceId: sources1[0]!.id }, contentHash: sources1[0]!.contentHash },
  { id: nextId('ae'), projectId: p1, at: iso(10, 14), actor: people.lena!, eventType: 'source.rejected', summary: 'Preprint rejected per policy', detail: { sourceId: sources1[2]!.id, reason: 'peer-reviewed-only' }, contentHash: sources1[2]!.contentHash },
  { id: nextId('ae'), projectId: p1, at: iso(8, 15), actor: people.lena!, eventType: 'script.approved', summary: 'Script v3 approved', detail: { scriptVersionId: scriptV1.id, version: 3 }, contentHash: scriptV1.contentHash },
  { id: nextId('ae'), projectId: p1, at: iso(6, 11), actor: currentUser, eventType: 'audio.generated', summary: 'Audio preview generated (batch synthesis)', detail: { jobId: synthesisJob1.id }, contentHash: audioV1.contentHash },
  { id: nextId('ae'), projectId: p1, at: iso(6, 12), actor: currentUser, eventType: 'qa.completed', summary: 'Pronunciation QA completed with 1 critical mismatch', detail: { report: qualityReport1.id, blocking: true }, contentHash: qualityReport1.contentHash },
  { id: nextId('ae'), projectId: p2, at: iso(3, 9), actor: currentUser, eventType: 'project.created', summary: 'Project created from topic/mini-prompt', detail: { title: project2.title }, contentHash: project2.contentHash },
];

// ---------------------------------------------------------------------------

export interface SeedData {
  voiceProfiles: VoiceProfile[];
  scriptTemplates: ScriptTemplate[];
  pronunciationEntries: PronunciationEntry[];
  projects: Project[];
  researchPlans: ResearchPlan[];
  sources: SourceArtifact[];
  passages: EvidencePassage[];
  claims: EvidenceClaim[];
  structuredEvidence: StructuredEvidence[];
  scripts: ScriptVersion[];
  synthesisJobs: SynthesisJob[];
  audioVersions: AudioVersion[];
  qualityReports: QualityReport[];
  reviews: ReviewDecision[];
  recipients: Recipient[];
  distributionLists: DistributionList[];
  publications: Publication[];
  deliveryReceipts: DeliveryReceipt[];
  auditEvents: AuditEvent[];
}

export function buildSeed(): SeedData {
  return {
    voiceProfiles,
    scriptTemplates,
    pronunciationEntries,
    projects: [project1, project2],
    researchPlans: [researchPlan1, researchPlan2],
    sources: [...sources1, ...sources2],
    passages: passages1,
    claims: claims1,
    structuredEvidence: [structuredEvidence1],
    scripts: [scriptV1],
    synthesisJobs: [synthesisJob1],
    audioVersions: [audioV1],
    qualityReports: [qualityReport1],
    reviews: reviews1,
    recipients,
    distributionLists,
    publications,
    deliveryReceipts,
    auditEvents,
  };
}
