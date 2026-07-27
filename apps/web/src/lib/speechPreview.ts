/**
 * Browser-local speech preview using the Web Speech API (SpeechSynthesis).
 *
 * This is a client-side convenience preview for the demo so the ▶ Play / Sample
 * controls produce audible feedback without a backend. It is NOT Azure AI Speech:
 * real synthesis (Azure Speech neural voices, batch synthesis, and the closed-loop
 * STT pronunciation QA) is server-side and is not wired in this reference
 * implementation — see KNOWN_LIMITATIONS.md.
 */

export type SpeechPreviewOptions = {
  /** BCP-47 locale, e.g. 'de-DE' or 'en-US'. */
  locale?: string;
  /** Playback rate 0.5–2 (1 = normal). */
  rate?: number;
  /** Pitch 0–2 (1 = normal). */
  pitch?: number;
  /** Volume 0–1 (1 = full). */
  volume?: number;
};

/** True when the current browser can synthesize speech locally. */
export function isSpeechPreviewSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Best-effort match of an installed browser voice to the requested locale. */
function pickVoice(locale?: string): SpeechSynthesisVoice | undefined {
  if (!locale) return undefined;
  const voices = window.speechSynthesis.getVoices();
  const lc = locale.toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase() === lc) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(lc.slice(0, 2)))
  );
}

/**
 * True when the browser has an installed voice for `locale` (or its language).
 * Callers use this to avoid the misleading experience of a browser voice reading
 * one language with another language's accent (e.g. German text spoken by an
 * en-US voice) when the correct voice is not available.
 */
export function hasVoiceForLocale(locale?: string): boolean {
  return isSpeechPreviewSupported() && pickVoice(locale) !== undefined;
}

/** Stop any in-progress preview. */
export function stopSpeechPreview(): void {
  if (isSpeechPreviewSupported()) window.speechSynthesis.cancel();
}

/**
 * Speak `text` with the browser's built-in TTS. Only one preview plays at a time
 * (a new call cancels the previous one). `onEnd` fires when playback completes,
 * errors, or is cancelled. Returns a stop function.
 */
export function speakPreview(
  text: string,
  opts: SpeechPreviewOptions = {},
  onEnd?: () => void,
): () => void {
  if (!isSpeechPreviewSupported() || !text.trim()) {
    onEnd?.();
    return () => {};
  }
  const synth = window.speechSynthesis;
  synth.cancel(); // ensure only one preview at a time

  const utterance = new SpeechSynthesisUtterance(text);
  if (opts.locale) utterance.lang = opts.locale;
  const voice = pickVoice(opts.locale);
  if (voice) utterance.voice = voice;
  utterance.rate = clamp(opts.rate ?? 1, 0.5, 2);
  utterance.pitch = clamp(opts.pitch ?? 1, 0, 2);
  utterance.volume = clamp(opts.volume ?? 1, 0, 1);
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  synth.speak(utterance);
  return () => synth.cancel();
}

/** Map the friendly `rate` control (keyword or numeric multiplier) to a Web Speech rate. */
export function rateToNumber(rate: string | number | undefined): number {
  if (typeof rate === 'number') return clamp(rate, 0.5, 2);
  switch (rate) {
    case 'x-slow':
      return 0.6;
    case 'slow':
      return 0.8;
    case 'fast':
      return 1.3;
    case 'x-fast':
      return 1.5;
    default:
      return 1;
  }
}

/** Map the friendly `pitch` control (keyword or numeric) to a Web Speech pitch value. */
export function pitchToNumber(pitch: string | number | undefined): number {
  if (typeof pitch === 'number') return 1;
  switch (pitch) {
    case 'x-low':
      return 0.7;
    case 'low':
      return 0.8;
    case 'high':
      return 1.2;
    case 'x-high':
      return 1.3;
    default:
      return 1;
  }
}

/** Map the friendly `volume` control (keyword or numeric) to a Web Speech volume value (max 1). */
export function volumeToNumber(volume: string | number | undefined): number {
  if (typeof volume === 'number') return clamp(volume > 1 ? volume / 100 : volume, 0, 1);
  switch (volume) {
    case 'silent':
      return 0;
    case 'x-soft':
      return 0.4;
    case 'softer':
    case 'soft':
      return 0.6;
    default:
      return 1;
  }
}
