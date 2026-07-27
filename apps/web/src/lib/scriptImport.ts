/**
 * Client-side parser that turns a finished podcast script (pasted text or an
 * extracted document) into the studio's domain script model.
 *
 * It recognises the three authoring shapes used across the reference material:
 *   1. Plain narration        — continuous single-narrator prose.
 *   2. Structured narration    — sections introduced by `[bracketed]` delivery
 *                                cues, with `[Pause]` markers.
 *   3. Host / expert dialogue  — turns prefixed with a speaker label (`H:` /
 *                                `E:` / `Host:` / `Expert:` …).
 *
 * A single document may bundle several labelled versions ("Version 1 – …"); the
 * parser returns one entry per version so the UI can let the author pick.
 *
 * This is a deterministic, heuristic parser — no AI. It never throws: malformed
 * input simply yields a best-effort plain-narration result.
 */

import type { ScriptForm } from '@studio/domain';

export interface ParsedSpeaker {
  id: string;
  label: string;
  role: 'narrator' | 'host' | 'expert' | 'guest';
}

export interface ParsedSegment {
  order: number;
  speakerId: string | null;
  heading: string | null;
  directionCue: string | null;
  text: string;
}

export interface ParsedScript {
  /** Human label, e.g. "Version 1 – Plain Text" or "Imported script". */
  label: string;
  form: ScriptForm;
  title: string | null;
  speakers: ParsedSpeaker[];
  segments: ParsedSegment[];
  wordCount: number;
  estimatedDurationSeconds: number;
}

export interface ScriptParseResult {
  versions: ParsedScript[];
}

// --- shared helpers --------------------------------------------------------

/** PDF/export noise that should never reach the parsed script. */
const NOISE_LINE = /^(?:\s*Öffentlich-Public\s*|---\s*PAGE\s+\d+\s*---|\f)\s*$/i;

/** A whole-line `[bracketed]` delivery cue / section heading. */
const BRACKET_LINE = /^\[(.+)\]$/;

/** Labels that look like a speaker prefix but are not (metadata / disclaimers). */
const NON_SPEAKER_LABELS = new Set([
  'titel',
  'title',
  'doi',
  'nct',
  'pmid',
  'version',
  'hauptskript',
  'hinweis',
  'note',
  'quelle',
  'source',
  'url',
]);

const PAUSE_CUE = /\bpause\b/i;
const VERSION_MARKER = /^\s*Version\s+(\d+)\s*(?:[–—:.-]\s*(.*))?$/i;
const TITLE_LINE = /^\s*(?:Titel|Title)\s*:\s*(.+)$/i;
/** Speaker turn: a short label (≤ 18 chars) followed by a colon. */
const SPEAKER_LINE = /^([\p{L}][\p{L}\d .\-]{0,17}):\s*(.*)$/u;
/** A speaker legend line whose "content" is just a role word, e.g. `H: Host`. */
const LEGEND_CONTENT = /^(host|expert|moderator|narrator|gast|guest|sprecher(?:in)?|spezialist|specialist|dr\.?|prof\.?)\b/i;
/**
 * Standalone document section headings (not part of the script body or title),
 * e.g. "Hauptskript" ("main script"). These are dropped so they neither leak
 * into the title nor become a segment.
 */
const SECTION_HEADING = /^(?:haupt-?skript|skript|script|main\s+script|notes?|hinweis|quellen?|sources?|disclaimer|transkript|transcript)$/i;

function stripNoise(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !NOISE_LINE.test(line));
}

function isPauseCue(inner: string): boolean {
  return PAUSE_CUE.test(inner) && inner.trim().length <= 24;
}

/** Split `Intro – calm, deliberate` into a heading and a delivery cue. */
function splitCue(inner: string): { heading: string | null; cue: string | null } {
  const parts = inner.split(/\s*[–—-]\s*/);
  if (parts.length >= 2) {
    const heading = parts[0]!.trim();
    const cue = parts.slice(1).join(' – ').trim();
    return { heading: heading || null, cue: cue || null };
  }
  return { heading: inner.trim() || null, cue: null };
}

function roleFromLabel(label: string): ParsedSpeaker['role'] {
  const key = label.trim().toLowerCase();
  if (/^(h|host|moderator|mod|anchor)\b/.test(key)) return 'host';
  if (/^(e|expert|spezialist|specialist|dr\.?|prof\.?)\b/.test(key)) return 'expert';
  if (/^(g|guest|gast)\b/.test(key)) return 'guest';
  return 'narrator';
}

function defaultLabelForRole(role: ParsedSpeaker['role']): string {
  return role === 'host' ? 'Host' : role === 'expert' ? 'Expert' : role === 'guest' ? 'Guest' : 'Narrator';
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

function isSpeakerLabel(label: string): boolean {
  const key = label.trim();
  const low = key.toLowerCase();
  if (low.length === 0 || low.length > 18) return false;
  if (NON_SPEAKER_LABELS.has(low)) return false;
  // A label with internal spaces is only a speaker when it is an explicit
  // speaker form (e.g. "Speaker 1", "Dr. Smith") — this rejects sentence
  // openers like "Wichtig ist:" that happen to start with a colon.
  if (/\s/.test(key)) {
    return /^(speaker|sprecher(?:in)?|dr\.?|prof\.?|mr\.?|mrs\.?|ms\.?|host|expert|moderator|gast|guest)\b/i.test(key);
  }
  return true;
}

function countWords(segments: ParsedSegment[]): number {
  return segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
}

// --- format detection ------------------------------------------------------

function detectForm(lines: string[]): ScriptForm {
  const speakers = new Set<string>();
  let speakerTurns = 0;
  let brackets = 0;
  for (const raw of lines) {
    const line = raw.replace(/^[•·*\-]\s*/, '').trim();
    if (!line) continue;
    if (BRACKET_LINE.test(line)) {
      brackets++;
      continue;
    }
    const m = line.match(SPEAKER_LINE);
    if (m && isSpeakerLabel(m[1]!)) {
      speakerTurns++;
      speakers.add(m[1]!.trim().toLowerCase());
    }
  }
  if (speakerTurns >= 2 && speakers.size >= 2) return 'host-expert';
  if (brackets >= 2) return 'structured-narration';
  return 'plain-narration';
}

// --- per-form parsers ------------------------------------------------------

function parseHostExpert(lines: string[]): { speakers: ParsedSpeaker[]; segments: ParsedSegment[] } {
  const speakers = new Map<string, ParsedSpeaker>();
  const segments: ParsedSegment[] = [];
  let order = 0;
  let pendingHeading: string | null = null;
  let pendingCue: string | null = null;
  let current: ParsedSegment | null = null;

  const speakerFor = (label: string): ParsedSpeaker => {
    const key = label.trim().toLowerCase();
    let spk = speakers.get(key);
    if (!spk) {
      const role = roleFromLabel(label);
      const nice = label.trim().length <= 2 ? defaultLabelForRole(role) : label.trim();
      spk = { id: `spk-${slug(key)}`, label: nice, role };
      speakers.set(key, spk);
    }
    return spk;
  };

  for (const raw of lines) {
    const line = raw.replace(/^[•·*]\s*/, '').trim();
    if (!line) continue;

    const bracket = line.match(BRACKET_LINE);
    if (bracket) {
      const inner = bracket[1]!.trim();
      if (!isPauseCue(inner)) {
        const { heading, cue } = splitCue(inner);
        pendingHeading = heading;
        pendingCue = cue;
      }
      continue;
    }

    const m = line.match(SPEAKER_LINE);
    if (m && isSpeakerLabel(m[1]!)) {
      const spk = speakerFor(m[1]!);
      const content = m[2]!.trim();
      // A legend line ("H: Host") defines the speaker's display name — not speech.
      if (content && LEGEND_CONTENT.test(content) && content.split(/\s+/).length <= 2) {
        spk.label = content.replace(/[.:]+$/, '').trim();
        spk.role = roleFromLabel(spk.label);
        continue;
      }
      order++;
      current = {
        order,
        speakerId: spk.id,
        heading: pendingHeading,
        directionCue: pendingCue,
        text: content,
      };
      segments.push(current);
      pendingHeading = null;
      pendingCue = null;
      continue;
    }

    // Continuation line for the current turn.
    if (current) {
      current.text = `${current.text} ${line}`.trim();
    } else {
      order++;
      current = { order, speakerId: null, heading: pendingHeading, directionCue: pendingCue, text: line };
      segments.push(current);
      pendingHeading = null;
      pendingCue = null;
    }
  }

  const trimmed = segments.filter((s) => s.text.trim().length > 0);
  trimmed.forEach((s, i) => (s.order = i + 1));
  const usedIds = new Set(trimmed.map((s) => s.speakerId).filter(Boolean) as string[]);
  const usedSpeakers = [...speakers.values()].filter((s) => usedIds.has(s.id));
  return { speakers: usedSpeakers, segments: trimmed };
}

function parseStructured(lines: string[]): { speakers: ParsedSpeaker[]; segments: ParsedSegment[] } {
  const segments: ParsedSegment[] = [];
  let order = 0;
  let current: ParsedSegment | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const bracket = line.match(BRACKET_LINE);
    if (bracket) {
      const inner = bracket[1]!.trim();
      if (isPauseCue(inner)) continue; // delivery hint without content
      const { heading, cue } = splitCue(inner);
      order++;
      current = { order, speakerId: null, heading, directionCue: cue, text: '' };
      segments.push(current);
      continue;
    }

    if (current) {
      current.text = current.text ? `${current.text} ${line}` : line;
    } else {
      order++;
      current = { order, speakerId: null, heading: 'Intro', directionCue: null, text: line };
      segments.push(current);
    }
  }

  const trimmed = segments.filter((s) => s.text.trim().length > 0);
  trimmed.forEach((s, i) => (s.order = i + 1));
  return { speakers: [], segments: trimmed };
}

/** Split an over-long paragraph into groups of ~3 sentences for readability. */
function splitLongParagraph(text: string): string[] {
  if (text.length <= 700) return [text];
  const sentences = text.split(/(?<=[.!?])\s+(?=[\p{Lu}])/u);
  const groups: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    groups.push(sentences.slice(i, i + 3).join(' ').trim());
  }
  return groups.filter(Boolean);
}

function parsePlain(lines: string[]): { speakers: ParsedSpeaker[]; segments: ParsedSegment[] } {
  const paragraphs: string[] = [];
  let buf: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (buf.length) paragraphs.push(buf.join(' ').trim());
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) paragraphs.push(buf.join(' ').trim());

  const blocks = paragraphs
    // drop lone heading-ish tokens (e.g. "Hauptskript")
    .filter((p) => !/^\S{1,15}$/.test(p))
    .flatMap((p) => splitLongParagraph(p));

  const segments: ParsedSegment[] = blocks.map((text, i) => ({
    order: i + 1,
    speakerId: null,
    heading: null,
    directionCue: null,
    text,
  }));
  return { speakers: [], segments };
}

// --- public API ------------------------------------------------------------

/** Parse a single script chunk (no version splitting). */
export function parseChunk(text: string, opts: { label?: string; forceForm?: ScriptForm } = {}): ParsedScript {
  const allLines = stripNoise(text);

  // Title + strip its line(s). PDF wrapping often splits a title across two
  // lines, so a single short continuation line right after "Titel:" is folded
  // back into the title instead of leaking into the first segment.
  let title: string | null = null;
  let awaitingTitleCont = false;
  const body: string[] = [];
  for (const line of allLines) {
    if (!title) {
      const t = line.match(TITLE_LINE);
      if (t) {
        title = t[1]!.trim();
        awaitingTitleCont = !/[.!?:]$/.test(title);
        continue;
      }
      body.push(line);
      continue;
    }
    if (awaitingTitleCont) {
      const trimmed = line.trim();
      if (trimmed === '') {
        body.push(line);
        continue;
      }
      awaitingTitleCont = false;
      const sp = trimmed.match(SPEAKER_LINE);
      const structural = BRACKET_LINE.test(trimmed) || VERSION_MARKER.test(trimmed) || (sp !== null && isSpeakerLabel(sp[1]!));
      if (!structural && !SECTION_HEADING.test(trimmed) && trimmed.split(/\s+/).length <= 6) {
        title = `${title} ${trimmed}`.trim();
        continue;
      }
      body.push(line);
      continue;
    }
    body.push(line);
  }

  // Standalone section headings ("Hauptskript") are structural noise, never
  // script content — drop them so they don't become a segment.
  const cleanBody = body.filter((l) => !SECTION_HEADING.test(l.trim()));

  const form = opts.forceForm ?? detectForm(cleanBody);
  const parsed =
    form === 'host-expert'
      ? parseHostExpert(cleanBody)
      : form === 'structured-narration'
        ? parseStructured(cleanBody)
        : parsePlain(cleanBody);

  const wordCount = countWords(parsed.segments);
  return {
    label: opts.label ?? 'Imported script',
    // custom-template has no dedicated parser — fall back to plain shaping.
    form: form === 'custom-template' ? 'structured-narration' : form,
    title,
    speakers: parsed.speakers,
    segments: parsed.segments,
    wordCount,
    // ~145 spoken words/min for careful medical narration.
    estimatedDurationSeconds: Math.max(30, Math.round((wordCount / 145) * 60)),
  };
}

/**
 * Parse a document that may contain one or more labelled script versions.
 * Returns one {@link ParsedScript} per version (or a single entry when the
 * document has no version markers).
 */
export function parseScriptDocument(raw: string): ScriptParseResult {
  const chunks = splitScriptVersions(raw);
  const versions = chunks
    .map((c) => parseChunk(c.text, { label: c.label }))
    .filter((v) => v.segments.length > 0);
  return { versions };
}

/**
 * Split a document into its labelled script versions ("Version 1 – …"), keeping
 * the raw text of each so callers can re-parse with a forced form. When the
 * document has no version markers a single "Imported script" chunk is returned.
 */
export function splitScriptVersions(raw: string): { label: string; text: string }[] {
  const lines = stripNoise(raw);

  const markers: { index: number; label: string }[] = [];
  lines.forEach((line, index) => {
    const m = line.match(VERSION_MARKER);
    if (m) {
      const label = m[2]?.trim() ? `Version ${m[1]} – ${m[2]!.trim()}` : `Version ${m[1]}`;
      markers.push({ index, label });
    }
  });

  if (markers.length === 0) {
    return [{ label: 'Imported script', text: lines.join('\n') }];
  }

  const chunks: { label: string; text: string }[] = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i]!.index + 1;
    const end = i + 1 < markers.length ? markers[i + 1]!.index : lines.length;
    chunks.push({ label: markers[i]!.label, text: lines.slice(start, end).join('\n') });
  }
  return chunks;
}
