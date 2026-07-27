/**
 * Thin client for the domain API.
 *
 * Every call is best-effort and non-throwing: if the API is not configured or a
 * request fails, the client returns a null/false result so the SPA can keep
 * working against its in-memory store. This keeps the app fully functional both
 * with and without the backend.
 */

import { API_BASE_URL, apiEnabled } from '../config/api';
import { authEnabled } from '../config/auth';
import { getAccessToken } from './auth';

/**
 * Build request headers.
 *
 * When Entra sign-in is configured we send only a verified Bearer token — the
 * server derives identity and roles from signed claims and ignores `x-actor-*`.
 * When it is not configured (the local demo) we fall back to the documented
 * header shim so the walkthrough still works with no cloud setup.
 */
async function authHeaders(actor?: ActorContext): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authEnabled()) {
    const token = await getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }
  if (actor) {
    headers['x-actor-id'] = actor.id;
    headers['x-actor-name'] = actor.name;
    headers['x-actor-roles'] = actor.roles.join(',');
  }
  return headers;
}

export interface BootstrapResult {
  collections: Record<string, unknown[]>;
  persistence: boolean;
}

export interface TtsRequest {
  ssml?: string;
  text?: string;
  voice?: string;
  locale?: string;
  format?: string;
}

/** Load persisted collections from the backend. Returns null when unavailable. */
export async function bootstrap(): Promise<BootstrapResult | null> {
  if (!apiEnabled()) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/bootstrap`, {
      method: 'GET',
      headers: await authHeaders(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<BootstrapResult>;
    return {
      collections: data.collections ?? {},
      persistence: Boolean(data.persistence),
    };
  } catch {
    return null;
  }
}

/** Upsert one item into a collection. Returns true on success. */
export async function persist(collection: string, item: { id: string }): Promise<boolean> {
  if (!apiEnabled()) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/collections/${encodeURIComponent(collection)}`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(item),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Delete one item from a collection by id. Pass `pk` when the container's
 * partition key is not `id` (project-scoped collections partition by projectId).
 * Returns true on success.
 */
export async function deleteItem(collection: string, id: string, pk?: string): Promise<boolean> {
  if (!apiEnabled()) return false;
  try {
    const qs = pk ? `?pk=${encodeURIComponent(pk)}` : '';
    const res = await fetch(
      `${API_BASE_URL}/api/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}${qs}`,
      { method: 'DELETE', headers: await authHeaders() },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** The acting user, sent to the authoritative endpoints for audit + role gating. */
export interface ActorContext {
  id: string;
  name: string;
  roles: string[];
}

export interface TransitionResult {
  ok: boolean;
  project?: { id: string } & Record<string, unknown>;
  audit?: { id: string } & Record<string, unknown>;
  error?: string;
}

/** Ask the server to validate + apply a workflow transition (authoritative). */
export async function transition(
  projectId: string,
  to: string,
  reason: string | undefined,
  actor: ActorContext,
): Promise<TransitionResult> {
  if (!apiEnabled()) return { ok: false, error: 'offline' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/transition`, {
      method: 'POST',
      headers: await authHeaders(actor),
      body: JSON.stringify({ to, reason }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) ?? `HTTP ${res.status}` };
    return { ok: true, project: data.project as TransitionResult['project'], audit: data.audit as TransitionResult['audit'] };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export interface PublishInput {
  projectId: string;
  audioVersionId: string;
  scriptVersionId: string;
  channel: 'secure-email' | 'internal-link' | 'webhook-api';
  recipientIds: string[];
  disclosureStatement: string;
  acceptedSourceIds: string[];
  expiresAt: string | null;
}

export interface PublishResult {
  ok: boolean;
  publication?: { id: string } & Record<string, unknown>;
  receipts?: Array<{ id: string } & Record<string, unknown>>;
  project?: { id: string } & Record<string, unknown>;
  audioVersion?: ({ id: string } & Record<string, unknown>) | null;
  audit?: { id: string } & Record<string, unknown>;
  error?: string;
}

/** Ask the server to publish (immutable) with precondition + role enforcement. */
export async function publishProject(input: PublishInput, actor: ActorContext): Promise<PublishResult> {
  if (!apiEnabled()) return { ok: false, error: 'offline' };
  try {
    const { projectId, ...body } = input;
    const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/publish`, {
      method: 'POST',
      headers: await authHeaders(actor),
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) ?? `HTTP ${res.status}` };
    return {
      ok: true,
      publication: data.publication as PublishResult['publication'],
      receipts: data.receipts as PublishResult['receipts'],
      project: data.project as PublishResult['project'],
      audioVersion: data.audioVersion as PublishResult['audioVersion'],
      audit: data.audit as PublishResult['audit'],
    };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export interface GenerateScriptResult {
  ok: boolean;
  script?: { id: string } & Record<string, unknown>;
  audit?: { id: string } & Record<string, unknown>;
  error?: string;
}

/**
 * Ask the server to generate a grounded script by running the deployed Foundry
 * podcast-script-generator agent against the project's accepted evidence and
 * claims. Requires the Creator role and the backend Foundry wiring — returns
 * `{ ok: false }` when offline or not configured so the SPA can keep its sample.
 */
export async function generateScript(projectId: string, actor: ActorContext): Promise<GenerateScriptResult> {
  if (!apiEnabled()) return { ok: false, error: 'offline' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/generate-script`, {
      method: 'POST',
      headers: await authHeaders(actor),
      body: JSON.stringify({}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) ?? `HTTP ${res.status}` };
    return {
      ok: true,
      script: data.script as GenerateScriptResult['script'],
      audit: data.audit as GenerateScriptResult['audit'],
    };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * Synthesize audio via Azure AI Speech. Returns an audio Blob, or null when the
 * backend/Speech is unavailable (the caller should then fall back to the
 * browser preview).
 */
export async function synthesizeAudio(req: TtsRequest): Promise<Blob | null> {
  if (!apiEnabled()) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/speech/tts`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(req),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

export interface SynthesizeEpisodeResult {
  ok: boolean;
  synthesisJob?: { id: string } & Record<string, unknown>;
  audioVersion?: { id: string } & Record<string, unknown>;
  audit?: { id: string } & Record<string, unknown>;
  error?: string;
}

/**
 * Render the whole approved script to a multi-voice preview via Azure AI Speech
 * and store the MP3 in Blob Storage. Creates a SynthesisJob + AudioVersion.
 * Requires the Creator role. Returns `{ ok: false }` when offline/unconfigured.
 */
export async function synthesizeEpisode(
  projectId: string,
  actor: ActorContext,
  voiceAssignments?: Record<string, string>,
): Promise<SynthesizeEpisodeResult> {
  if (!apiEnabled()) return { ok: false, error: 'offline' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/synthesize`, {
      method: 'POST',
      headers: await authHeaders(actor),
      body: JSON.stringify(
        voiceAssignments && Object.keys(voiceAssignments).length ? { voiceAssignments } : {},
      ),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) ?? `HTTP ${res.status}` };
    return {
      ok: true,
      synthesisJob: data.synthesisJob as SynthesizeEpisodeResult['synthesisJob'],
      audioVersion: data.audioVersion as SynthesizeEpisodeResult['audioVersion'],
      audit: data.audit as SynthesizeEpisodeResult['audit'],
    };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export interface SynthesizeEpisodeAsyncResult {
  ok: boolean;
  synthesisJob?: { id: string; status?: string } & Record<string, unknown>;
  audit?: { id: string } & Record<string, unknown>;
  error?: string;
}

/**
 * Queue a whole-episode render on the background worker (Service Bus) instead of
 * blocking on the ~1-minute synchronous synthesis. Returns immediately with a
 * `queued` SynthesisJob; poll `bootstrap()` for the job reaching a terminal
 * status. Requires the Creator role. Returns `{ ok: false }` when offline or
 * when Service Bus is not configured (the caller can fall back to sync).
 */
export async function synthesizeEpisodeAsync(
  projectId: string,
  actor: ActorContext,
  voiceAssignments?: Record<string, string>,
): Promise<SynthesizeEpisodeAsyncResult> {
  if (!apiEnabled()) return { ok: false, error: 'offline' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/synthesize-async`, {
      method: 'POST',
      headers: await authHeaders(actor),
      body: JSON.stringify(
        voiceAssignments && Object.keys(voiceAssignments).length ? { voiceAssignments } : {},
      ),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) ?? `HTTP ${res.status}` };
    return {
      ok: true,
      synthesisJob: data.synthesisJob as SynthesizeEpisodeAsyncResult['synthesisJob'],
      audit: data.audit as SynthesizeEpisodeAsyncResult['audit'],
    };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export interface PronunciationQaResult {
  ok: boolean;
  qualityReport?: { id: string } & Record<string, unknown>;
  audioVersion?: { id: string } & Record<string, unknown>;
  transcript?: string;
  audit?: { id: string } & Record<string, unknown>;
  error?: string;
}

/**
 * Run closed-loop pronunciation QA: re-transcribe the stored preview with Azure
 * AI Speech and compare each medical term against its expected spoken form.
 * Requires the Creator or AudioReviewer role. Returns `{ ok: false }` offline.
 */
export async function runPronunciationQa(
  projectId: string,
  actor: ActorContext,
): Promise<PronunciationQaResult> {
  if (!apiEnabled()) return { ok: false, error: 'offline' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/pronunciation-qa`, {
      method: 'POST',
      headers: await authHeaders(actor),
      body: JSON.stringify({}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) ?? `HTTP ${res.status}` };
    return {
      ok: true,
      qualityReport: data.qualityReport as PronunciationQaResult['qualityReport'],
      audioVersion: data.audioVersion as PronunciationQaResult['audioVersion'],
      transcript: data.transcript as string | undefined,
      audit: data.audit as PronunciationQaResult['audit'],
    };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * Fetch the stored preview MP3 (proxied from the private blob) as a Blob for
 * playback. Returns null when offline or no audio has been rendered yet.
 */
export async function fetchEpisodeAudio(projectId: string): Promise<Blob | null> {
  if (!apiEnabled()) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/audio`, {
      method: 'GET',
      headers: await authHeaders(),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

/** Base64-encode a Blob/File without blowing the call stack on large inputs. */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface ExtractTextResult {
  ok: boolean;
  text?: string;
  pages?: number;
  error?: string;
}

/**
 * Extract plain text from a binary document (PDF/DOCX/image) using the backend
 * Document Intelligence integration, so the "upload a finished script" flow can
 * parse it. Nothing is persisted. Returns `{ ok: false }` when offline or the
 * backend/Document Intelligence is unavailable, so the SPA can fall back to a
 * paste-the-text path.
 */
export async function extractText(file: File | Blob, actor: ActorContext): Promise<ExtractTextResult> {
  if (!apiEnabled()) return { ok: false, error: 'offline' };
  try {
    const contentBase64 = await blobToBase64(file);
    const contentType = file.type || 'application/octet-stream';
    const res = await fetch(`${API_BASE_URL}/api/extract-text`, {
      method: 'POST',
      headers: await authHeaders(actor),
      body: JSON.stringify({ contentBase64, contentType }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) ?? `HTTP ${res.status}` };
    return { ok: true, text: (data.text as string) ?? '', pages: data.pages as number | undefined };
  } catch {
    return { ok: false, error: 'network' };
  }
}
