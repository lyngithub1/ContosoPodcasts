/**
 * Script-to-SSML projection (Specification Section 9).
 *
 * User intent is captured as a provider-neutral {@link SpeechAnnotation} model.
 * At synthesis time we:
 *   1. Validate the selected voice capability profile.
 *   2. Convert supported annotations to SSML.
 *   3. Resolve organization lexicon entries.
 *   4. Normalize unsupported annotations using a documented fallback.
 *   5. Emit warnings when fidelity may change (never silently drop a directive).
 *
 * The output is deterministic and unit-tested so it can gate in CI.
 */

import type {
  Locale,
  SpeechAnnotation,
  SpeakAs,
  VoiceProfile,
} from '@studio/domain';
import { escapeAttr, escapeXml, stripInvalidXmlChars } from './escape.js';

/** Subset of {@link VoiceProfile} needed to project annotations. */
export type VoiceCapability = Pick<VoiceProfile, 'voiceName' | 'locale' | 'supportedStyles' | 'supportedSsml'>;

export type WarningSeverity = 'info' | 'warning';

export interface ProjectionWarning {
  severity: WarningSeverity;
  annotationId: string | null;
  /** Machine-readable code, e.g. "unsupported-phoneme". */
  code: string;
  message: string;
}

export interface SegmentProjection {
  ssml: string;
  warnings: ProjectionWarning[];
}

const RATE_KEYWORDS = new Set(['x-slow', 'slow', 'medium', 'fast', 'x-fast']);
const PITCH_KEYWORDS = new Set(['x-low', 'low', 'medium', 'high', 'x-high']);

const EMPHASIS_MAP: Record<NonNullable<SpeechAnnotation['emphasis']>, string | null> = {
  none: 'none',
  subtle: 'reduced',
  moderate: 'moderate',
  strong: 'strong',
};

const VOLUME_MAP: Record<NonNullable<SpeechAnnotation['volume']>, string> = {
  softer: 'soft',
  standard: 'medium',
  stronger: 'loud',
};

const SAY_AS_MAP: Record<SpeakAs, { interpretAs: string; format?: string }> = {
  acronym: { interpretAs: 'characters', format: 'glyphs' },
  characters: { interpretAs: 'characters' },
  cardinal: { interpretAs: 'cardinal' },
  ordinal: { interpretAs: 'ordinal' },
  date: { interpretAs: 'date', format: 'dmy' },
  dosage: { interpretAs: 'unit' },
  unit: { interpretAs: 'unit' },
  'trial-id': { interpretAs: 'characters' },
  doi: { interpretAs: 'characters' },
  url: { interpretAs: 'characters' },
};

/**
 * Projects a single text run (already sliced to an annotation's range) plus its
 * annotation into an SSML fragment, honoring the voice's declared capabilities.
 */
function projectRun(
  rawText: string,
  annotation: SpeechAnnotation | null,
  cap: VoiceCapability,
  warnings: ProjectionWarning[],
): string {
  let xml = escapeXml(stripInvalidXmlChars(rawText));
  if (!annotation) return xml;

  const aid = annotation.id;

  // --- say-as normalization (numbers, acronyms, trial IDs, DOIs, units) ------
  if (annotation.speakAs) {
    if (cap.supportedSsml.sayAs) {
      const mapping = SAY_AS_MAP[annotation.speakAs];
      const fmt = mapping.format ? ` format="${escapeAttr(mapping.format)}"` : '';
      xml = `<say-as interpret-as="${escapeAttr(mapping.interpretAs)}"${fmt}>${xml}</say-as>`;
    } else {
      warnings.push({
        severity: 'warning',
        annotationId: aid,
        code: 'unsupported-say-as',
        message: `Voice ${cap.voiceName} does not support say-as; spoken as literal text.`,
      });
    }
  }

  // --- pronunciation: phoneme (IPA) or lexicon/sounds-like fallback ----------
  if (annotation.pronunciation) {
    const { ipa, soundsLike, glossaryEntryId } = annotation.pronunciation;
    if (ipa && cap.supportedSsml.phoneme) {
      xml = `<phoneme alphabet="ipa" ph="${escapeAttr(ipa)}">${xml}</phoneme>`;
    } else if (ipa && !cap.supportedSsml.phoneme) {
      // Documented fallback: use sounds-like text if present, else warn.
      if (soundsLike) {
        xml = escapeXml(stripInvalidXmlChars(soundsLike));
        warnings.push({
          severity: 'warning',
          annotationId: aid,
          code: 'phoneme-fallback-soundslike',
          message: `Voice ${cap.voiceName} lacks IPA <phoneme>; using sounds-like spelling instead.`,
        });
      } else {
        warnings.push({
          severity: 'warning',
          annotationId: aid,
          code: 'unsupported-phoneme',
          message: `Voice ${cap.voiceName} lacks IPA support and no sounds-like fallback was provided.`,
        });
      }
    } else if (glossaryEntryId && cap.supportedSsml.lexicon) {
      // Lexicon lookup handled at document level; nothing to inline here.
    } else if (soundsLike && !ipa) {
      xml = escapeXml(stripInvalidXmlChars(soundsLike));
    }
  }

  // --- language treatment for mixed-language passages ------------------------
  if (annotation.languageMode && annotation.languageMode !== 'auto') {
    if (cap.supportedSsml.lang) {
      xml = `<lang xml:lang="${escapeAttr(annotation.languageMode)}">${xml}</lang>`;
    } else {
      warnings.push({
        severity: 'info',
        annotationId: aid,
        code: 'unsupported-lang',
        message: `Voice ${cap.voiceName} does not support inline <lang>; relying on base locale.`,
      });
    }
  }

  // --- emphasis --------------------------------------------------------------
  if (annotation.emphasis && annotation.emphasis !== 'none') {
    if (cap.supportedSsml.emphasis) {
      const level = EMPHASIS_MAP[annotation.emphasis];
      xml = `<emphasis level="${escapeAttr(level ?? 'moderate')}">${xml}</emphasis>`;
    } else {
      warnings.push({
        severity: 'info',
        annotationId: aid,
        code: 'unsupported-emphasis',
        message: `Voice ${cap.voiceName} does not support <emphasis>; directive ignored.`,
      });
    }
  }

  // --- prosody (rate / pitch / volume) ---------------------------------------
  const prosodyAttrs: string[] = [];
  if (annotation.rate !== undefined) {
    if (cap.supportedSsml.prosodyRate) {
      prosodyAttrs.push(`rate="${escapeAttr(prosodyRateValue(annotation.rate))}"`);
    } else {
      warnings.push(prosodyWarning(aid, cap.voiceName, 'rate'));
    }
  }
  if (annotation.pitch !== undefined) {
    if (cap.supportedSsml.prosodyPitch) {
      prosodyAttrs.push(`pitch="${escapeAttr(prosodyPitchValue(annotation.pitch))}"`);
    } else {
      warnings.push(prosodyWarning(aid, cap.voiceName, 'pitch'));
    }
  }
  if (annotation.volume) {
    if (cap.supportedSsml.prosodyVolume) {
      prosodyAttrs.push(`volume="${escapeAttr(VOLUME_MAP[annotation.volume])}"`);
    } else {
      warnings.push(prosodyWarning(aid, cap.voiceName, 'volume'));
    }
  }
  if (prosodyAttrs.length > 0) {
    xml = `<prosody ${prosodyAttrs.join(' ')}>${xml}</prosody>`;
  }

  // --- style (mstts express-as) ---------------------------------------------
  if (annotation.style && annotation.style !== 'neutral') {
    if (cap.supportedStyles.includes(annotation.style)) {
      xml = `<mstts:express-as style="${escapeAttr(annotation.style)}">${xml}</mstts:express-as>`;
    } else {
      warnings.push({
        severity: 'warning',
        annotationId: aid,
        code: 'unsupported-style',
        message: `Voice ${cap.voiceName} does not support style "${annotation.style}"; using default delivery.`,
      });
    }
  }

  // --- pauses (break) --------------------------------------------------------
  let before = '';
  let after = '';
  if (annotation.pauseBeforeMs && annotation.pauseBeforeMs > 0) {
    before = breakTag(annotation.pauseBeforeMs, cap, aid, warnings);
  }
  if (annotation.pauseAfterMs && annotation.pauseAfterMs > 0) {
    after = breakTag(annotation.pauseAfterMs, cap, aid, warnings);
  }

  return `${before}${xml}${after}`;
}

function breakTag(
  ms: number,
  cap: VoiceCapability,
  aid: string,
  warnings: ProjectionWarning[],
): string {
  if (!cap.supportedSsml.breakTag) {
    warnings.push({
      severity: 'info',
      annotationId: aid,
      code: 'unsupported-break',
      message: `Voice ${cap.voiceName} does not support <break>; pause omitted.`,
    });
    return '';
  }
  const clamped = Math.min(Math.max(Math.round(ms), 0), 10_000);
  return `<break time="${clamped}ms"/>`;
}

function prosodyRateValue(rate: NonNullable<SpeechAnnotation['rate']>): string {
  if (typeof rate === 'number') {
    // Interpret as a multiplier -> percentage relative to default.
    const pct = Math.round((rate - 1) * 100);
    return `${pct >= 0 ? '+' : ''}${pct}%`;
  }
  return RATE_KEYWORDS.has(rate) ? rate : 'medium';
}

function prosodyPitchValue(pitch: NonNullable<SpeechAnnotation['pitch']>): string {
  if (typeof pitch === 'number') {
    const clamped = Math.min(Math.max(pitch, -50), 50);
    return `${clamped >= 0 ? '+' : ''}${clamped}%`;
  }
  return PITCH_KEYWORDS.has(pitch) ? pitch : 'medium';
}

function prosodyWarning(aid: string, voiceName: string, feature: string): ProjectionWarning {
  return {
    severity: 'info',
    annotationId: aid,
    code: `unsupported-prosody-${feature}`,
    message: `Voice ${voiceName} does not support prosody ${feature}; directive ignored.`,
  };
}

/**
 * Projects a full segment (text + non-overlapping annotations) into SSML.
 * Annotations are applied over their character ranges; overlaps are reported.
 */
export function projectSegment(
  text: string,
  annotations: readonly SpeechAnnotation[],
  cap: VoiceCapability,
): SegmentProjection {
  const warnings: ProjectionWarning[] = [];
  const sorted = [...annotations].sort((a, b) => a.range.start - b.range.start);

  // Detect + drop overlapping annotations to avoid invalid nesting.
  const applied: SpeechAnnotation[] = [];
  let lastEnd = 0;
  for (const ann of sorted) {
    const { start, end } = ann.range;
    if (start < 0 || end > text.length || start >= end) {
      warnings.push({
        severity: 'warning',
        annotationId: ann.id,
        code: 'invalid-range',
        message: `Annotation range [${start}, ${end}) is outside the segment text; skipped.`,
      });
      continue;
    }
    if (start < lastEnd) {
      warnings.push({
        severity: 'warning',
        annotationId: ann.id,
        code: 'overlapping-annotation',
        message: 'Overlapping speech annotation skipped to keep SSML valid.',
      });
      continue;
    }
    applied.push(ann);
    lastEnd = end;
  }

  let cursor = 0;
  const parts: string[] = [];
  for (const ann of applied) {
    const { start, end } = ann.range;
    if (start > cursor) {
      parts.push(projectRun(text.slice(cursor, start), null, cap, warnings));
    }
    parts.push(projectRun(text.slice(start, end), ann, cap, warnings));
    cursor = end;
  }
  if (cursor < text.length) {
    parts.push(projectRun(text.slice(cursor), null, cap, warnings));
  }

  return { ssml: parts.join(''), warnings };
}

export interface SpeakDocumentInput {
  locale: Locale;
  /** Optional lexicon URI to reference at the document level. */
  lexiconUri?: string;
  /** Pre-projected inner SSML for each voice turn. */
  turns: Array<{ voiceName: string; inner: string }>;
}

/**
 * Wraps projected turns in a complete, namespaced <speak> document ready for
 * Azure Speech synthesis. The generated string is stored as an immutable
 * synthesis artifact and hashed.
 */
export function buildSpeakDocument(input: SpeakDocumentInput): string {
  const lexicon = input.lexiconUri
    ? `<lexicon uri="${escapeAttr(input.lexiconUri)}"/>`
    : '';
  const body = input.turns
    .map((t) => `<voice name="${escapeAttr(t.voiceName)}">${lexicon}${t.inner}</voice>`)
    .join('');
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${escapeAttr(input.locale)}">` +
    `${body}</speak>`
  );
}
