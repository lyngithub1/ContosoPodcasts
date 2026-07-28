/**
 * OneDrive / SharePoint delivery adapter (Microsoft Graph).
 *
 * Writes an approved episode — audio, transcript, and a disclosure sidecar —
 * into a folder on a OneDrive or SharePoint document library so recipients can
 * collect it from a location they already trust.
 *
 * ## Auth (no secrets)
 * Uses the platform user-assigned managed identity via `DefaultAzureCredential`
 * to acquire a Microsoft Graph app-only token. The identity needs a Graph
 * **application** permission on the target drive. Prefer `Sites.Selected`,
 * granted on the ONE site that hosts the drive — `Files.ReadWrite.All` would
 * grant the app access to every drive in the tenant and is not least-privilege.
 * See docs/ONEDRIVE.md.
 *
 * ## Why the drive id is configuration
 * Pinning `GRAPH_DRIVE_ID` keeps the blast radius to a single library and makes
 * the destination auditable. The API never discovers or enumerates drives.
 *
 * ## Uploads
 * Graph's simple `PUT .../content` is capped at 4 MiB. A ten-minute 128 kbps
 * episode is roughly 9–10 MB, so anything above the threshold goes through a
 * resumable **upload session** in chunks. Both paths use
 * `conflictBehavior: replace` against a deterministic path, which makes retries
 * idempotent instead of producing "file (1).mp3" duplicates.
 */

import { config } from './config.js';
import { getToken } from './azure.js';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

/** Graph's hard limit for a single-request upload. */
const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** Chunk size for resumable uploads. Must be a multiple of 320 KiB per Graph. */
const CHUNK_BYTES = 5 * 320 * 1024; // 1.6 MiB

export function oneDriveEnabled(): boolean {
  return Boolean(config.graphDriveId);
}

function graphBase(): string {
  return `${config.graphEndpoint.replace(/\/+$/, '')}/v1.0`;
}

/**
 * Characters OneDrive/SharePoint reject in an item name.
 *
 * The cap is deliberately short: the same name is used for BOTH the episode
 * folder and the files inside it, so a generous limit doubles up and pushes the
 * full path toward SharePoint's 400-character ceiling (and breaks outright for
 * anyone who syncs the library to Windows, where MAX_PATH is 260). Real episode
 * titles run well past 100 characters.
 */
function safeName(value: string, fallback: string, maxLength = 60): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|#%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, maxLength)
    .trim()
    .replace(/\.+$/, '');
  return cleaned || fallback;
}

/** Join path segments into a Graph drive path, encoding each segment. */
function encodePath(segments: string[]): string {
  return segments
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/');
}

async function graphFetch(url: string, init: RequestInit & { raw?: boolean } = {}): Promise<Response> {
  const token = await getToken(GRAPH_SCOPE);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

async function graphError(res: Response, action: string): Promise<Error> {
  let detail = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error) detail = `${body.error.code ?? res.status}: ${body.error.message ?? ''}`.trim();
  } catch {
    /* non-JSON error body */
  }
  // Deliberately does not include the token or full request headers.
  return new Error(`${action} failed — ${detail}`);
}

/**
 * Ensure every folder in `segments` exists under the drive root, creating any
 * that are missing. Graph does not auto-create parents for a content PUT.
 */
async function ensureFolderPath(segments: string[]): Promise<void> {
  const walked: string[] = [];
  for (const segment of segments) {
    const parent = walked.length ? `root:/${encodePath(walked)}:` : 'root';
    const res = await graphFetch(`${graphBase()}/drives/${config.graphDriveId}/${parent}/children`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: segment,
        folder: {},
        // Treat an existing folder as success rather than an error.
        '@microsoft.graph.conflictBehavior': 'replace',
      }),
    });
    if (!res.ok && res.status !== 409) throw await graphError(res, `Creating folder "${segment}"`);
    walked.push(segment);
  }
}

export interface UploadedItem {
  name: string;
  /** Human-openable link to the item in OneDrive/SharePoint. */
  webUrl: string;
  size: number;
}

/** Upload <= 4 MiB in a single request. */
async function simpleUpload(path: string, data: Buffer, contentType: string): Promise<UploadedItem> {
  const url = `${graphBase()}/drives/${config.graphDriveId}/root:/${path}:/content?@microsoft.graph.conflictBehavior=replace`;
  const res = await graphFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(data),
  });
  if (!res.ok) throw await graphError(res, `Uploading ${path}`);
  const item = (await res.json()) as { name: string; webUrl: string; size: number };
  return { name: item.name, webUrl: item.webUrl, size: item.size ?? data.length };
}

/** Upload > 4 MiB through a resumable session, in ordered chunks. */
async function sessionUpload(path: string, data: Buffer, contentType: string): Promise<UploadedItem> {
  const createUrl = `${graphBase()}/drives/${config.graphDriveId}/root:/${path}:/createUploadSession`;
  const created = await graphFetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  });
  if (!created.ok) throw await graphError(created, `Creating an upload session for ${path}`);
  const { uploadUrl } = (await created.json()) as { uploadUrl: string };

  const total = data.length;
  for (let offset = 0; offset < total; offset += CHUNK_BYTES) {
    const end = Math.min(offset + CHUNK_BYTES, total);
    const chunk = data.subarray(offset, end);
    // The session URL is pre-authorized — deliberately no Authorization header.
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range': `bytes ${offset}-${end - 1}/${total}`,
        'Content-Type': contentType,
      },
      body: new Uint8Array(chunk),
    });
    if (res.status === 200 || res.status === 201) {
      const item = (await res.json()) as { name: string; webUrl: string; size: number };
      return { name: item.name, webUrl: item.webUrl, size: item.size ?? total };
    }
    if (res.status !== 202) {
      await fetch(uploadUrl, { method: 'DELETE' }).catch(() => undefined); // abandon the session
      throw await graphError(res, `Uploading chunk ${offset}-${end - 1} of ${path}`);
    }
  }
  throw new Error(`Upload of ${path} completed without a final item response`);
}

/** Upload one file, choosing the simple or resumable path by size. */
export async function uploadFile(
  folderSegments: string[],
  fileName: string,
  data: Buffer,
  contentType: string,
): Promise<UploadedItem> {
  if (!oneDriveEnabled()) throw new Error('OneDrive delivery is not configured (set GRAPH_DRIVE_ID)');
  const path = encodePath([...folderSegments, fileName]);
  return data.length > SIMPLE_UPLOAD_MAX_BYTES
    ? sessionUpload(path, data, contentType)
    : simpleUpload(path, data, contentType);
}

export interface EpisodeDelivery {
  /** Episode title, used for the per-episode folder name. */
  title: string;
  projectId: string;
  audio: Buffer;
  transcript: string | null;
  /** Synthetic-media disclosure, written alongside the audio. */
  disclosureStatement: string;
  publishedAt: string;
  publishedBy: string;
  /** Populated into the sidecar so the artifact is self-describing. */
  contentHash: string;
  durationSeconds: number;
}

export interface DeliveryOutcome {
  folder: string;
  audioUrl: string;
  files: UploadedItem[];
}

/**
 * Deliver one episode into `<base folder>/<episode title>/`.
 *
 * The folder name is derived from the episode title and the path is
 * deterministic, so re-publishing the same episode replaces the files rather
 * than accumulating copies.
 */
export async function deliverEpisode(episode: EpisodeDelivery): Promise<DeliveryOutcome> {
  if (!oneDriveEnabled()) throw new Error('OneDrive delivery is not configured (set GRAPH_DRIVE_ID)');

  const baseSegments = config.oneDriveFolderPath
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => safeName(s, 'Podcast Studio'));

  const episodeFolder = safeName(episode.title, episode.projectId);
  const segments = [...baseSegments, episodeFolder];
  await ensureFolderPath(segments);

  const stem = safeName(episode.title, episode.projectId);
  const files: UploadedItem[] = [];

  const audioItem = await uploadFile(segments, `${stem}.mp3`, episode.audio, 'audio/mpeg');
  files.push(audioItem);

  if (episode.transcript) {
    files.push(
      await uploadFile(segments, `${stem} - transcript.txt`, Buffer.from(episode.transcript, 'utf8'), 'text/plain; charset=utf-8'),
    );
  }

  // Self-describing sidecar: the disclosure travels with the audio, so the
  // synthetic-media statement cannot be separated from the file.
  const readme = [
    episode.title,
    '='.repeat(episode.title.length),
    '',
    'AI-GENERATED AUDIO — SYNTHETIC MEDIA DISCLOSURE',
    episode.disclosureStatement,
    '',
    `Published:      ${episode.publishedAt}`,
    `Published by:   ${episode.publishedBy}`,
    `Duration:       ${Math.round(episode.durationSeconds / 60)} min`,
    `Content hash:   ${episode.contentHash}`,
    `Project:        ${episode.projectId}`,
    '',
    'This episode was produced by the Azure Scientific Podcast Studio and',
    'approved by a human reviewer before publication. It is illustrative',
    'content and is not medical advice.',
  ].join('\n');
  files.push(
    await uploadFile(segments, 'README.txt', Buffer.from(readme, 'utf8'), 'text/plain; charset=utf-8'),
  );

  return { folder: segments.join('/'), audioUrl: audioItem.webUrl, files };
}
