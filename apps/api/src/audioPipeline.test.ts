/**
 * Tests for synthesis batching.
 *
 * Azure AI Speech rejects any single `/cognitiveservices/v1` request that would
 * generate more than ~10 minutes of audio (HTTP 400, empty body). A 64-segment
 * German script — roughly 21 minutes — therefore could never render, which is
 * the bug these tests lock down.
 */

import { describe, expect, it } from 'vitest';
import { chunkSegmentsForSynthesis } from './audioPipeline.js';

/** ~14 characters per second of speech, per the measured rate. */
const CHARS_PER_SECOND = 14;

function seg(text: string) {
  return { text };
}

/** Segment whose narration lasts roughly `seconds`. */
function segOfSeconds(seconds: number) {
  return seg('x'.repeat(Math.round(seconds * CHARS_PER_SECOND)));
}

function batchSeconds(batch: Array<{ text?: unknown }>): number {
  return batch.reduce((total, s) => total + String(s.text ?? '').length / CHARS_PER_SECOND + 0.45, 0);
}

describe('chunkSegmentsForSynthesis', () => {
  it('keeps a short script in a single request', () => {
    const batches = chunkSegmentsForSynthesis([segOfSeconds(30), segOfSeconds(30), segOfSeconds(30)]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it('splits a script that would exceed the per-request cap', () => {
    // ~21 minutes, mirroring the script that failed in production.
    const segments = Array.from({ length: 64 }, () => segOfSeconds(20));
    const batches = chunkSegmentsForSynthesis(segments);
    expect(batches.length).toBeGreaterThan(1);
  });

  it('keeps every batch inside the duration budget', () => {
    const segments = Array.from({ length: 64 }, () => segOfSeconds(20));
    for (const batch of chunkSegmentsForSynthesis(segments)) {
      expect(batchSeconds(batch)).toBeLessThanOrEqual(7 * 60);
    }
  });

  it('never drops or reorders a segment', () => {
    const segments = Array.from({ length: 40 }, (_, i) => seg(`segment ${i} ` + 'y'.repeat(400)));
    const flat = chunkSegmentsForSynthesis(segments).flat();
    expect(flat).toHaveLength(segments.length);
    expect(flat.map((s) => s.text)).toEqual(segments.map((s) => s.text));
  });

  it('skips empty and whitespace-only segments', () => {
    const batches = chunkSegmentsForSynthesis([seg('hello'), seg('   '), seg(''), seg('world')]);
    expect(batches.flat().map((s) => s.text)).toEqual(['hello', 'world']);
  });

  it('returns no batches for an empty script', () => {
    expect(chunkSegmentsForSynthesis([])).toEqual([]);
  });

  it('sends an over-long single segment on its own rather than dropping it', () => {
    const huge = segOfSeconds(12 * 60); // 12 min — bigger than the whole budget
    const batches = chunkSegmentsForSynthesis([segOfSeconds(60), huge, segOfSeconds(60)]);
    expect(batches.flat()).toHaveLength(3);
    const hugeBatch = batches.find((b) => b.includes(huge))!;
    expect(hugeBatch).toHaveLength(1);
  });

  it('honours a custom budget', () => {
    const segments = Array.from({ length: 10 }, () => segOfSeconds(60));
    const batches = chunkSegmentsForSynthesis(segments, 120);
    for (const batch of batches) expect(batchSeconds(batch)).toBeLessThanOrEqual(120);
    expect(batches.flat()).toHaveLength(10);
  });

  it('packs segments efficiently rather than one per batch', () => {
    // 7-minute budget, 30-second segments -> ~13 per batch, not 1.
    const segments = Array.from({ length: 26 }, () => segOfSeconds(30));
    const batches = chunkSegmentsForSynthesis(segments);
    expect(batches.length).toBeLessThanOrEqual(3);
    expect(batches[0]!.length).toBeGreaterThan(5);
  });
});
