import { describe, expect, it } from 'vitest';
import type { SpeechAnnotation } from '@studio/domain';
import { buildSpeakDocument, projectSegment, type VoiceCapability } from './project.js';
import { escapeXml } from './escape.js';

const fullVoice: VoiceCapability = {
  voiceName: 'de-DE-KatjaNeural',
  locale: 'de-DE',
  supportedStyles: ['calm', 'explanatory', 'cautious', 'authoritative'],
  supportedSsml: {
    prosodyRate: true,
    prosodyPitch: true,
    prosodyVolume: true,
    emphasis: true,
    breakTag: true,
    phoneme: true,
    sayAs: true,
    lexicon: true,
    lang: true,
  },
};

const limitedVoice: VoiceCapability = {
  voiceName: 'foundry-audio-basic',
  locale: 'en-US',
  supportedStyles: [],
  supportedSsml: {
    prosodyRate: true,
    prosodyPitch: false,
    prosodyVolume: false,
    emphasis: false,
    breakTag: true,
    phoneme: false,
    sayAs: false,
    lexicon: false,
    lang: false,
  },
};

function ann(partial: Partial<SpeechAnnotation> & { range: SpeechAnnotation['range'] }): SpeechAnnotation {
  return { id: 'a1', ...partial };
}

describe('projectSegment', () => {
  it('returns escaped plain text when there are no annotations', () => {
    const { ssml, warnings } = projectSegment('Doravirine & Islatravir <trial>', [], fullVoice);
    expect(ssml).toBe(escapeXml('Doravirine & Islatravir <trial>'));
    expect(ssml).not.toContain('<trial>');
    expect(warnings).toHaveLength(0);
  });

  it('projects IPA pronunciation using <phoneme> when supported', () => {
    const text = 'Doravirine reduced viral load';
    const a = ann({ range: { segmentId: 's1', start: 0, end: 10 }, pronunciation: { ipa: 'ˌdɔːrəˈvɪriːn', locale: 'de-DE' } });
    const { ssml } = projectSegment(text, [a], fullVoice);
    expect(ssml).toContain('<phoneme alphabet="ipa" ph="ˌdɔːrəˈvɪriːn">Doravirine</phoneme>');
  });

  it('falls back to sounds-like when phoneme is unsupported, with a warning', () => {
    const text = 'Islatravir is investigational';
    const a = ann({ range: { segmentId: 's1', start: 0, end: 10 }, pronunciation: { ipa: 'ɪsˈlætrəvɪr', soundsLike: 'iss-LA-tra-veer' } });
    const { ssml, warnings } = projectSegment(text, [a], limitedVoice);
    expect(ssml).toContain('iss-LA-tra-veer');
    expect(ssml).not.toContain('<phoneme');
    expect(warnings.some((w) => w.code === 'phoneme-fallback-soundslike')).toBe(true);
  });

  it('warns (not silently drops) when a directive is unsupported', () => {
    const text = 'HIV-1 RNA';
    const a = ann({ range: { segmentId: 's1', start: 0, end: 9 }, pitch: 'high', emphasis: 'strong' });
    const { warnings } = projectSegment(text, [a], limitedVoice);
    expect(warnings.some((w) => w.code === 'unsupported-prosody-pitch')).toBe(true);
    expect(warnings.some((w) => w.code === 'unsupported-emphasis')).toBe(true);
  });

  it('emits say-as for trial identifiers when supported', () => {
    const text = 'NCT04233879';
    const a = ann({ range: { segmentId: 's1', start: 0, end: 11 }, speakAs: 'trial-id' });
    const { ssml } = projectSegment(text, [a], fullVoice);
    expect(ssml).toContain('<say-as interpret-as="characters">NCT04233879</say-as>');
  });

  it('adds break tags for pauses and clamps extreme values', () => {
    const text = 'Consider the safety findings';
    const a = ann({ range: { segmentId: 's1', start: 0, end: 8 }, pauseBeforeMs: 350, pauseAfterMs: 999999 });
    const { ssml } = projectSegment(text, [a], fullVoice);
    expect(ssml).toContain('<break time="350ms"/>');
    expect(ssml).toContain('<break time="10000ms"/>');
  });

  it('applies express-as style only when the voice supports it', () => {
    const text = 'A word of caution';
    const a = ann({ range: { segmentId: 's1', start: 0, end: 6 }, style: 'cautious' });
    const supported = projectSegment(text, [a], fullVoice);
    expect(supported.ssml).toContain('<mstts:express-as style="cautious">');

    const unsupported = projectSegment(text, [ann({ range: { segmentId: 's1', start: 0, end: 6 }, style: 'cautious' })], limitedVoice);
    expect(unsupported.ssml).not.toContain('express-as');
    expect(unsupported.warnings.some((w) => w.code === 'unsupported-style')).toBe(true);
  });

  it('skips overlapping annotations to keep SSML valid', () => {
    const text = 'Doravirine and Islatravir';
    const a = ann({ id: 'a1', range: { segmentId: 's1', start: 0, end: 10 }, emphasis: 'strong' });
    const b = ann({ id: 'a2', range: { segmentId: 's1', start: 5, end: 15 }, emphasis: 'moderate' });
    const { warnings } = projectSegment(text, [a, b], fullVoice);
    expect(warnings.some((w) => w.code === 'overlapping-annotation')).toBe(true);
  });

  it('reports out-of-range annotations', () => {
    const text = 'short';
    const a = ann({ range: { segmentId: 's1', start: 0, end: 99 } });
    const { warnings } = projectSegment(text, [a], fullVoice);
    expect(warnings.some((w) => w.code === 'invalid-range')).toBe(true);
  });

  it('resists XML injection from acquired content', () => {
    const text = '</speak><script>alert(1)</script>';
    const { ssml } = projectSegment(text, [], fullVoice);
    expect(ssml).not.toContain('<script>');
    expect(ssml).not.toContain('</speak>');
    expect(ssml).toContain('&lt;script&gt;');
  });
});

describe('buildSpeakDocument', () => {
  it('wraps turns in a namespaced speak document', () => {
    const doc = buildSpeakDocument({
      locale: 'de-DE',
      turns: [
        { voiceName: 'de-DE-KatjaNeural', inner: 'Willkommen.' },
        { voiceName: 'de-DE-ConradNeural', inner: 'Danke.' },
      ],
    });
    expect(doc).toContain('<speak version="1.0"');
    expect(doc).toContain('xmlns:mstts="https://www.w3.org/2001/mstts"');
    expect(doc).toContain('xml:lang="de-DE"');
    expect(doc).toContain('<voice name="de-DE-KatjaNeural">Willkommen.</voice>');
    expect(doc).toContain('<voice name="de-DE-ConradNeural">Danke.</voice>');
  });

  it('includes a lexicon reference when provided', () => {
    const doc = buildSpeakDocument({
      locale: 'en-US',
      lexiconUri: 'https://storage/lexicons/onco-v3.xml',
      turns: [{ voiceName: 'en-US-JennyNeural', inner: 'Hello.' }],
    });
    expect(doc).toContain('<lexicon uri="https://storage/lexicons/onco-v3.xml"/>');
  });
});
