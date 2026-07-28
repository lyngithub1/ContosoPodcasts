/**
 * Server-authoritative workflow routes.
 *
 * These endpoints are the ONLY sanctioned way to change a project's workflow
 * state or to publish. Every request is re-validated against the state machine
 * and the actor's roles (never trusting the client), and every state change is
 * recorded as an immutable audit event. The generic collection endpoint refuses
 * to change a project's `state` field so these gates cannot be bypassed.
 *
 * - POST /api/projects/:id/transition   validate + apply a workflow transition
 * - POST /api/projects/:id/publish      publish (immutable) with preconditions
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { cosmosEnabled, getItem, readByPartition, readCollection, upsertItem } from './cosmos.js';
import { getActor } from './actor.js';
import { authorizeTransition, canTransition, isWorkflowState, type WorkflowState } from './workflow.js';
import {
  foundryEnabled,
  generateGroundedScript,
  SCRIPT_AGENT,
  type ScriptBriefInput,
  type StructuredEvidenceBrief,
} from './foundry.js';
import { speechEnabled } from './speech.js';
import { blobEnabled, downloadBlob, uploadBlob } from './blob.js';
import { transcribeEnabled } from './transcribe.js';
import { renderEpisode, runPronunciationQaCore, PipelineError } from './audioPipeline.js';
import { serviceBusEnabled, enqueue } from './servicebus.js';
import {
  searchEnabled,
  ensureIndex,
  indexDocuments,
  searchProject,
  type SearchDoc,
} from './search.js';
import { docIntelEnabled, analyzeDocument } from './docintel.js';
import { deliverEpisode, oneDriveEnabled, type DeliveryOutcome } from './onedrive.js';
import { actorRef, contentHash, toStringArray, writeAudit, type Doc } from './domainShared.js';

/**
 * Status code for a rejected transition: 403 when the edge is legal but the
 * role is insufficient, 422 for an illegal edge or a missing required reason.
 */
function rejectStatus(from: WorkflowState, to: WorkflowState, authorized: boolean): number {
  if (canTransition(from, to) && !authorized) return 403;
  return 422;
}

/** Map a free-text speaker label to a domain speaker role. */
function speakerRole(label: string): 'narrator' | 'host' | 'expert' | 'guest' {
  const l = label.toLowerCase();
  if (l.includes('expert')) return 'expert';
  if (l.includes('host')) return 'host';
  if (l.includes('guest')) return 'guest';
  return 'narrator';
}

/** Stable speaker id from a label, e.g. "Host" -> "spk-host". */
function speakerId(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return 'spk-' + (slug || 'speaker');
}

/** Project a structured-evidence document into the grounding brief shape. */
function toEvidenceBrief(doc: Doc | undefined): StructuredEvidenceBrief | null {
  if (!doc) return null;
  return {
    researchQuestion: typeof doc.researchQuestion === 'string' ? doc.researchQuestion : undefined,
    studyDesign: typeof doc.studyDesign === 'string' ? doc.studyDesign : undefined,
    population: typeof doc.population === 'string' ? doc.population : undefined,
    interventionComparator: typeof doc.interventionComparator === 'string' ? doc.interventionComparator : undefined,
    endpoints: toStringArray(doc.endpoints),
    efficacyResults: toStringArray(doc.efficacyResults),
    safetyResults: toStringArray(doc.safetyResults),
    limitations: toStringArray(doc.limitations),
    uncertainty: toStringArray(doc.uncertainty),
  };
}

export async function registerDomainRoutes(app: FastifyInstance): Promise<void> {
  // --- Workflow transition -------------------------------------------------
  app.post<{ Params: { id: string }; Body: { to?: string; reason?: string } }>(
    '/api/projects/:id/transition',
    async (req, reply) => {
      if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });

      const actor = getActor(req);
      const { id } = req.params;
      const to = req.body?.to;
      const reason = req.body?.reason;

      if (!isWorkflowState(to)) {
        return reply.code(400).send({ error: `Invalid target state "${String(to)}"` });
      }

      const project = (await getItem('projects', id)) as (Doc & { state?: string }) | undefined;
      if (!project) return reply.code(404).send({ error: `Project "${id}" not found` });

      const from = project.state as WorkflowState;
      if (!isWorkflowState(from)) {
        return reply.code(409).send({ error: `Project has an invalid current state "${String(from)}"` });
      }

      const check = authorizeTransition(from, to, actor.roles, reason);
      if (!check.allowed) {
        return reply.code(rejectStatus(from, to, check.authorized)).send({ error: check.reason });
      }

      // Quality gate: a critical pronunciation QA mismatch blocks audio approval.
      if (to === 'AUDIO_APPROVED') {
        const reports = (await readByPartition('qualityReports', id)) as Array<{ hasBlockingIssues?: boolean }>;
        if (reports.some((r) => r.hasBlockingIssues === true)) {
          return reply.code(409).send({
            error: 'Audio cannot be approved while a critical pronunciation QA mismatch is unresolved.',
          });
        }
      }

      const updated: Doc = {
        ...project,
        state: to,
        modifiedBy: actorRef(actor),
        modifiedAt: new Date().toISOString(),
      };
      const savedProject = await upsertItem('projects', updated);

      const audit = await writeAudit(
        actor,
        id,
        'state.transition',
        `${from} → ${to}${reason ? ` (${reason})` : ''}`,
        { from, to, reason: reason ?? null, isRejection: check.isRejection },
        null,
      );

      return reply.code(200).send({ project: savedProject, audit });
    },
  );

  // --- Publish (immutable) -------------------------------------------------
  app.post<{
    Params: { id: string };
    Body: {
      audioVersionId?: string;
      scriptVersionId?: string;
      channel?: 'secure-email' | 'internal-link' | 'webhook-api' | 'onedrive';
      recipientIds?: string[];
      disclosureStatement?: string;
      acceptedSourceIds?: string[];
      expiresAt?: string | null;
    };
  }>('/api/projects/:id/publish', async (req, reply) => {
    if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });

    const actor = getActor(req);
    const { id } = req.params;
    const body = req.body ?? {};

    const project = (await getItem('projects', id)) as (Doc & { state?: string }) | undefined;
    if (!project) return reply.code(404).send({ error: `Project "${id}" not found` });

    const from = project.state as WorkflowState;
    if (!isWorkflowState(from)) {
      return reply.code(409).send({ error: `Project has an invalid current state "${String(from)}"` });
    }

    // Publishing is the READY_TO_PUBLISH -> PUBLISHED gate (Publisher role).
    const check = authorizeTransition(from, 'PUBLISHED', actor.roles);
    if (!check.allowed) {
      return reply.code(rejectStatus(from, 'PUBLISHED', check.authorized)).send({ error: check.reason });
    }

    // Preconditions: synthetic-media disclosure + at least one recipient.
    const channel = body.channel ?? 'internal-link';
    const recipientIds = Array.isArray(body.recipientIds) ? body.recipientIds.filter((r) => typeof r === 'string') : [];
    if (!body.disclosureStatement?.trim()) {
      return reply.code(422).send({ error: 'A synthetic-media disclosure statement is required to publish.' });
    }
    if (recipientIds.length === 0) {
      return reply.code(422).send({ error: 'At least one recipient is required to publish.' });
    }

    const now = new Date().toISOString();
    const pubId = 'pub-' + randomUUID();

    // --- Real delivery, attempted BEFORE the publication is committed -------
    // For `onedrive` the artifact must actually land before we mark the project
    // PUBLISHED, otherwise "published" would be a lie. A failure here writes
    // nothing and leaves the project in READY_TO_PUBLISH so the publisher can
    // retry. The other channels remain modelled-only (see KNOWN_LIMITATIONS).
    let delivery: DeliveryOutcome | undefined;
    if (channel === 'onedrive') {
      if (!oneDriveEnabled()) {
        return reply.code(501).send({
          error:
            'OneDrive delivery is not configured. Set GRAPH_DRIVE_ID (and optionally ONEDRIVE_FOLDER_PATH) and grant the platform identity a Microsoft Graph application permission on that drive.',
        });
      }
      if (!blobEnabled()) {
        return reply.code(503).send({ error: 'Blob storage is not configured, so there is no audio to deliver.' });
      }
      const audioDoc = body.audioVersionId
        ? ((await getItem('audioVersions', body.audioVersionId, id)) as Doc | undefined)
        : undefined;
      if (!audioDoc) {
        return reply.code(422).send({ error: 'A rendered audioVersionId is required for OneDrive delivery.' });
      }
      const distributionPath = String(audioDoc.distributionPath ?? '');
      const [audioContainer, ...audioRest] = distributionPath.split('/');
      if (!audioContainer || audioRest.length === 0) {
        return reply.code(422).send({ error: 'The audio version has no stored distribution path to deliver.' });
      }
      try {
        const audioBuffer = await downloadBlob(audioContainer, audioRest.join('/'));
        let transcript: string | null = null;
        const transcriptPath = String(audioDoc.transcriptPath ?? '');
        if (transcriptPath) {
          const [tContainer, ...tRest] = transcriptPath.split('/');
          if (tContainer && tRest.length) {
            transcript = await downloadBlob(tContainer, tRest.join('/'))
              .then((b) => b.toString('utf8'))
              .catch(() => null);
          }
        }
        delivery = await deliverEpisode({
          title: String(project.title ?? id),
          projectId: id,
          audio: audioBuffer,
          transcript,
          disclosureStatement: body.disclosureStatement,
          publishedAt: now,
          publishedBy: actor.displayName,
          contentHash: String(audioDoc.contentHash ?? ''),
          durationSeconds: Number(audioDoc.durationSeconds ?? 0),
        });
      } catch (err) {
        req.log.error({ err, projectId: id }, 'OneDrive delivery failed');
        return reply.code(502).send({
          error: `OneDrive delivery failed, so nothing was published: ${(err as Error).message}`,
        });
      }
    }

    const publication: Doc = {
      id: pubId,
      version: 1,
      parentVersionId: null,
      createdBy: actorRef(actor),
      createdAt: now,
      modifiedBy: actorRef(actor),
      modifiedAt: now,
      contentHash: contentHash(pubId + (body.audioVersionId ?? '') + recipientIds.join(',')),
      projectId: id,
      audioVersionId: body.audioVersionId ?? null,
      scriptVersionId: body.scriptVersionId ?? null,
      channel,
      distributionListId: null,
      recipientIds,
      disclosureStatement: body.disclosureStatement,
      acceptedSourceIds: Array.isArray(body.acceptedSourceIds) ? body.acceptedSourceIds : [],
      publishedBy: actorRef(actor),
      publishedAt: now,
      expiresAt: body.expiresAt ?? null,
      revoked: false,
    };
    const savedPublication = await upsertItem('publications', publication);

    const receipts: Doc[] = [];
    for (const rid of recipientIds) {
      const receipt: Doc = {
        id: 'rec-' + randomUUID(),
        publicationId: pubId,
        recipientId: rid,
        channel,
        status: 'delivered',
        attemptedAt: now,
        deliveredAt: now,
        failureReason: null,
        idempotencyKey: contentHash(pubId + rid),
        // Only channels with a real adapter produce a durable location. The
        // upload happened once; each recipient is granted access to that folder.
        deliveredUrl: delivery?.audioUrl ?? null,
      };
      receipts.push(await upsertItem('deliveryReceipts', receipt));
    }

    // Promote the published audio to the approved container, if supplied.
    let savedAudio: Doc | undefined;
    if (body.audioVersionId) {
      const audio = (await getItem('audioVersions', body.audioVersionId, id)) as Doc | undefined;
      if (audio) {
        savedAudio = await upsertItem('audioVersions', { ...audio, storageContainer: 'audio-approved' });
      }
    }

    const savedProject = await upsertItem('projects', {
      ...project,
      state: 'PUBLISHED',
      modifiedBy: actorRef(actor),
      modifiedAt: now,
    });

    const audit = await writeAudit(
      actor,
      id,
      'audio.published',
      `Published to ${recipientIds.length} recipient(s) via ${channel}` +
        (delivery ? ` → ${delivery.folder}` : ''),
      {
        channel,
        recipients: recipientIds.length,
        // Folder path only — no tokens, no recipient identities.
        destination: delivery?.folder ?? null,
        filesDelivered: delivery?.files.length ?? 0,
      },
      publication.contentHash as string,
    );

    return reply.code(201).send({
      publication: savedPublication,
      receipts,
      project: savedProject,
      audioVersion: savedAudio ?? null,
      audit,
      delivery: delivery ?? null,
    });
  });

  // --- Grounded script generation (Foundry) --------------------------------
  app.post<{ Params: { id: string } }>('/api/projects/:id/generate-script', async (req, reply) => {
    if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });
    if (!foundryEnabled()) {
      return reply.code(501).send({
        error:
          'Foundry script generation is not wired. Set FOUNDRY_PROJECT_ENDPOINT and grant the platform identity a data-plane role (Cognitive Services User / Azure AI Developer) on the Foundry account.',
      });
    }

    const actor = getActor(req);
    const { id } = req.params;

    // Drafting a grounded script is a Creator (or Administrator) action. It is
    // decoupled from workflow transitions — the reviewers still gate approval.
    if (!actor.roles.includes('Creator') && !actor.roles.includes('Administrator')) {
      return reply.code(403).send({ error: 'Generating a script requires the Creator role.' });
    }

    const project = (await getItem('projects', id)) as Doc | undefined;
    if (!project) return reply.code(404).send({ error: `Project "${id}" not found` });

    // Load grounding material: accepted structured evidence + non-excluded claims.
    const evidenceDoc = (await readByPartition('structuredEvidence', id))[0];
    const evidence = toEvidenceBrief(evidenceDoc);
    const claimDocs = await readByPartition('claims', id);
    const acceptedClaims = claimDocs
      .filter((c) => c.excluded !== true)
      .map((c) => ({
        id: String(c.id),
        statement: String(c.statement ?? ''),
        kind: String(c.kind ?? 'reported-fact'),
      }))
      .filter((c) => c.statement.trim().length > 0);

    // Enforce grounding: refuse to generate with no accepted evidence or claims.
    if (!evidence && acceptedClaims.length === 0) {
      return reply.code(422).send({
        error: 'No accepted evidence or claims are available to ground a script for this project.',
      });
    }

    const scriptForm = String(project.scriptForm ?? 'plain-narration');
    const locale = String(project.outputLocale ?? 'en-US');
    const speakerLabels = scriptForm === 'host-expert' ? ['Host', 'Expert'] : ['Narrator'];
    const disclosureRequirements = toStringArray(evidenceDoc?.disclosureRequirements);

    const briefInput: ScriptBriefInput = {
      title: String(project.title ?? project.topic ?? 'Untitled episode'),
      locale,
      scriptForm,
      targetDurationMinutes: Number(project.targetDurationMinutes ?? 5),
      speakerLabels,
      evidence,
      claims: acceptedClaims,
      disclosureRequirements,
    };

    let generated;
    try {
      generated = await generateGroundedScript(briefInput);
    } catch (err) {
      req.log.error({ err }, 'script generation failed');
      return reply.code(502).send({ error: `Script generation failed: ${(err as Error).message}` });
    }

    // Build domain Speaker[] from the distinct labels the model used, mapping to
    // voice profiles that match the output locale where possible.
    const voiceProfiles = await readCollection('voiceProfiles');
    const localeVoices = voiceProfiles.filter((v) => v.locale === locale);
    const distinctLabels = [...new Set(generated.segments.map((s) => s.speaker))];
    const speakers = distinctLabels.map((label, i) => ({
      id: speakerId(label),
      label,
      role: speakerRole(label),
      voiceProfileId:
        (localeVoices[i]?.id as string | undefined) ?? (localeVoices[0]?.id as string | undefined) ?? null,
    }));
    const speakerIdByLabel = new Map(speakers.map((s) => [s.label, s.id]));

    // Build domain ScriptSegment[].
    const segments = generated.segments.map((s, i) => ({
      id: 'seg-' + randomUUID(),
      order: i,
      speakerId: speakerIdByLabel.get(s.speaker) ?? speakers[0]?.id ?? null,
      heading: s.heading,
      directionCue: s.directionCue,
      text: s.text,
      claimIds: s.claimIds,
      annotations: [] as unknown[],
    }));

    const wordCount = segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
    const estimatedDurationSeconds = Math.max(30, Math.round(wordCount / 2.5));
    const claimsCited = segments.reduce((n, s) => n + s.claimIds.length, 0);

    const templates = await readCollection('scriptTemplates');
    const template = templates.find((t) => t.form === scriptForm);

    const now = new Date().toISOString();
    const hash = contentHash(segments.map((s) => s.text).join('\n'));

    // Preserve the one-script-per-project invariant: reuse the existing script
    // id and bump the version, otherwise mint a new id.
    const existing = (await readByPartition('scripts', id))[0];
    const scriptId = existing ? String(existing.id) : 'script-' + randomUUID();
    const version = existing ? Number(existing.version ?? 0) + 1 : 1;

    const script: Doc = {
      id: scriptId,
      version,
      parentVersionId: existing ? ((existing.parentVersionId as string | null) ?? null) : null,
      createdBy: existing ? existing.createdBy : actorRef(actor),
      createdAt: existing ? existing.createdAt : now,
      modifiedBy: actorRef(actor),
      modifiedAt: now,
      contentHash: hash,
      projectId: id,
      templateId: template ? template.id : ((existing?.templateId as string | null) ?? null),
      form: scriptForm,
      locale,
      title: generated.title,
      speakers,
      segments,
      approved: false,
      estimatedDurationSeconds,
    };
    const saved = await upsertItem('scripts', script);

    const audit = await writeAudit(
      actor,
      id,
      'script.generated',
      `Generated grounded script "${generated.title}" (${segments.length} segments, ${claimsCited} claim citations)`,
      { agent: SCRIPT_AGENT, segments: segments.length, claimsCited, version },
      hash,
    );

    return reply.code(200).send({ script: saved, audit });
  });

  // --- Audio synthesis (Azure AI Speech -> Blob Storage) -------------------
  app.post<{
    Params: { id: string };
    Body: { voiceProfileId?: string; voiceAssignments?: Record<string, string> };
  }>('/api/projects/:id/synthesize', async (req, reply) => {
    if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });
    if (!speechEnabled()) return reply.code(501).send({ error: 'Speech synthesis is not configured' });
    if (!blobEnabled()) return reply.code(501).send({ error: 'Blob storage is not configured' });

    const actor = getActor(req);
    const { id } = req.params;
    if (!actor.roles.includes('Creator') && !actor.roles.includes('Administrator')) {
      return reply.code(403).send({ error: 'Rendering audio requires the Creator role.' });
    }

    // Resolve a per-speaker voice override map from the request so the render is
    // deterministic and matches the Speech workbench selection, rather than
    // depending on a separate best-effort script persist reaching Cosmos first.
    const body = req.body ?? {};
    let voiceOverrides: Record<string, string> | undefined;
    if (body.voiceAssignments && typeof body.voiceAssignments === 'object') {
      voiceOverrides = body.voiceAssignments;
    } else if (typeof body.voiceProfileId === 'string' && body.voiceProfileId) {
      const script = (await readByPartition('scripts', id))[0];
      const speakers = script && Array.isArray(script.speakers) ? (script.speakers as Doc[]) : [];
      voiceOverrides = {};
      for (const sp of speakers) voiceOverrides[String(sp.id)] = body.voiceProfileId;
    }

    try {
      const result = await renderEpisode(id, actor, undefined, voiceOverrides);
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof PipelineError) return reply.code(err.status).send({ error: err.message });
      req.log.error({ err }, 'audio synthesis failed');
      return reply.code(502).send({ error: `Audio synthesis failed: ${(err as Error).message}` });
    }
  });

  // --- Async audio synthesis (enqueue to Service Bus) ----------------------
  // Same effect as the synchronous route, but the heavy synth work happens in a
  // background worker draining the `synthesis-jobs` queue. This is queue-based
  // processing (not a durable-orchestration runtime): the job document is the
  // durable record of progress. Returns 202 with a `queued` SynthesisJob.
  app.post<{
    Params: { id: string };
    Body: { voiceProfileId?: string; voiceAssignments?: Record<string, string> };
  }>('/api/projects/:id/synthesize-async', async (req, reply) => {
    if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });
    if (!serviceBusEnabled()) return reply.code(501).send({ error: 'Service Bus is not configured' });

    const actor = getActor(req);
    const { id } = req.params;
    if (!actor.roles.includes('Creator') && !actor.roles.includes('Administrator')) {
      return reply.code(403).send({ error: 'Rendering audio requires the Creator role.' });
    }

    const project = (await getItem('projects', id)) as Doc | undefined;
    if (!project) return reply.code(404).send({ error: `Project "${id}" not found` });
    const script = (await readByPartition('scripts', id))[0];
    if (!script) return reply.code(422).send({ error: 'No script to synthesize — generate a script first.' });

    // Resolve a per-speaker voice override map from the request so the background
    // render is deterministic and matches the Speech workbench selection, rather
    // than depending on a separate best-effort script persist reaching Cosmos.
    const body = req.body ?? {};
    let voiceOverrides: Record<string, string> = {};
    if (body.voiceAssignments && typeof body.voiceAssignments === 'object') {
      voiceOverrides = body.voiceAssignments;
    } else if (typeof body.voiceProfileId === 'string' && body.voiceProfileId) {
      const speakers = Array.isArray(script.speakers) ? (script.speakers as Doc[]) : [];
      for (const sp of speakers) voiceOverrides[String(sp.id)] = body.voiceProfileId;
    }

    const now = new Date().toISOString();
    const jobId = 'job-' + randomUUID();
    const job: Doc = {
      id: jobId,
      version: 1,
      parentVersionId: null,
      createdBy: actorRef(actor),
      createdAt: now,
      modifiedBy: actorRef(actor),
      modifiedAt: now,
      contentHash: null,
      projectId: id,
      scriptVersionId: String(script.id),
      mode: 'batch-longform',
      voiceAssignments: voiceOverrides,
      synthesisInputHash: null,
      ssmlHash: null,
      lexiconVersion: null,
      status: 'queued',
      retries: 0,
      segmentsTotal: Array.isArray(script.segments) ? (script.segments as unknown[]).length : 0,
      segmentsCompleted: 0,
      startedAt: null,
      completedAt: null,
      logPath: null,
    };
    await upsertItem('synthesisJobs', job);
    await enqueue('synthesis-jobs', {
      kind: 'synthesize',
      projectId: id,
      jobId,
      actor: { id: actor.id, displayName: actor.displayName, roles: actor.roles },
      voiceAssignments: Object.keys(voiceOverrides).length ? voiceOverrides : undefined,
      chainQa: true,
    });
    const audit = await writeAudit(
      actor,
      id,
      'audio.synthesize.queued',
      `Queued a background synthesis job (${jobId}) on the synthesis-jobs queue`,
      { job: jobId, queue: 'synthesis-jobs', chainQa: true },
      null,
    );
    return reply.code(202).send({ synthesisJob: job, audit, queued: true });
  });

  // --- Audio playback stream (proxies the private blob) --------------------
  app.get<{ Params: { id: string } }>('/api/projects/:id/audio', async (req, reply) => {
    if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });
    if (!blobEnabled()) return reply.code(501).send({ error: 'Blob storage is not configured' });
    const { id } = req.params;
    const audio = (await readByPartition('audioVersions', id))[0];
    if (!audio) return reply.code(404).send({ error: 'No audio for this project' });
    const full = String(audio.distributionPath ?? '');
    const slash = full.indexOf('/');
    if (slash < 0) return reply.code(404).send({ error: 'Audio path is not set' });
    try {
      const buf = await downloadBlob(full.slice(0, slash), full.slice(slash + 1));
      reply.header('Content-Type', 'audio/mpeg');
      reply.header('Cache-Control', 'no-store');
      return reply.send(buf);
    } catch (err) {
      req.log.error({ err }, 'audio download failed');
      return reply.code(404).send({ error: 'Audio blob not found — render a preview first.' });
    }
  });

  // --- Closed-loop pronunciation QA (Azure AI Speech STT) ------------------
  app.post<{ Params: { id: string } }>('/api/projects/:id/pronunciation-qa', async (req, reply) => {
    if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });
    if (!transcribeEnabled()) return reply.code(501).send({ error: 'Speech transcription is not configured' });
    if (!blobEnabled()) return reply.code(501).send({ error: 'Blob storage is not configured' });

    const actor = getActor(req);
    const { id } = req.params;
    const allowed = ['Creator', 'AudioReviewer', 'Administrator'];
    if (!allowed.some((r) => actor.roles.includes(r as (typeof actor.roles)[number]))) {
      return reply.code(403).send({ error: 'Running pronunciation QA requires the Creator or AudioReviewer role.' });
    }

    try {
      const result = await runPronunciationQaCore(id, actor);
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof PipelineError) return reply.code(err.status).send({ error: err.message });
      req.log.error({ err }, 'pronunciation QA failed');
      return reply.code(502).send({ error: `Pronunciation QA failed: ${(err as Error).message}` });
    }
  });

  // --- Async pronunciation QA (enqueue to Service Bus) ---------------------
  app.post<{ Params: { id: string } }>('/api/projects/:id/pronunciation-qa-async', async (req, reply) => {
    if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });
    if (!serviceBusEnabled()) return reply.code(501).send({ error: 'Service Bus is not configured' });

    const actor = getActor(req);
    const { id } = req.params;
    const allowed = ['Creator', 'AudioReviewer', 'Administrator'];
    if (!allowed.some((r) => actor.roles.includes(r as (typeof actor.roles)[number]))) {
      return reply.code(403).send({ error: 'Running pronunciation QA requires the Creator or AudioReviewer role.' });
    }

    const audio = (await readByPartition('audioVersions', id))[0];
    if (!audio) return reply.code(422).send({ error: 'No audio version — render a preview before running QA.' });

    await enqueue('qa-jobs', {
      kind: 'pronunciation-qa',
      projectId: id,
      actor: { id: actor.id, displayName: actor.displayName, roles: actor.roles },
    });
    const audit = await writeAudit(
      actor,
      id,
      'audio.qa.queued',
      'Queued a background pronunciation-QA job on the qa-jobs queue',
      { queue: 'qa-jobs' },
      null,
    );
    return reply.code(202).send({ audit, queued: true });
  });

  // --- Document Intelligence: extract a source document --------------------
  // Accepts an inline base64 document (PDF/HTML/image/office), stores it in the
  // `source-approved` container, extracts its text with Azure AI Document
  // Intelligence (`prebuilt-read`), persists the extracted text to
  // `research-extracted`, records a `source` document, and (by default) indexes
  // it into Azure AI Search for retrieval during scripting.
  app.post<{
    Params: { id: string };
    Body: { title?: string; url?: string; contentBase64?: string; contentType?: string; index?: boolean };
  }>('/api/projects/:id/extract-source', async (req, reply) => {
    if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });
    if (!docIntelEnabled()) return reply.code(501).send({ error: 'Document Intelligence is not configured' });
    if (!blobEnabled()) return reply.code(501).send({ error: 'Blob storage is not configured' });

    const actor = getActor(req);
    const { id } = req.params;
    if (!actor.roles.includes('Creator') && !actor.roles.includes('Administrator')) {
      return reply.code(403).send({ error: 'Ingesting sources requires the Creator role.' });
    }

    const project = (await getItem('projects', id)) as Doc | undefined;
    if (!project) return reply.code(404).send({ error: `Project "${id}" not found` });

    const body = req.body ?? {};
    if (!body.contentBase64) return reply.code(422).send({ error: 'contentBase64 is required.' });
    let buffer: Buffer;
    try {
      buffer = Buffer.from(body.contentBase64, 'base64');
    } catch {
      return reply.code(422).send({ error: 'contentBase64 is not valid base64.' });
    }
    if (buffer.length === 0) return reply.code(422).send({ error: 'Decoded document is empty.' });

    const contentType = body.contentType ?? 'application/pdf';
    const ext =
      contentType.includes('html') ? 'html' : contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : contentType.includes('jpeg') ? 'jpg' : 'bin';
    const sourceId = 'src-' + randomUUID();
    const sourceBlob = `${id}/${sourceId}.${ext}`;
    await uploadBlob('source-approved', sourceBlob, buffer, contentType);

    let extracted;
    try {
      extracted = await analyzeDocument(buffer, contentType);
    } catch (err) {
      req.log.error({ err }, 'document extraction failed');
      return reply.code(502).send({ error: `Document extraction failed: ${(err as Error).message}` });
    }

    const textBlob = `${id}/${sourceId}.txt`;
    await uploadBlob('research-extracted', textBlob, Buffer.from(extracted.content, 'utf8'), 'text/plain; charset=utf-8');

    const now = new Date().toISOString();
    const title = String(body.title ?? 'Untitled source');
    const source: Doc = {
      id: sourceId,
      version: 1,
      parentVersionId: null,
      createdBy: actorRef(actor),
      createdAt: now,
      modifiedBy: actorRef(actor),
      modifiedAt: now,
      contentHash: contentHash(extracted.content),
      projectId: id,
      title,
      url: String(body.url ?? ''),
      sourceBlobPath: `source-approved/${sourceBlob}`,
      extractedTextPath: `research-extracted/${textBlob}`,
      extractedChars: extracted.content.length,
      pages: extracted.pages,
      status: 'extracted',
    };
    const savedSource = await upsertItem('sources', source);

    let indexed = false;
    const shouldIndex = body.index !== false && searchEnabled();
    if (shouldIndex) {
      try {
        await ensureIndex();
        await indexDocuments([
          {
            id: sourceId,
            projectId: id,
            kind: 'source',
            title,
            content: extracted.content.slice(0, 30_000),
            url: String(body.url ?? ''),
            tags: [],
            createdAt: now,
          },
        ]);
        indexed = true;
      } catch (err) {
        req.log.error({ err }, 'search indexing failed (non-fatal)');
      }
    }

    const audit = await writeAudit(
      actor,
      id,
      'source.extracted',
      `Extracted ${extracted.content.length} chars from "${title}" (${extracted.pages} page(s)) with Document Intelligence`,
      { source: sourceId, chars: extracted.content.length, pages: extracted.pages, indexed },
      contentHash(extracted.content),
    );
    return reply.code(200).send({ source: savedSource, extractedChars: extracted.content.length, pages: extracted.pages, indexed, audit });
  });

  // --- Document Intelligence: extract plain text (no persistence) ----------
  // Used by the "upload a finished script" flow to turn a PDF/DOCX/image into
  // text the SPA can parse into a draft script. Nothing is stored — the caller
  // owns the resulting text. Requires the Creator role.
  app.post<{ Body: { contentBase64?: string; contentType?: string } }>(
    '/api/extract-text',
    async (req, reply) => {
      if (!docIntelEnabled()) return reply.code(501).send({ error: 'Document Intelligence is not configured' });

      const actor = getActor(req);
      if (!actor.roles.includes('Creator') && !actor.roles.includes('Administrator')) {
        return reply.code(403).send({ error: 'Extracting document text requires the Creator role.' });
      }

      const body = req.body ?? {};
      if (!body.contentBase64) return reply.code(422).send({ error: 'contentBase64 is required.' });
      let buffer: Buffer;
      try {
        buffer = Buffer.from(body.contentBase64, 'base64');
      } catch {
        return reply.code(422).send({ error: 'contentBase64 is not valid base64.' });
      }
      if (buffer.length === 0) return reply.code(422).send({ error: 'Decoded document is empty.' });

      try {
        const extracted = await analyzeDocument(buffer, body.contentType ?? 'application/pdf');
        return reply.code(200).send({ text: extracted.content, pages: extracted.pages, chars: extracted.content.length });
      } catch (err) {
        req.log.error({ err }, 'document text extraction failed');
        return reply.code(502).send({ error: `Document extraction failed: ${(err as Error).message}` });
      }
    },
  );

  // --- AI Search: (re)index a project's grounding units --------------------
  app.post<{ Params: { id: string } }>('/api/projects/:id/index-evidence', async (req, reply) => {
    if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });
    if (!searchEnabled()) return reply.code(501).send({ error: 'AI Search is not configured' });

    const actor = getActor(req);
    const { id } = req.params;
    if (!actor.roles.includes('Creator') && !actor.roles.includes('Administrator')) {
      return reply.code(403).send({ error: 'Indexing evidence requires the Creator role.' });
    }

    const project = (await getItem('projects', id)) as Doc | undefined;
    if (!project) return reply.code(404).send({ error: `Project "${id}" not found` });

    const now = new Date().toISOString();
    const docs: SearchDoc[] = [];

    const sources = await readByPartition('sources', id);
    for (const s of sources) {
      let content = String(s.title ?? '');
      const path = String(s.extractedTextPath ?? '');
      if (path && blobEnabled()) {
        const slash = path.indexOf('/');
        try {
          const buf = await downloadBlob(path.slice(0, slash), path.slice(slash + 1));
          content = buf.toString('utf8').slice(0, 30_000);
        } catch {
          /* fall back to title */
        }
      }
      docs.push({
        id: String(s.id),
        projectId: id,
        kind: 'source',
        title: String(s.title ?? 'Source'),
        content,
        url: String(s.url ?? ''),
        tags: [],
        createdAt: now,
      });
    }

    const evidence = (await readByPartition('structuredEvidence', id))[0];
    if (evidence) {
      const parts = [
        evidence.researchQuestion,
        evidence.studyDesign,
        evidence.population,
        evidence.interventionComparator,
        ...toStringArray(evidence.endpoints),
        ...toStringArray(evidence.efficacyResults),
        ...toStringArray(evidence.safetyResults),
        ...toStringArray(evidence.limitations),
        ...toStringArray(evidence.uncertainty),
      ]
        .filter((x) => typeof x === 'string' && x)
        .join('\n');
      docs.push({
        id: String(evidence.id),
        projectId: id,
        kind: 'evidence',
        title: 'Structured evidence brief',
        content: parts,
        url: '',
        tags: toStringArray(evidence.pronunciationCandidates),
        createdAt: now,
      });
    }

    const claims = await readByPartition('claims', id);
    for (const c of claims) {
      if (c.excluded) continue;
      const content = String(c.statement ?? c.text ?? '');
      if (!content) continue;
      docs.push({
        id: String(c.id),
        projectId: id,
        kind: 'claim',
        title: 'Claim',
        content,
        url: String(c.sourceUrl ?? ''),
        tags: [],
        createdAt: now,
      });
    }

    try {
      await ensureIndex();
      const count = await indexDocuments(docs);
      const audit = await writeAudit(
        actor,
        id,
        'evidence.indexed',
        `Indexed ${count} grounding unit(s) into AI Search (${sources.length} source(s), ${claims.length} claim(s))`,
        { indexed: count, sources: sources.length, claims: claims.length },
        null,
      );
      return reply.code(200).send({ indexed: count, breakdown: { sources: sources.length, claims: claims.length, evidence: evidence ? 1 : 0 }, audit });
    } catch (err) {
      req.log.error({ err }, 'evidence indexing failed');
      return reply.code(502).send({ error: `Indexing failed: ${(err as Error).message}` });
    }
  });

  // --- AI Search: retrieve grounding passages for a topic ------------------
  app.get<{ Params: { id: string }; Querystring: { q?: string; top?: string } }>(
    '/api/projects/:id/search',
    async (req, reply) => {
      if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });
      if (!searchEnabled()) return reply.code(501).send({ error: 'AI Search is not configured' });
      const { id } = req.params;
      const q = String(req.query.q ?? '').trim();
      const top = Math.min(20, Math.max(1, Number(req.query.top ?? 5) || 5));
      try {
        const hits = await searchProject(id, q, top);
        return reply.code(200).send({ query: q, count: hits.length, hits });
      } catch (err) {
        req.log.error({ err }, 'search query failed');
        return reply.code(502).send({ error: `Search failed: ${(err as Error).message}` });
      }
    },
  );

  app.log.info('workflow (transition + publish + generate-script + synthesize + audio + pronunciation-qa + async queues) routes registered');
}
