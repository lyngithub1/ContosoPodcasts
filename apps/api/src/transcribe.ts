/**
 * Azure AI Speech — fast transcription (speech-to-text).
 *
 * Powers the closed-loop pronunciation QA pass: after we synthesize the episode
 * we re-transcribe the audio and compare how each medical term was actually
 * pronounced against its expected spoken form. This is a *real* second opinion
 * from the recognizer, not a simulated score.
 *
 * Auth uses the platform managed identity with a plain Microsoft Entra bearer
 * token (scope https://cognitiveservices.azure.com/.default). The custom-domain
 * Cognitive Services endpoint accepts Entra tokens directly on the
 * fast-transcription REST API — the `aad#{resourceId}#{token}` form is only for
 * the Speech SDK/websocket endpoints, not this REST surface. No account key.
 */

import { config } from './config.js';
import { getToken } from './azure.js';

const COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default';
const API_VERSION = '2024-11-15';

export function transcribeEnabled(): boolean {
  return Boolean(config.speechEndpoint && config.speechResourceId);
}

export interface TranscriptResult {
  text: string;
  durationMs: number;
  raw: unknown;
}

/**
 * Transcribe a short audio clip synchronously via the fast-transcription API.
 * Returns the combined recognized text plus the reported audio duration.
 */
export async function transcribe(
  audio: Buffer,
  locale: string,
  contentType = 'audio/mpeg',
): Promise<TranscriptResult> {
  if (!transcribeEnabled()) throw new Error('Speech transcription is not configured');
  const aadToken = await getToken(COGNITIVE_SCOPE);

  const endpoint = config.speechEndpoint!.replace(/\/+$/, '');
  const url = `${endpoint}/speechtotext/transcriptions:transcribe?api-version=${API_VERSION}`;

  const form = new FormData();
  form.append('audio', new Blob([audio], { type: contentType }), 'audio.mp3');
  form.append('definition', JSON.stringify({ locales: [locale] }));

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${aadToken}` },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Transcription failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const json = (await response.json()) as {
    combinedPhrases?: Array<{ text?: string }>;
    duration?: number;
    durationMilliseconds?: number;
  };
  const text = (json.combinedPhrases ?? [])
    .map((p) => p.text ?? '')
    .join(' ')
    .trim();
  const durationMs = json.durationMilliseconds ?? json.duration ?? 0;
  return { text, durationMs, raw: json };
}
