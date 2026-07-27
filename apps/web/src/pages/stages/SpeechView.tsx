import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudio } from '../../store/StudioContext';
import type { Project, SpeechAnnotation, SpeechStyle, SpeakAs, VoiceProfile, WorkflowState } from '@studio/domain';
import { HAPPY_PATH } from '@studio/domain';
import { buildSpeakDocument, projectSegment } from '@studio/ssml';
import { Badge, capabilityTone } from '../../components/common/Badge';
import {
  isSpeechPreviewSupported,
  speakPreview,
  stopSpeechPreview,
  rateToNumber,
  pitchToNumber,
  volumeToNumber,
} from '../../lib/speechPreview';
import { synthesizeAudio } from '../../lib/apiClient';
import { playBlob, stopBlobPlayback, primeAudioPlayback } from '../../lib/audioPlayback';

/** Short locale-appropriate line for the voice ▶ Sample preview. */
function sampleLine(locale: string): string {
  return locale.startsWith('de')
    ? 'Willkommen zu dieser wissenschaftlichen Folge. Doravirin und Islatravir zeigten eine gute Verträglichkeit.'
    : 'Welcome to this scientific episode. Doravirine and islatravir showed a favorable safety profile.';
}

const RATE_OPTS: { v: NonNullable<SpeechAnnotation['rate']>; l: string }[] = [
  { v: 'x-slow', l: 'Much slower' },
  { v: 'slow', l: 'Slower' },
  { v: 'medium', l: 'Normal' },
  { v: 'fast', l: 'Faster' },
];
const EMPH_OPTS: NonNullable<SpeechAnnotation['emphasis']>[] = ['none', 'subtle', 'moderate', 'strong'];
const PAUSE_OPTS: { v: number; l: string }[] = [
  { v: 0, l: 'None' },
  { v: 200, l: 'Short' },
  { v: 400, l: 'Medium' },
  { v: 700, l: 'Long' },
];
const PITCH_OPTS: { v: NonNullable<SpeechAnnotation['pitch']>; l: string }[] = [
  { v: 'low', l: 'Lower' },
  { v: 'medium', l: 'Standard' },
  { v: 'high', l: 'Higher' },
];
const VOL_OPTS: NonNullable<SpeechAnnotation['volume']>[] = ['softer', 'standard', 'stronger'];
const STYLE_OPTS: SpeechStyle[] = ['calm', 'authoritative', 'explanatory', 'conversational', 'cautious', 'energetic', 'empathetic', 'neutral'];
const SPEAKAS_OPTS: SpeakAs[] = ['acronym', 'characters', 'cardinal', 'ordinal', 'date', 'dosage', 'unit', 'trial-id', 'doi', 'url'];

export function SpeechView({ project }: { project: Project }) {
  const { scripts, voiceProfiles, upsertAnnotation, removeAnnotation, setScriptVoice, transitionProject, notify } = useStudio();
  const navigate = useNavigate();
  const script = scripts.find((s) => s.projectId === project.id);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  useEffect(() => () => {
    stopSpeechPreview();
    stopBlobPlayback();
  }, []);

  const localeVoices = voiceProfiles.filter((v) => v.locale === project.outputLocale);
  // Start from whatever voice is already locked onto the script (from a prior
  // visit) so the workbench, the preview, and audio review all agree.
  const persistedVoiceId = script?.speakers.find((sp) => sp.voiceProfileId)?.voiceProfileId ?? null;
  const [activeVoiceId, setActiveVoiceId] = useState<string>(persistedVoiceId ?? localeVoices[0]?.id ?? voiceProfiles[0]!.id);
  const [compareIds, setCompareIds] = useState<string[]>(localeVoices.slice(0, 2).map((v) => v.id));
  const [blind, setBlind] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const [segId, setSegId] = useState<string>(script?.segments[0]?.id ?? '');
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);

  const activeVoice = voiceProfiles.find((v) => v.id === activeVoiceId)!;
  const segment = script?.segments.find((s) => s.id === segId);

  // The annotation currently under edit (existing overlapping one, or a draft).
  const editing = useMemo<SpeechAnnotation | null>(() => {
    if (!segment || !selection) return null;
    const existing = segment.annotations.find(
      (a) => a.range.start <= selection.start && a.range.end >= selection.end,
    );
    if (existing) return existing;
    return {
      id: `ann-${segId}-${selection.start}-${selection.end}`,
      range: { segmentId: segId, start: selection.start, end: selection.end },
    };
  }, [segment, selection, segId]);

  const preview = useMemo(() => {
    if (!segment) return null;
    const anns = editing ? [editing] : segment.annotations;
    const { ssml, warnings } = projectSegment(segment.text, anns, activeVoice);
    const doc = buildSpeakDocument({ locale: activeVoice.locale, turns: [{ voiceName: activeVoice.voiceName, inner: ssml }] });
    return { ssml, warnings, doc };
  }, [segment, editing, activeVoice]);

  if (!script) {
    return (
      <div className="panel panel-pad">
        <h3>Speech workbench</h3>
        <p className="muted">Approve a script first to open the pronunciation and speech-quality workbench.</p>
      </div>
    );
  }

  const selectedText = segment && selection ? segment.text.slice(selection.start, selection.end) : '';
  // The preview transition (SCRIPT_APPROVED -> AUDIO_PREVIEW) is a one-way edge,
  // so once it's done the button must offer a forward action rather than sit
  // permanently greyed out.
  const previewGenerated = HAPPY_PATH.indexOf(project.state as WorkflowState) >= HAPPY_PATH.indexOf('AUDIO_PREVIEW');

  function update(partial: Partial<SpeechAnnotation>) {
    if (!editing || !segment) return;
    upsertAnnotation(script!.id, segment.id, { ...editing, ...partial });
  }

  async function playSelectedRegion() {
    if (previewPlaying) {
      stopBlobPlayback();
      stopSpeechPreview();
      setPreviewPlaying(false);
      return;
    }
    const text = selectedText || segment?.text || '';
    if (!text.trim()) return;
    // Unlock playback within this click gesture BEFORE awaiting the network, so
    // the audio isn't blocked by the browser autoplay policy after the fetch.
    primeAudioPlayback();
    setPreviewPlaying(true);

    // Prefer real Azure AI Speech using the projected SSML (honors pronunciation & prosody).
    const ssml = preview?.doc;
    const blob = await synthesizeAudio(
      ssml ? { ssml } : { text, voice: activeVoice.voiceName, locale: activeVoice.locale },
    );
    if (blob) {
      playBlob(
        blob,
        {
          onError: () =>
            notify('warn', 'Your browser blocked audio playback. Click ▶ Play selected region again to allow it.'),
        },
        () => setPreviewPlaying(false),
      );
      return;
    }

    if (!isSpeechPreviewSupported()) {
      notify('warn', 'Browser speech preview is unavailable here. Real synthesis uses Azure AI Speech (configure the backend to enable it).');
      setPreviewPlaying(false);
      return;
    }
    speakPreview(
      text,
      {
        locale: activeVoice.locale,
        rate: rateToNumber(editing?.rate),
        pitch: pitchToNumber(editing?.pitch),
        volume: volumeToNumber(editing?.volume),
      },
      () => setPreviewPlaying(false),
    );
  }

  return (
    <div className="ws-layout">
      <div className="ws-main stack">
        {/* Voice comparison */}
        <section className="panel panel-pad stack">
          <div className="spread">
            <h3>Voice comparison</h3>
            <label className="row" style={{ gap: 6, fontSize: 'var(--fs-sm)' }}>
              <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> Blind A/B/C
            </label>
          </div>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
            A curated set for {project.outputLocale} — not the full catalog. Capabilities drive which
            controls apply and how SSML is projected.
          </p>
          <div className="grid grid-cards">
            {localeVoices.map((v, i) => (
              <VoiceCard
                key={v.id}
                voice={v}
                label={blind ? `Option ${String.fromCharCode(65 + i)}` : v.displayName}
                active={activeVoiceId === v.id}
                inCompare={compareIds.includes(v.id)}
                onSelect={() => {
                  setActiveVoiceId(v.id);
                  // Persist the choice so it carries into episode render + audio review
                  // (otherwise those stages fall back to the first locale voice).
                  setScriptVoice(script.id, v.id);
                }}
                onToggleCompare={() =>
                  setCompareIds((prev) => (prev.includes(v.id) ? prev.filter((x) => x !== v.id) : [...prev, v.id]))
                }
              />
            ))}
          </div>
        </section>

        {/* Segment + word selection */}
        <section className="panel panel-pad stack">
          <div className="spread">
            <h3>Select a word, phrase, or turn</h3>
            <select className="select" style={{ width: 'auto' }} value={segId} onChange={(e) => { setSegId(e.target.value); setSelection(null); }}>
              {script.segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.heading ?? `Segment ${s.order}`} · {script.speakers.find((sp) => sp.id === s.speakerId)?.label ?? 'Narrator'}
                </option>
              ))}
            </select>
          </div>
          {segment && (
            <p className="segment-text">
              <WordTokens
                text={segment.text}
                annotations={segment.annotations}
                selection={selection}
                onSelect={(start, end) => setSelection({ start, end })}
              />
            </p>
          )}
          <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            Tip: click a word to select it. Highlighted words already have speech controls. Use the
            panel on the right — no SSML required.
          </p>
        </section>

        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {project.state === 'SCRIPT_APPROVED' ? (
            <button
              className="btn btn-primary"
              onClick={() => {
                // Lock the currently highlighted voice onto the script so the
                // episode render and audio review use it (even if the user never
                // explicitly clicked a voice card).
                setScriptVoice(script.id, activeVoiceId);
                transitionProject(project.id, 'AUDIO_PREVIEW');
                navigate(`/projects/${project.id}/audio`);
              }}
            >
              Generate preview →
            </button>
          ) : previewGenerated ? (
            <>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setScriptVoice(script.id, activeVoiceId);
                  navigate(`/projects/${project.id}/audio`);
                }}
              >
                Continue to audio review →
              </button>
              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                Preview already generated. Changing a voice here updates the pick — re-render in Audio review to hear it.
              </span>
            </>
          ) : (
            <>
              <button className="btn btn-primary" disabled title="Approve the script to generate a speech preview">
                Generate preview →
              </button>
              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                Approve the script in the Script stage first to generate the speech preview.
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right inspector: How should this sound? */}
      <aside className="inspector panel panel-pad stack">
        <h3 className="inspector-title">How should this sound?</h3>
        {!editing ? (
          <p className="muted">Select a word or phrase in the script to adjust its delivery.</p>
        ) : (
          <>
            <div className="badge badge-info" style={{ alignSelf: 'flex-start' }}>
              <span className="dot" aria-hidden="true" /> “{selectedText}”
            </div>

            <div className="seg-control">
              <label>Pronunciation — sounds like</label>
              <input
                className="input"
                placeholder="e.g. Do-ra-vi-rin"
                value={editing.pronunciation?.soundsLike ?? ''}
                onChange={(e) => update({ pronunciation: { ...editing.pronunciation, soundsLike: e.target.value } })}
              />
            </div>
            <div className="seg-control">
              <label>Speed</label>
              <div className="chip-row">
                {RATE_OPTS.map((r) => (
                  <button key={String(r.v)} className={`chip${editing.rate === r.v ? ' active' : ''}`} onClick={() => update({ rate: r.v })}>
                    {r.l}
                  </button>
                ))}
              </div>
            </div>
            <div className="seg-control">
              <label>Emphasis</label>
              <div className="chip-row">
                {EMPH_OPTS.map((em) => (
                  <button key={em} className={`chip${(editing.emphasis ?? 'none') === em ? ' active' : ''}`} onClick={() => update({ emphasis: em })}>
                    {em}
                  </button>
                ))}
              </div>
            </div>
            <div className="seg-control">
              <label>Pause before / after</label>
              <div className="chip-row">
                {PAUSE_OPTS.map((p) => (
                  <button key={`b${p.v}`} className={`chip${(editing.pauseBeforeMs ?? 0) === p.v ? ' active' : ''}`} onClick={() => update({ pauseBeforeMs: p.v })}>
                    ⟨ {p.l}
                  </button>
                ))}
              </div>
              <div className="chip-row" style={{ marginTop: 6 }}>
                {PAUSE_OPTS.map((p) => (
                  <button key={`a${p.v}`} className={`chip${(editing.pauseAfterMs ?? 0) === p.v ? ' active' : ''}`} onClick={() => update({ pauseAfterMs: p.v })}>
                    {p.l} ⟩
                  </button>
                ))}
              </div>
            </div>
            <div className="seg-control">
              <label>Pitch</label>
              <div className="chip-row">
                {PITCH_OPTS.map((p) => (
                  <button key={String(p.v)} className={`chip${editing.pitch === p.v ? ' active' : ''}`} onClick={() => update({ pitch: p.v })}>
                    {p.l}
                  </button>
                ))}
              </div>
            </div>
            <div className="seg-control">
              <label>Volume</label>
              <div className="chip-row">
                {VOL_OPTS.map((v) => (
                  <button key={v} className={`chip${(editing.volume ?? 'standard') === v ? ' active' : ''}`} onClick={() => update({ volume: v })}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="seg-control">
              <label>Tone / style {activeVoice.supportedStyles.length === 0 && <span className="muted">(voice supports none)</span>}</label>
              <div className="chip-row">
                {STYLE_OPTS.filter((s) => s === 'neutral' || activeVoice.supportedStyles.includes(s)).map((s) => (
                  <button key={s} className={`chip${editing.style === s ? ' active' : ''}`} onClick={() => update({ style: s })}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="seg-control">
              <label>Language treatment</label>
              <div className="chip-row">
                {(['auto', 'de-DE', 'en-US'] as const).map((m) => (
                  <button key={m} className={`chip${(editing.languageMode ?? 'auto') === m ? ' active' : ''}`} onClick={() => update({ languageMode: m })}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="seg-control">
              <label>Speak as</label>
              <select className="select" value={editing.speakAs ?? ''} onChange={(e) => update({ speakAs: (e.target.value || undefined) as SpeakAs | undefined })}>
                <option value="">(default)</option>
                {SPEAKAS_OPTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {segment && selection && segment.annotations.some((a) => a.range.start === selection.start && a.range.end === selection.end) && (
              <button className="btn btn-sm btn-danger" onClick={() => { removeAnnotation(script.id, segment.id, editing.id); setSelection(null); }}>
                Clear controls for this selection
              </button>
            )}

            {/* Live preview of only the selected region */}
            <hr className="hr" />
            <div className="spread">
              <div className="eyebrow">Live preview</div>
              <button className="btn btn-sm" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
                {advanced ? 'Hide' : 'Show'} SSML
              </button>
            </div>
            <div className="waveform" aria-label="Preview waveform (simulated)">
              {Array.from({ length: 40 }).map((_, i) => (
                <span key={i} className="wave-bar" style={{ height: `${20 + Math.abs(Math.sin(i * 0.7)) * 70}%` }} />
              ))}
            </div>
            <button className={`btn btn-sm${previewPlaying ? ' btn-primary' : ''}`} onClick={playSelectedRegion}>
              {previewPlaying ? '⏹ Stop' : '▶ Play selected region'}
            </button>
            <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 4 }}>
              Uses Azure AI Speech neural voices when the backend is configured; otherwise a browser voice preview (simulated).
            </p>

            {preview && preview.warnings.length > 0 && (
              <div>
                <div className="eyebrow" style={{ color: 'var(--status-warn)' }}>
                  ⚠ Fidelity warnings ({activeVoice.displayName})
                </div>
                <ul className="warn-list">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>
                      {w.severity === 'warning' ? '⚠' : 'ℹ'} {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {advanced && preview && (
              <div>
                <div className="eyebrow">Generated SSML (read-only)</div>
                <pre className="ssml-preview">{preview.ssml}</pre>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function VoiceCard({
  voice,
  label,
  active,
  inCompare,
  onSelect,
  onToggleCompare,
}: {
  voice: VoiceProfile;
  label: string;
  active: boolean;
  inCompare: boolean;
  onSelect: () => void;
  onToggleCompare: () => void;
}) {
  const { notify } = useStudio();
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => {
    stopSpeechPreview();
    stopBlobPlayback();
  }, []);

  async function playSample() {
    if (speaking) {
      stopBlobPlayback();
      stopSpeechPreview();
      setSpeaking(false);
      return;
    }
    // Unlock playback within this click gesture BEFORE awaiting the network.
    primeAudioPlayback();
    setSpeaking(true);
    const line = sampleLine(voice.locale);

    // Prefer real Azure AI Speech with this voice; fall back to the browser preview.
    const blob = await synthesizeAudio({ text: line, voice: voice.voiceName, locale: voice.locale });
    if (blob) {
      playBlob(
        blob,
        {
          onError: () =>
            notify('warn', 'Your browser blocked audio playback. Click ▶ Sample again to allow it.'),
        },
        () => setSpeaking(false),
      );
      return;
    }

    if (!isSpeechPreviewSupported()) {
      notify('warn', 'Browser speech preview is unavailable here. Real synthesis uses Azure AI Speech (configure the backend to enable it).');
      setSpeaking(false);
      return;
    }
    speakPreview(line, { locale: voice.locale }, () => setSpeaking(false));
  }

  return (
    <article className={`panel voice-card${active ? ' selected' : ''}`}>
      <div className="spread">
        <strong style={{ fontSize: 'var(--fs-sm)' }}>{label}</strong>
        <Badge tone={capabilityTone(voice.status)}>{voice.status}</Badge>
      </div>
      <span className="muted mono" style={{ fontSize: 'var(--fs-xs)' }}>
        {voice.voiceName}
      </span>
      <span className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>
        {voice.useCase} · {voice.provider}
      </span>
      <div className="tag-row">
        {voice.supportedStyles.slice(0, 3).map((s) => (
          <span key={s} className="tag">
            {s}
          </span>
        ))}
      </div>
      <div className="row">
        <button className={`btn btn-sm${speaking ? ' btn-primary' : ''}`} onClick={playSample}>
          {speaking ? '⏹ Stop' : '▶ Sample'}
        </button>
        <button className={`btn btn-sm${active ? ' btn-primary' : ''}`} onClick={onSelect}>
          {active ? 'Active' : 'Use for preview'}
        </button>
        <label className="row" style={{ gap: 4, fontSize: 'var(--fs-xs)' }}>
          <input type="checkbox" checked={inCompare} onChange={onToggleCompare} /> A/B
        </label>
      </div>
    </article>
  );
}

/** Renders text as clickable word tokens; annotated words are highlighted. */
function WordTokens({
  text,
  annotations,
  selection,
  onSelect,
}: {
  text: string;
  annotations: SpeechAnnotation[];
  selection: { start: number; end: number } | null;
  onSelect: (start: number, end: number) => void;
}) {
  const tokens: { text: string; start: number; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return (
    <>
      {tokens.map((tok, i) => {
        const annotated = annotations.some((a) => a.range.start <= tok.start && a.range.end >= tok.end);
        const selected = selection && selection.start <= tok.start && selection.end >= tok.end;
        return (
          <span key={i}>
            <span
              className={`token${annotated ? ' annotated' : ''}${selected ? ' selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(tok.start, tok.end)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(tok.start, tok.end);
                }
              }}
            >
              {tok.text}
            </span>{' '}
          </span>
        );
      })}
    </>
  );
}
