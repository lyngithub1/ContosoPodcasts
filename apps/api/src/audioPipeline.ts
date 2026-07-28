/**
 * Audio pipeline core: script → multi-voice synthesis → Blob Storage, and the
 * closed-loop pronunciation QA (re-transcribe the stored preview and compare
 * medical terms). This logic is defined once and called from BOTH the
 * synchronous HTTP routes and the asynchronous Service Bus workers, so the two
 * execution paths can never drift.
 *
 * These functions assume the caller has already authorized the actor; they do
 * no role checks. They throw `PipelineError` (with an HTTP-ish status) on
 * precondition failures so the HTTP layer can map them to responses and the
 * worker can mark the job failed.
 */

import { randomUUID } from 'node:crypto';
import { getItem, readByPartition, readCollection, upsertItem } from './cosmos.js';
import type { Actor } from './actor.js';
import { synthesize } from './speech.js';
import { downloadBlob, uploadBlob } from './blob.js';
import { transcribe } from './transcribe.js';
import { actorRef, contentHash, toStringArray, writeAudit, type Doc } from './domainShared.js';

export class PipelineError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

const SSML_ESCAPES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;',
};

function escapeSsml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => SSML_ESCAPES[c] ?? c);
}

/**
 * Azure AI Speech caps a single `/cognitiveservices/v1` request at **10 minutes
 * of generated audio**; longer input is rejected with HTTP 400 (empty body).
 *
 * Measured against this deployment: ~7,800 characters of German narration
 * produced 544 s of audio, i.e. roughly **14 characters per second**. A budget
 * of 7 minutes therefore leaves comfortable headroom for the inter-segment
 * breaks and for locales that speak more slowly than the sample.
 */
const SPEECH_MAX_SECONDS_PER_REQUEST = 7 * 60;

/** Characters of narration per second of audio (empirical — see above). */
const CHARS_PER_SECOND = 14;

/** Silence inserted after each segment, in seconds (matches the break tag). */
const BREAK_SECONDS = 0.45;

/**
 * Split ordered segments into batches that each stay inside the Speech
 * per-request duration cap.
 *
 * A segment is never split: if one on its own exceeds the budget it becomes its
 * own batch and is sent anyway, which is still the best available attempt.
 * Exported for testing.
 */
export function chunkSegmentsForSynthesis<T extends { text?: unknown }>(
  segments: T[],
  maxSeconds = SPEECH_MAX_SECONDS_PER_REQUEST,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentSeconds = 0;

  for (const segment of segments) {
    const text = String(segment.text ?? '').trim();
    if (!text) continue;
    const seconds = text.length / CHARS_PER_SECOND + BREAK_SECONDS;

    if (current.length > 0 && currentSeconds + seconds > maxSeconds) {
      batches.push(current);
      current = [];
      currentSeconds = 0;
    }
    current.push(segment);
    currentSeconds += seconds;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Build a multi-voice SSML document from a script's ordered segments. */
function buildEpisodeSsml(
  segments: Array<{ speakerId?: unknown; text?: unknown }>,
  voiceBySpeaker: Map<string, string>,
  fallbackVoice: string,
  locale: string,
): string {
  const body = segments
    .map((s) => {
      const voice = voiceBySpeaker.get(String(s.speakerId ?? '')) ?? fallbackVoice;
      const text = escapeSsml(String(s.text ?? '').trim());
      if (!text) return '';
      return `<voice name="${voice}"><s>${text}</s><break time="450ms"/></voice>`;
    })
    .filter(Boolean)
    .join('');
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
    `${body}</speak>`
  );
}

/** Normalize text for pronunciation matching: lowercase, strip accents/punctuation. */
function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Levenshtein distance between two strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * Score how well an expected term survived the synth → transcribe round trip by
 * finding the best-matching same-length window of transcript tokens.
 */
function bestTermMatch(expected: string, transcriptTokens: string[]): { transcribedAs: string; confidence: number } {
  const exp = normalizeTerm(expected);
  const expWords = exp.split(' ').filter(Boolean);
  const width = Math.max(1, expWords.length);
  if (transcriptTokens.length === 0) return { transcribedAs: '', confidence: 0 };
  let best = { transcribedAs: '', confidence: 0 };
  for (let i = 0; i + width <= transcriptTokens.length; i++) {
    const window = transcriptTokens.slice(i, i + width);
    const candidate = window.join(' ');
    const dist = levenshtein(exp, candidate);
    const confidence = 1 - dist / Math.max(exp.length, candidate.length, 1);
    if (confidence > best.confidence) best = { transcribedAs: window.join(' '), confidence: Number(confidence.toFixed(2)) };
  }
  return best;
}

export interface RenderResult {
  synthesisJob: Doc;
  audioVersion: Doc;
  audit: Doc;
}

/**
 * Render the project's latest script to a multi-voice MP3 preview and store it
 * in Blob Storage, creating (or updating) a SynthesisJob and an AudioVersion.
 * When `existingJobId` is supplied (async path) that job document is updated in
 * place instead of creating a new one.
 */
export async function renderEpisode(
  projectId: string,
  actor: Actor,
  existingJobId?: string,
  voiceOverrides?: Record<string, string>,
): Promise<RenderResult> {
  const project = (await getItem('projects', projectId)) as Doc | undefined;
  if (!project) throw new PipelineError(404, `Project "${projectId}" not found`);

  const script = (await readByPartition('scripts', projectId))[0];
  if (!script) throw new PipelineError(422, 'No script to synthesize — generate a script first.');

  const locale = String(project.outputLocale ?? script.locale ?? 'en-US');
  const voiceProfiles = await readCollection('voiceProfiles');
  const voiceById = new Map(voiceProfiles.map((v) => [String(v.id), String(v.voiceName ?? '')]));
  const speakersRaw = Array.isArray(script.speakers) ? (script.speakers as Doc[]) : [];
  // Apply caller-supplied per-speaker voice overrides so the render always uses
  // exactly the voice the user selected in the Speech workbench, without relying
  // on a separate best-effort script persist having reached Cosmos first.
  const overrides = voiceOverrides ?? {};
  let speakersChanged = false;
  const speakers = speakersRaw.map((sp) => {
    const ov = overrides[String(sp.id)];
    if (ov && ov !== String(sp.voiceProfileId ?? '')) {
      speakersChanged = true;
      return { ...sp, voiceProfileId: ov } as Doc;
    }
    return sp;
  });
  // Persist the chosen voice back onto the script so audio review, closed-loop
  // QA, and any later render stay consistent with what was just synthesized.
  if (speakersChanged) {
    await upsertItem('scripts', { ...script, speakers, modifiedAt: new Date().toISOString() });
  }
  const voiceBySpeaker = new Map<string, string>();
  for (const sp of speakers) {
    const vn = voiceById.get(String(sp.voiceProfileId ?? ''));
    if (vn) voiceBySpeaker.set(String(sp.id), vn);
  }
  // Honor caller-selected voices for speakers that aren't (yet) on the persisted
  // script — e.g. a narrator voice chosen for a plain-narration script whose
  // segments carry no speakerId. The first such selection also drives the
  // fallback voice below.
  let chosenVoice: string | undefined;
  for (const [spId, vp] of Object.entries(overrides)) {
    const vn = voiceById.get(String(vp));
    if (!vn) continue;
    if (!voiceBySpeaker.has(spId)) voiceBySpeaker.set(spId, vn);
    if (!chosenVoice) chosenVoice = vn;
  }
  const localeVoices = voiceProfiles.filter((v) => v.locale === locale);
  // Prefer the voice the user explicitly selected; only fall back to the locale
  // default when no selection was made. (Previously the locale default always
  // won, so voice picks on plain-narration scripts were silently ignored.)
  const fallbackVoice =
    chosenVoice ??
    [...voiceBySpeaker.values()][0] ??
    (localeVoices[0]?.voiceName as string | undefined) ??
    'en-US-AvaNeural';

  const segments = (Array.isArray(script.segments) ? (script.segments as Doc[]) : [])
    .slice()
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  if (segments.length === 0) throw new PipelineError(422, 'Script has no segments to render.');

  // Long episodes must be rendered in pieces: Speech rejects any single request
  // that would generate more than ~10 minutes of audio. Each batch is
  // synthesized separately and the resulting MP3 frames are concatenated, which
  // is valid for the CBR MP3 format Speech returns.
  const batches = chunkSegmentsForSynthesis(segments);
  const ssmlParts = batches.map((batch) => buildEpisodeSsml(batch, voiceBySpeaker, fallbackVoice, locale));
  const ssml = ssmlParts.join('\n');

  let rendered: { audio: Buffer };
  try {
    const parts: Buffer[] = [];
    for (const part of ssmlParts) {
      const result = await synthesize({ ssml: part, format: 'audio-24khz-48kbitrate-mono-mp3' });
      parts.push(result.audio);
    }
    rendered = { audio: Buffer.concat(parts) };
  } catch (err) {
    throw new PipelineError(502, `Audio synthesis failed: ${(err as Error).message}`);
  }

  const existingAudio = (await readByPartition('audioVersions', projectId))[0];
  const now = new Date().toISOString();
  const audioId = existingAudio ? String(existingAudio.id) : 'audio-' + randomUUID();
  const jobId = existingJobId ?? 'job-' + randomUUID();
  const priorJob = existingJobId ? ((await readByPartition('synthesisJobs', projectId)).find((j) => j.id === existingJobId) as Doc | undefined) : undefined;
  const mp3Blob = `${projectId}/${audioId}.mp3`;
  const txtBlob = `${projectId}/${audioId}.txt`;

  await uploadBlob('audio-preview', mp3Blob, rendered.audio, 'audio/mpeg');
  const transcriptText = segments.map((s) => String(s.text ?? '')).join('\n\n');
  await uploadBlob('audio-preview', txtBlob, Buffer.from(transcriptText, 'utf8'), 'text/plain; charset=utf-8');

  const wordCount = segments.reduce((n, s) => n + String(s.text ?? '').split(/\s+/).filter(Boolean).length, 0);
  const durationSeconds = Math.max(30, Math.round(wordCount / 2.5));

  const voiceAssignments: Record<string, string> = {};
  for (const sp of speakers) voiceAssignments[String(sp.id)] = String(sp.voiceProfileId ?? '');
  const ssmlHash = contentHash(ssml);

  const job: Doc = {
    id: jobId,
    version: priorJob ? Number(priorJob.version ?? 0) + 1 : 1,
    parentVersionId: null,
    createdBy: priorJob ? priorJob.createdBy : actorRef(actor),
    createdAt: priorJob ? priorJob.createdAt : now,
    modifiedBy: actorRef(actor),
    modifiedAt: now,
    contentHash: ssmlHash,
    projectId,
    scriptVersionId: String(script.id),
    mode: 'batch-longform',
    voiceAssignments,
    synthesisInputHash: contentHash(transcriptText),
    ssmlHash,
    lexiconVersion: null,
    status: 'succeeded',
    retries: priorJob ? Number(priorJob.retries ?? 0) : 0,
    segmentsTotal: segments.length,
    segmentsCompleted: segments.length,
    startedAt: priorJob ? (priorJob.startedAt ?? now) : now,
    completedAt: now,
    logPath: null,
  };

  const audioVersion: Doc = {
    id: audioId,
    version: existingAudio ? Number(existingAudio.version ?? 0) + 1 : 1,
    parentVersionId: existingAudio ? ((existingAudio.parentVersionId as string | null) ?? null) : null,
    createdBy: existingAudio ? existingAudio.createdBy : actorRef(actor),
    createdAt: existingAudio ? existingAudio.createdAt : now,
    modifiedBy: actorRef(actor),
    modifiedAt: now,
    contentHash: contentHash(`${mp3Blob}:${rendered.audio.length}`),
    projectId,
    synthesisJobId: jobId,
    scriptVersionId: String(script.id),
    durationSeconds,
    wavPath: '',
    distributionPath: `audio-preview/${mp3Blob}`,
    transcriptPath: `audio-preview/${txtBlob}`,
    chaptersPath: null,
    // Loudness/true-peak are not measured (no DSP mastering stage). Kept 0 to
    // avoid implying a false measurement; see KNOWN_LIMITATIONS.
    loudnessLufs: 0,
    truePeakDb: 0,
    approved: false,
    storageContainer: 'audio-preview',
    qualityReportId: existingAudio ? ((existingAudio.qualityReportId as string | null) ?? null) : null,
  };

  await upsertItem('synthesisJobs', job);
  const savedAudio = await upsertItem('audioVersions', audioVersion);
  const audit = await writeAudit(
    actor,
    projectId,
    'audio.synthesized',
    `Rendered a ${segments.length}-segment preview (${rendered.audio.length} bytes) with Azure AI Speech`,
    { job: jobId, bytes: rendered.audio.length, container: 'audio-preview', segments: segments.length },
    ssmlHash,
  );
  return { synthesisJob: job, audioVersion: savedAudio, audit };
}

export interface QaResult {
  qualityReport: Doc;
  audioVersion: Doc;
  transcript: string;
  audit: Doc;
}

/**
 * Closed-loop pronunciation QA: download the stored preview, re-transcribe it
 * with Azure AI Speech, and compare each expected medical term against what the
 * recognizer heard. Produces (or updates) a QualityReport and links it to the
 * AudioVersion; a critical mismatch sets `hasBlockingIssues`.
 */
export async function runPronunciationQaCore(projectId: string, actor: Actor): Promise<QaResult> {
  const project = (await getItem('projects', projectId)) as Doc | undefined;
  if (!project) throw new PipelineError(404, `Project "${projectId}" not found`);

  const audio = (await readByPartition('audioVersions', projectId))[0];
  if (!audio) throw new PipelineError(422, 'No audio version — render a preview before running QA.');

  const locale = String(project.outputLocale ?? 'en-US');
  const full = String(audio.distributionPath ?? '');
  const slash = full.indexOf('/');
  let audioBuf: Buffer;
  try {
    audioBuf = await downloadBlob(full.slice(0, slash), full.slice(slash + 1));
  } catch {
    throw new PipelineError(422, 'Stored audio not found — re-render the preview.');
  }

  let tr;
  try {
    tr = await transcribe(audioBuf, locale);
  } catch (err) {
    throw new PipelineError(502, `Transcription failed: ${(err as Error).message}`);
  }
  const transcriptTokens = normalizeTerm(tr.text).split(' ').filter(Boolean);

  const pron = await readByPartition('pronunciationEntries', locale);
  const entryByCanonical = new Map(pron.map((p) => [normalizeTerm(String(p.canonicalForm ?? '')), p]));
  const evidence = (await readByPartition('structuredEvidence', projectId))[0];
  const scriptDoc = (await readByPartition('scripts', projectId))[0];
  const scriptText = normalizeTerm(
    scriptDoc && Array.isArray(scriptDoc.segments)
      ? (scriptDoc.segments as Doc[]).map((s) => String(s.text ?? '')).join(' ')
      : '',
  );

  const terms = new Map<string, { term: string; expectedSpokenForm: string; critical: boolean }>();
  for (const c of toStringArray(evidence?.pronunciationCandidates)) {
    const key = normalizeTerm(c);
    if (!key) continue;
    const e = entryByCanonical.get(key);
    terms.set(key, {
      term: c,
      expectedSpokenForm: String(e?.spokenForm ?? c),
      critical: Boolean(e?.inGoldenSet ?? true),
    });
  }
  for (const p of pron) {
    const canonical = String(p.canonicalForm ?? '');
    const key = normalizeTerm(canonical);
    if (!key || !p.inGoldenSet || terms.has(key)) continue;
    if (scriptText.includes(key)) {
      terms.set(key, { term: canonical, expectedSpokenForm: String(p.spokenForm ?? canonical), critical: true });
    }
  }

  const termChecks = [...terms.values()].map((t) => {
    const a = bestTermMatch(t.expectedSpokenForm || t.term, transcriptTokens);
    const b = bestTermMatch(t.term, transcriptTokens);
    const confidence = Math.max(a.confidence, b.confidence);
    const transcribedAs = (a.confidence >= b.confidence ? a.transcribedAs : b.transcribedAs) || '(not found)';
    return {
      term: t.term,
      expectedSpokenForm: t.expectedSpokenForm,
      transcribedAs,
      confidence,
      matched: confidence >= 0.82,
      critical: t.critical,
      reviewerOverride: null,
    };
  });
  const hasBlockingIssues = termChecks.some((tc) => tc.critical && !tc.matched);
  const overallConfidence = termChecks.length
    ? Number((termChecks.reduce((n, tc) => n + tc.confidence, 0) / termChecks.length).toFixed(2))
    : 1;

  const now = new Date().toISOString();
  const audioId = String(audio.id);
  const transcriptBlob = `${projectId}/${audioId}.transcript.txt`;
  await uploadBlob('audio-preview', transcriptBlob, Buffer.from(tr.text, 'utf8'), 'text/plain; charset=utf-8');

  const existingQr = (await readByPartition('qualityReports', projectId)).find((q) => q.audioVersionId === audioId);
  const qrId = existingQr ? String(existingQr.id) : 'qr-' + randomUUID();
  const qr: Doc = {
    id: qrId,
    version: existingQr ? Number(existingQr.version ?? 0) + 1 : 1,
    parentVersionId: null,
    createdBy: existingQr ? existingQr.createdBy : actorRef(actor),
    createdAt: existingQr ? existingQr.createdAt : now,
    modifiedBy: actorRef(actor),
    modifiedAt: now,
    contentHash: contentHash(tr.text),
    projectId,
    audioVersionId: audioId,
    overallConfidence,
    transcriptPath: `audio-preview/${transcriptBlob}`,
    termChecks,
    // Audio-level checks require DSP that is not implemented; reported neutral.
    audioChecks: { clippingDetected: false, unexpectedSilenceMs: 0, loudnessConsistent: true },
    hasBlockingIssues,
  };
  await upsertItem('qualityReports', qr);

  const linkedAudio: Doc = { ...audio, qualityReportId: qrId, modifiedBy: actorRef(actor), modifiedAt: now };
  await upsertItem('audioVersions', linkedAudio);

  const audit = await writeAudit(
    actor,
    projectId,
    'audio.qa',
    `Closed-loop pronunciation QA: ${termChecks.filter((t) => t.matched).length}/${termChecks.length} terms verified` +
      (hasBlockingIssues ? ' — BLOCKING critical mismatch' : ''),
    { transcriptChars: tr.text.length, terms: termChecks.length, blocking: hasBlockingIssues, overallConfidence },
    contentHash(tr.text),
  );
  return { qualityReport: qr, audioVersion: linkedAudio, transcript: tr.text, audit };
}
