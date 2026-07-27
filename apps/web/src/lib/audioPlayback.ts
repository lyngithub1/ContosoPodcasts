/**
 * Plays an audio Blob (e.g. MP3 returned by Azure AI Speech) via a single
 * reused <audio> element, returning a stop function. Only one blob plays at a
 * time; starting a new one stops the previous. Object URLs are revoked on
 * end/stop to avoid leaks.
 *
 * The element is REUSED (rather than `new Audio()` per play) so it can be
 * "unlocked" during a user gesture via primeAudioPlayback(): browsers keep a
 * media element user-activated once it has started playing under a click, which
 * lets playback that begins AFTER an async network round-trip (fetching TTS
 * audio) proceed instead of being blocked by the autoplay policy.
 */

// A tiny valid silent WAV used only to unlock the shared element within a
// gesture. If it fails to load the catch is harmless — desktop browsers keep
// sticky user activation after any click regardless.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

let sharedEl: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let boundFinish: (() => void) | null = null;

function ensureEl(): HTMLAudioElement {
  if (!sharedEl) {
    sharedEl = new Audio();
    sharedEl.preload = 'auto';
  }
  return sharedEl;
}

function releaseUrl(): void {
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

function detachListeners(): void {
  if (sharedEl && boundFinish) {
    sharedEl.removeEventListener('ended', boundFinish);
    sharedEl.removeEventListener('error', boundFinish);
  }
  boundFinish = null;
}

export function stopBlobPlayback(): void {
  detachListeners();
  if (sharedEl) {
    sharedEl.pause();
    try {
      sharedEl.removeAttribute('src');
      sharedEl.load();
    } catch {
      /* ignore */
    }
  }
  releaseUrl();
}

/**
 * Unlock audio playback within a user gesture. Call this synchronously inside a
 * click handler BEFORE any `await`, so the shared element becomes user-activated
 * and later playback (after a network fetch) is not blocked by autoplay policy.
 */
export function primeAudioPlayback(): void {
  const el = ensureEl();
  try {
    el.muted = true;
    el.src = SILENT_WAV;
    const p = el.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        // Only pause if we're still on the silent primer (a real blob may have
        // replaced the source by the time this microtask resolves).
        if (el.src === SILENT_WAV) el.pause();
      }).catch(() => {
        /* ignore — sticky activation from the click still applies */
      });
    }
  } catch {
    /* ignore */
  }
}

export interface PlayBlobOptions {
  /** Playback rate multiplier (1 = normal). */
  rate?: number;
  /** Called if playback fails to start (e.g. blocked by autoplay policy). */
  onError?: (err: unknown) => void;
}

/** Play the given audio blob on the shared element. Returns a stop function. */
export function playBlob(blob: Blob, opts: PlayBlobOptions = {}, onEnd?: () => void): () => void {
  const el = ensureEl();
  // Stop anything currently playing and free its URL, but keep the element so
  // its user-activation (from primeAudioPlayback) carries over.
  detachListeners();
  el.pause();
  releaseUrl();

  const url = URL.createObjectURL(blob);
  currentUrl = url;
  el.muted = false;
  el.src = url;
  el.playbackRate = opts.rate ?? 1;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    detachListeners();
    if (currentUrl === url) releaseUrl();
    onEnd?.();
  };
  boundFinish = finish;
  el.addEventListener('ended', finish);
  el.addEventListener('error', finish);

  void el.play().catch((err) => {
    opts.onError?.(err);
    finish();
  });

  return () => {
    el.pause();
    detachListeners();
    if (currentUrl === url) releaseUrl();
  };
}
