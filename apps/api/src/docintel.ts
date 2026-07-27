/**
 * Azure AI Document Intelligence adapter (REST + managed identity).
 *
 * Uses the `prebuilt-read` model to extract the full text of an uploaded
 * research document (PDF / image / office doc). Auth is an AAD bearer token for
 * the platform managed identity (scope https://cognitiveservices.azure.com/.default);
 * the account has a custom subdomain so token auth is accepted. The MI holds
 * "Cognitive Services User" on the resource.
 *
 * The analyze API is async: POST returns 202 with an Operation-Location header
 * that we poll until the analysis succeeds, then read `analyzeResult.content`.
 */

import { getToken } from './azure.js';
import { config } from './config.js';

const COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default';
const API_VERSION = '2024-11-30';
const MODEL = 'prebuilt-read';

export function docIntelEnabled(): boolean {
  return Boolean(config.docIntelEndpoint);
}

function base(): string {
  const ep = config.docIntelEndpoint;
  if (!ep) throw new Error('DOCINTEL_ENDPOINT is not configured');
  return ep.replace(/\/$/, '');
}

export interface ExtractResult {
  content: string;
  pages: number;
  raw: unknown;
}

/**
 * Extract the plain text of a document. Polls the async operation for up to
 * ~60s (research PDFs are small in this demo).
 */
export async function analyzeDocument(data: Buffer, contentType = 'application/pdf'): Promise<ExtractResult> {
  const token = await getToken(COGNITIVE_SCOPE);
  const submit = await fetch(
    `${base()}/documentintelligence/documentModels/${MODEL}:analyze?api-version=${API_VERSION}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body: data,
    },
  );
  if (submit.status !== 202) {
    throw new Error(`Document Intelligence submit failed: HTTP ${submit.status} ${await submit.text()}`);
  }
  const opLocation = submit.headers.get('operation-location');
  if (!opLocation) throw new Error('Document Intelligence did not return an Operation-Location header');

  const deadline = Date.now() + 60_000;
  // Poll the operation until it terminates. Backoff is fixed and short.
  for (;;) {
    const poll = await fetch(opLocation, { headers: { Authorization: `Bearer ${token}` } });
    if (!poll.ok) throw new Error(`Document Intelligence poll failed: HTTP ${poll.status} ${await poll.text()}`);
    const body = (await poll.json()) as {
      status?: string;
      analyzeResult?: { content?: string; pages?: unknown[] };
    };
    const status = String(body.status ?? '').toLowerCase();
    if (status === 'succeeded') {
      return {
        content: body.analyzeResult?.content ?? '',
        pages: Array.isArray(body.analyzeResult?.pages) ? body.analyzeResult.pages.length : 0,
        raw: body,
      };
    }
    if (status === 'failed') throw new Error(`Document Intelligence analysis failed: ${JSON.stringify(body)}`);
    if (Date.now() > deadline) throw new Error('Document Intelligence analysis timed out');
    await new Promise((r) => setTimeout(r, 1500));
  }
}
