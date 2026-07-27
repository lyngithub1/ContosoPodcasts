/**
 * Azure AI Speech — real neural-voice text-to-speech via the REST endpoint.
 *
 * Uses Microsoft Entra (managed identity) authentication: an AAD token for the
 * Cognitive Services scope is combined with the Speech resource id into the
 * `aad#{resourceId}#{token}` bearer format the /cognitiveservices/v1 endpoint
 * expects. No account key is used.
 */

import { config } from './config.js';
import { getToken } from './azure.js';

const COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default';
const DEFAULT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

export interface TtsRequest {
  /** Full SSML document (preferred). Overrides text/voice when it starts with <speak>. */
  ssml?: string;
  /** Plain text alternative; wrapped in SSML with the given voice/locale. */
  text?: string;
  /** Azure voice short name, e.g. "de-DE-KatjaNeural". */
  voice?: string;
  locale?: string;
  /** X-Microsoft-OutputFormat value. */
  format?: string;
}

export function speechEnabled(): boolean {
  return Boolean(config.speechEndpoint && config.speechResourceId);
}

const XML_ESCAPES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;',
};

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => XML_ESCAPES[c] ?? c);
}

function buildSsml(req: TtsRequest): string {
  if (req.ssml && req.ssml.trimStart().startsWith('<speak')) return req.ssml;
  const voice = req.voice ?? config.speechDefaultVoice;
  const locale = req.locale ?? (voice.split('-').slice(0, 2).join('-') || 'en-US');
  const inner = req.ssml ?? escapeXml(req.text ?? '');
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
    `<voice name="${voice}">${inner}</voice></speak>`
  );
}

/** Synthesize audio and return it as a Buffer (MP3 by default). */
export async function synthesize(req: TtsRequest): Promise<{ audio: Buffer; contentType: string }> {
  if (!speechEnabled()) throw new Error('Speech synthesis is not configured');
  const aadToken = await getToken(COGNITIVE_SCOPE);
  const bearer = `aad#${config.speechResourceId}#${aadToken}`;
  const endpoint = config.speechEndpoint!.replace(/\/+$/, '');
  const format = req.format ?? DEFAULT_FORMAT;

  // Custom-domain hosts ({name}.cognitiveservices.azure.com) serve the synthesis
  // route under /tts/, whereas the regional {region}.tts.speech.microsoft.com host
  // already carries "tts" in the hostname and uses the bare path.
  const path = /\.tts\.speech\./i.test(endpoint)
    ? '/cognitiveservices/v1'
    : '/tts/cognitiveservices/v1';

  const response = await fetch(`${endpoint}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': format,
      'User-Agent': 'podstudio-api',
    },
    body: buildSsml(req),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Speech synthesis failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  const contentType = format.includes('mp3') ? 'audio/mpeg' : 'audio/wav';
  return { audio, contentType };
}
