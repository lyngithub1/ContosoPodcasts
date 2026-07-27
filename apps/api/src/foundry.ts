/**
 * Microsoft Foundry agent adapter (grounded script generation).
 *
 * Invokes a deployed Foundry *prompt agent* through the Responses API:
 *   POST {projectEndpoint}/openai/v1/responses
 *   { "agent_reference": { "type": "agent_reference", "name": "<agent>" }, "input": "<prompt>" }
 * The call is synchronous — the completed response is returned in one request
 * (no thread/run polling). Auth uses the platform managed identity
 * (scope https://ai.azure.com/.default) via DefaultAzureCredential — no secrets.
 *
 * This capability is OFF unless FOUNDRY_PROJECT_ENDPOINT is set AND the platform
 * managed identity has been granted a data-plane role (Cognitive Services User /
 * Azure AI Developer) on the Foundry account that hosts the agents. Until then
 * the endpoint reports 501 and the SPA keeps its authored sample scripts.
 */

import { config } from './config.js';
import { getToken } from './azure.js';

const AI_SCOPE = 'https://ai.azure.com/.default';

/** The deployed prompt agent that turns an evidence brief into a grounded script. */
export const SCRIPT_AGENT = 'podcast-script-generator';

export function foundryEnabled(): boolean {
  return Boolean(config.foundryProjectEndpoint);
}

/** Shape of the Responses API payload we care about. */
interface ResponsesResult {
  status?: string;
  error?: unknown;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: unknown }>;
  }>;
}

/** Collect all assistant `output_text` parts from a Responses API result. */
function extractResponseText(resp: ResponsesResult): string {
  if (typeof resp.output_text === 'string' && resp.output_text.trim()) return resp.output_text.trim();
  const parts: string[] = [];
  for (const item of resp.output ?? []) {
    for (const c of item.content ?? []) {
      if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('').trim();
}

/**
 * Run a Foundry prompt agent with a single user prompt and return its reply text.
 * Uses the Responses API `agent_reference` entry point (synchronous).
 */
export async function runAgent(agentName: string, prompt: string): Promise<string> {
  if (!foundryEnabled()) throw new Error('Foundry is not configured');

  const token = await getToken(AI_SCOPE);
  const base = config.foundryProjectEndpoint!.replace(/\/+$/, '');
  const url = `${base}/openai/v1/responses`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_reference: { type: 'agent_reference', name: agentName },
      input: prompt,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Foundry responses call failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const result = (await response.json()) as ResponsesResult;
  if (result.status && result.status !== 'completed') {
    throw new Error(`Foundry response ended with status "${result.status}"`);
  }
  return extractResponseText(result);
}

// --- Grounded script generation --------------------------------------------

export interface StructuredEvidenceBrief {
  researchQuestion?: string;
  studyDesign?: string;
  population?: string;
  interventionComparator?: string;
  endpoints?: string[];
  efficacyResults?: string[];
  safetyResults?: string[];
  limitations?: string[];
  uncertainty?: string[];
}

export interface ScriptBriefInput {
  /** Project title / topic the episode is about. */
  title: string;
  /** BCP-47 output locale, e.g. de-DE. */
  locale: string;
  /** Script form, e.g. host-expert / plain-narration. */
  scriptForm: string;
  targetDurationMinutes: number;
  /** Distinct speaker labels the model must use (e.g. ["Host", "Expert"]). */
  speakerLabels: string[];
  /** Accepted structured evidence for the project (or null when unavailable). */
  evidence: StructuredEvidenceBrief | null;
  /** Accepted, non-excluded claims the model may cite by id. */
  claims: Array<{ id: string; statement: string; kind: string }>;
  /** Disclosure points that must appear in the opening segment. */
  disclosureRequirements: string[];
}

export interface GeneratedSegment {
  speaker: string;
  heading: string | null;
  directionCue: string | null;
  text: string;
  claimIds: string[];
}

export interface GeneratedScript {
  title: string;
  segments: GeneratedSegment[];
}

const DEFAULT_DISCLOSURES = [
  'This audio was generated using synthetic speech.',
  'This content is informational and is not medical advice.',
];

function bulletize(label: string, values: string[] | undefined): string | null {
  const items = (values ?? []).map((v) => String(v).trim()).filter(Boolean);
  if (items.length === 0) return null;
  return `${label}: ${items.join('; ')}`;
}

/** Assemble the grounded user prompt that overrides the agent's default markdown output. */
function buildScriptPrompt(input: ScriptBriefInput): string {
  const ev = input.evidence;
  const evLines = ev
    ? [
        ev.researchQuestion ? `Research question: ${ev.researchQuestion}` : null,
        ev.studyDesign ? `Study design: ${ev.studyDesign}` : null,
        ev.population ? `Population: ${ev.population}` : null,
        ev.interventionComparator ? `Intervention vs comparator: ${ev.interventionComparator}` : null,
        bulletize('Endpoints', ev.endpoints),
        bulletize('Efficacy results', ev.efficacyResults),
        bulletize('Safety results', ev.safetyResults),
        bulletize('Limitations', ev.limitations),
        bulletize('Uncertainty', ev.uncertainty),
      ]
        .filter(Boolean)
        .join('\n')
    : '(no structured evidence is available; rely only on the CLAIMS below and openly acknowledge the limited evidence)';

  const claimLines = input.claims.length
    ? input.claims.map((c) => `- ${c.id} [${c.kind}]: ${c.statement}`).join('\n')
    : '(no accepted claims were provided)';

  const disclosures = (input.disclosureRequirements.length ? input.disclosureRequirements : DEFAULT_DISCLOSURES)
    .map((d) => `- ${d}`)
    .join('\n');

  return [
    `Write a ${input.scriptForm} podcast script in locale ${input.locale} about: ${input.title}.`,
    `Target length: about ${input.targetDurationMinutes} minutes.`,
    '',
    'Return ONLY valid JSON (no markdown, no code fences, no commentary) with EXACTLY this shape:',
    '{"title": string, "segments": [{"speaker": string, "heading": string|null, "directionCue": string|null, "text": string, "claimIds": string[]}]}',
    '',
    'Rules:',
    '- Ground every factual statement ONLY in the EVIDENCE and CLAIMS below. Do not add facts, numbers, or citations that are not present. If something is missing, have a speaker acknowledge the uncertainty rather than inventing it.',
    '- The FIRST segment must be a synthetic-media disclosure that states the audio is AI-generated and the content is informational, not medical advice.',
    `- Use ONLY these speaker labels, spelled exactly: ${input.speakerLabels.join(', ')}.`,
    '- In "claimIds", cite claims by their EXACT id from the CLAIMS list for any segment that states them. Use [] for the disclosure, intros, transitions, and outro. Never invent ids that are not in the CLAIMS list.',
    `- Write all "text" in ${input.locale}. Keep sentences natural and friendly for text-to-speech; avoid unpronounceable symbols and spell out abbreviations on first use.`,
    '- Distinguish association from causation and convey uncertainty faithfully; do not overstate the findings.',
    '',
    'EVIDENCE:',
    evLines,
    '',
    'CLAIMS (cite by id):',
    claimLines,
    '',
    'REQUIRED DISCLOSURE POINTS (include in the first segment):',
    disclosures,
  ].join('\n');
}

/** Strip markdown code fences and isolate the JSON object from a model reply. */
function isolateJson(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return text;
}

function coerceSegment(raw: unknown, allowed: Set<string>, fallbackSpeaker: string): GeneratedSegment | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const text = String(s.text ?? '').trim();
  if (!text) return null;
  const claimIds = Array.isArray(s.claimIds)
    ? s.claimIds.filter((id): id is string => typeof id === 'string' && allowed.has(id))
    : [];
  return {
    speaker: typeof s.speaker === 'string' && s.speaker.trim() ? s.speaker.trim() : fallbackSpeaker,
    heading: typeof s.heading === 'string' && s.heading.trim() ? s.heading.trim() : null,
    directionCue: typeof s.directionCue === 'string' && s.directionCue.trim() ? s.directionCue.trim() : null,
    text,
    claimIds,
  };
}

/** Parse + validate the model's JSON reply into a GeneratedScript. */
function parseGeneratedScript(raw: string, allowedClaimIds: Set<string>, speakerLabels: string[]): GeneratedScript {
  const fallbackSpeaker = speakerLabels[0] ?? 'Narrator';
  let obj: unknown;
  try {
    obj = JSON.parse(isolateJson(raw));
  } catch (err) {
    throw new Error(`Model did not return valid JSON: ${(err as Error).message}`);
  }
  if (!obj || typeof obj !== 'object') throw new Error('Model returned a non-object payload');
  const o = obj as Record<string, unknown>;
  const segRaw = Array.isArray(o.segments) ? o.segments : [];
  const segments = segRaw
    .map((s) => coerceSegment(s, allowedClaimIds, fallbackSpeaker))
    .filter((s): s is GeneratedSegment => s !== null);
  if (segments.length === 0) throw new Error('Model returned no usable script segments');
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : 'Generated script';
  return { title, segments };
}

/**
 * Generate a grounded podcast script by running the deployed Foundry
 * podcast-script-generator agent against an evidence brief. The returned script
 * is validated: claim ids are constrained to the supplied accepted set and the
 * output must contain at least one usable segment.
 */
export async function generateGroundedScript(input: ScriptBriefInput): Promise<GeneratedScript> {
  const prompt = buildScriptPrompt(input);
  const raw = await runAgent(SCRIPT_AGENT, prompt);
  const allowed = new Set(input.claims.map((c) => c.id));
  return parseGeneratedScript(raw, allowed, input.speakerLabels);
}
