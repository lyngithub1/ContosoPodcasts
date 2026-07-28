import { useEffect, useState } from 'react';
import { useStudio } from '../../store/StudioContext';
import type { Project, RejectionCategory } from '@studio/domain';
import { Badge } from '../../components/common/Badge';
import { isSpeechPreviewSupported, speakPreview, stopSpeechPreview, hasVoiceForLocale } from '../../lib/speechPreview';
import { synthesizeAudio, fetchEpisodeAudio } from '../../lib/apiClient';
import { apiEnabled } from '../../config/api';
import { playBlob, stopBlobPlayback, primeAudioPlayback } from '../../lib/audioPlayback';

const REJECT_CATS: RejectionCategory[] = ['pronunciation', 'factual-script', 'timing', 'voice', 'prosody', 'volume', 'edit-mastering', 'policy-compliance', 'other'];

export function AudioView({ project }: { project: Project }) {
  const { audioVersions, qualityReports, scripts, voiceProfiles, synthesisJobs, overrideQaTerm, transitionProject, addReview, notify, synthesizeEpisode, runPronunciationQa, activeRole } = useStudio();
  const audio = audioVersions.find((a) => a.projectId === project.id);
  const report = audio ? qualityReports.find((r) => r.id === audio.qualityReportId) : undefined;
  const script = scripts.find((s) => s.projectId === project.id);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [rejectCat, setRejectCat] = useState<RejectionCategory>('pronunciation');
  const [rejectReason, setRejectReason] = useState('');
  const [rendering, setRendering] = useState(false);
  const [runningQa, setRunningQa] = useState(false);

  const canRender = apiEnabled() && (activeRole === 'Creator' || activeRole === 'Administrator');
  const canRunQa = apiEnabled() && ['Creator', 'AudioReviewer', 'Administrator'].includes(activeRole);

  useEffect(() => () => {
    stopSpeechPreview();
    stopBlobPlayback();
  }, []);

  async function handleRender() {
    setRendering(true);
    try {
      await synthesizeEpisode(project.id);
    } finally {
      setRendering(false);
    }
  }

  async function handleRunQa() {
    setRunningQa(true);
    try {
      await runPronunciationQa(project.id);
    } finally {
      setRunningQa(false);
    }
  }

  async function togglePlay() {
    if (playing) {
      stopBlobPlayback();
      stopSpeechPreview();
      setPlaying(false);
      return;
    }
    // Unlock playback within this click gesture BEFORE awaiting the network, so
    // the audio isn't blocked by the browser autoplay policy after the fetch.
    primeAudioPlayback();
    setPlaying(true);
    const text = script?.segments.map((s) => s.text).join(' ') ?? '';
    // Use the voice chosen in the Speech workbench (persisted on the script's
    // speakers), falling back to the first verified voice for the output locale.
    const speakerVoiceId = script?.speakers.find((sp) => sp.voiceProfileId)?.voiceProfileId ?? null;
    const voiceProfile =
      voiceProfiles.find((v) => v.id === speakerVoiceId) ??
      voiceProfiles.find((v) => v.locale === project.outputLocale);
    const voice = voiceProfile?.voiceName;
    const locale = voiceProfile?.locale ?? project.outputLocale;

    // Prefer the exact rendered preview stored in Blob Storage (this is the same
    // audio the closed-loop QA transcribed). But if the voice was changed in the
    // Speech workbench after this preview was rendered, that stored blob is stale
    // — synthesize fresh with the newly selected voice instead of replaying the
    // old one.
    const job = audio ? synthesisJobs.find((j) => j.id === audio.synthesisJobId) : undefined;
    const renderedVoiceIds = job?.voiceAssignments ? Object.values(job.voiceAssignments) : [];
    const storedIsStale = Boolean(speakerVoiceId && renderedVoiceIds.length && !renderedVoiceIds.includes(speakerVoiceId));
    const stored = audio && !storedIsStale ? await fetchEpisodeAudio(project.id) : null;
    const blob = stored ?? (await synthesizeAudio({ text, locale, voice }));
    if (blob) {
      playBlob(
        blob,
        {
          rate: speed,
          onError: () =>
            notify('warn', 'Your browser blocked audio playback. Press play again to allow it.'),
        },
        () => setPlaying(false),
      );
      return;
    }

    // Only use the browser voice when it can actually speak the target language.
    // Reading e.g. German with an en-US voice sounds mechanically wrong and would
    // misrepresent the product's real Azure Neural output, so we warn instead.
    if (isSpeechPreviewSupported() && hasVoiceForLocale(locale)) {
      speakPreview(text, { locale, rate: speed }, () => setPlaying(false));
      return;
    }
    notify(
      'warn',
      `Couldn't reach Azure AI Speech for playback, and your browser has no ${locale} voice installed to preview locally. Use “🎙 Re-render” to produce the episode audio with ${voiceProfile?.displayName ?? 'the selected voice'}.`,
    );
    setPlaying(false);
  }

  if (!audio) {
    return (
      <div className="panel panel-pad stack">
        <h3>Audio review</h3>
        <p className="muted">No audio yet. Render a preview from the approved script with Azure AI Speech, or generate one from the Speech workbench.</p>
        {canRender && script && (
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={rendering} onClick={handleRender}>
            {rendering ? 'Rendering…' : '🎙 Render preview (Azure AI Speech)'}
          </button>
        )}
        {project.state === 'AUDIO_PREVIEW' && (
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => transitionProject(project.id, 'AUDIO_REVIEW')}>
            Mark preview ready for review
          </button>
        )}
      </div>
    );
  }

  const blocked = report?.hasBlockingIssues ?? false;
  const canApprove = project.state === 'AUDIO_REVIEW' && !blocked;
  /** Audio has already cleared review; the next move belongs to the Publisher. */
  const alreadyApproved =
    project.state === 'AUDIO_APPROVED' ||
    project.state === 'READY_TO_PUBLISH' ||
    project.state === 'PUBLISHED';
  /**
   * Why the approve button is unavailable. A silently greyed-out control reads
   * as a bug — especially right after a reviewer records a QA override and
   * expects it to unblock something.
   */
  const approveBlockedReason = canApprove
    ? null
    : alreadyApproved
      ? 'This audio has already been approved.'
      : blocked
        ? 'A critical pronunciation mismatch is unresolved. Accept it with a recorded reason above, or reject the audio.'
        : project.state === 'AUDIO_PREVIEW'
          ? 'Send the preview to audio review first.'
          : `Audio can only be approved from the Audio review stage (currently ${project.state}).`;

  return (
    <div className="ws-layout">
      <div className="ws-main stack">
        {blocked && (
          <div className="gate blocked">
            <span aria-hidden="true">⚠</span>
            <span>Critical pronunciation mismatch detected. Resolve or record an override before approving.</span>
          </div>
        )}

        <section className="panel panel-pad stack">
          <div className="spread">
            <h3>Episode preview</h3>
            <span className="muted mono" style={{ fontSize: 'var(--fs-xs)' }}>
              {audio.storageContainer} · {Math.round(audio.durationSeconds / 60)}:{String(audio.durationSeconds % 60).padStart(2, '0')} · {audio.loudnessLufs ? `${audio.loudnessLufs} LUFS · peak ${audio.truePeakDb} dB` : 'loudness not measured'}
            </span>
          </div>

          <div className="waveform" aria-label="Episode waveform">
            {Array.from({ length: 80 }).map((_, i) => (
              <span key={i} className="wave-bar" style={{ height: `${18 + Math.abs(Math.sin(i * 0.35)) * 78}%`, opacity: playing ? 0.85 : 0.5 }} />
            ))}
          </div>

          <div className="transport">
            <button className="btn" onClick={togglePlay} aria-pressed={playing}>
              {playing ? '⏸ Pause' : '▶ Play'}
            </button>
            <button className="btn btn-ghost">⏮ 10s</button>
            <button className="btn btn-ghost">10s ⏭</button>
            <label className="row" style={{ gap: 6, fontSize: 'var(--fs-sm)' }}>
              Speed
              <select className="select" style={{ width: 'auto' }} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {[0.75, 1, 1.25, 1.5].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)' }}>
              Regenerate: selection · sentence · section · full episode
            </span>
          </div>
          <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            ▶ Play uses Azure AI Speech neural voices when the backend is configured; otherwise it falls back to a browser voice preview (simulated).
          </p>
        </section>

        {/* Synchronized script */}
        {script && (
          <section className="panel panel-pad stack">
            <h3>Synchronized transcript</h3>
            {script.segments.map((seg, idx) => (
              <div key={seg.id} className="segment" style={{ borderColor: playing && idx === 1 ? 'var(--az-cyan)' : undefined }}>
                <div className="segment-head">
                  <span className="speaker-chip">{script.speakers.find((sp) => sp.id === seg.speakerId)?.label ?? 'Narrator'}</span>
                  <button className="btn btn-sm btn-ghost">Marker</button>
                  <button className="btn btn-sm btn-ghost">Regenerate</button>
                </div>
                <p className="segment-text" style={{ fontSize: 'var(--fs-sm)' }}>{seg.text}</p>
              </div>
            ))}
          </section>
        )}
      </div>

      <aside className="inspector panel panel-pad stack">
        <h3 className="inspector-title">Pronunciation QA</h3>
        {(canRender || canRunQa) && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {canRender && (
              <button className="btn btn-sm" disabled={rendering} onClick={handleRender}>
                {rendering ? 'Rendering…' : '🎙 Re-render'}
              </button>
            )}
            {canRunQa && (
              <button className="btn btn-sm btn-primary" disabled={runningQa} onClick={handleRunQa}>
                {runningQa ? 'Transcribing…' : '🔎 Run closed-loop QA'}
              </button>
            )}
          </div>
        )}
        {report ? (
          <>
            <div className="spread">
              <Badge tone={blocked ? 'error' : 'ok'}>{blocked ? 'Blocking issues' : 'Passed'}</Badge>
              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                Confidence {(report.overallConfidence * 100).toFixed(0)}%
              </span>
            </div>
            <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
              Closed-loop QA: audio re-transcribed and compared to expected medical terms, numbers,
              drug names, and identifiers.
            </p>
            {report.termChecks.map((t) => (
              <div key={t.term} className={`qa-row${t.critical && !t.matched && !t.reviewerOverride ? ' blocking' : ''}`}>
                <div>
                  <div className="row" style={{ gap: 6 }}>
                    <strong style={{ fontSize: 'var(--fs-sm)' }}>{t.term}</strong>
                    {t.critical && <span className="tag">critical</span>}
                    <Badge tone={t.matched ? 'ok' : t.reviewerOverride ? 'warn' : 'error'}>
                      {t.matched ? 'match' : t.reviewerOverride ? 'override' : 'mismatch'}
                    </Badge>
                  </div>
                  <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                    heard “{t.transcribedAs}” · {(t.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                {!t.matched && !t.reviewerOverride && (
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      const reason = prompt(`Accept "${t.term}" despite QA warning. Reason?`) ?? '';
                      if (reason.trim() && audio.qualityReportId) overrideQaTerm(audio.qualityReportId, t.term, reason.trim());
                    }}
                  >
                    Accept anyway
                  </button>
                )}
              </div>
            ))}
            <div className="row" style={{ marginTop: 4 }}>
              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                Term checks are a real synth → transcribe round trip. Audio-level DSP checks
                (clipping, loudness) are not yet measured in this build.
              </span>
            </div>

            <hr className="hr" />
            <h4>Decision</h4>
            {alreadyApproved ? (
              <div className="gate ready" style={{ marginBottom: 8 }}>
                <span aria-hidden="true">✓</span>
                <span style={{ fontSize: 'var(--fs-sm)' }}>
                  Audio approved. Releasing it for distribution is a Publisher decision — see the
                  <b> Publish</b> stage.
                </span>
              </div>
            ) : (
              <button className="btn btn-primary" disabled={!canApprove} onClick={() => {
                addReview({ projectId: project.id, targetId: audio.id, targetVersion: audio.version, targetContentHash: audio.contentHash, stage: 'audio', action: 'approve', comment: 'Audio approved', rejectionCategory: null, delegatedTo: null });
                // Only the audio decision belongs to the AudioReviewer. Advancing to
                // READY_TO_PUBLISH is a separate, Publisher-gated step and is offered
                // in the Publish stage — bundling them here let one role make the
                // other's decision, and raced the two requests against each other.
                void transitionProject(project.id, 'AUDIO_APPROVED');
              }}>
                Approve audio
              </button>
            )}
            {approveBlockedReason && !alreadyApproved && (
              <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 4 }}>
                {approveBlockedReason}
              </p>
            )}
            {project.state === 'AUDIO_PREVIEW' && (
              <button className="btn" onClick={() => transitionProject(project.id, 'AUDIO_REVIEW')}>
                Send to audio review
              </button>
            )}

            <div className="field" style={{ marginTop: 8 }}>
              <label htmlFor="rej-cat">Reject with reason</label>
              <select id="rej-cat" className="select" value={rejectCat} onChange={(e) => setRejectCat(e.target.value as RejectionCategory)}>
                {REJECT_CATS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <textarea className="textarea" placeholder="Reason (required)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <button
              className="btn btn-danger"
              disabled={project.state !== 'AUDIO_REVIEW' || !rejectReason.trim()}
              onClick={() => {
                addReview({ projectId: project.id, targetId: audio.id, targetVersion: audio.version, targetContentHash: audio.contentHash, stage: 'audio', action: 'reject', comment: rejectReason, rejectionCategory: rejectCat, delegatedTo: null });
                // Delivery-only categories return to preview; wording issues return to script.
                const deliveryOnly: RejectionCategory[] = ['timing', 'voice', 'prosody', 'volume', 'edit-mastering', 'pronunciation'];
                const to = deliveryOnly.includes(rejectCat) ? 'AUDIO_PREVIEW' : 'SCRIPT_DRAFT';
                transitionProject(project.id, to, `${rejectCat}: ${rejectReason}`);
                setRejectReason('');
              }}
            >
              Reject
            </button>
          </>
        ) : (
          <p className="muted">
            No QA report yet.{' '}
            {canRunQa ? 'Run closed-loop QA to re-transcribe the preview and verify medical pronunciation.' : 'An AudioReviewer can run closed-loop QA to verify medical pronunciation.'}
          </p>
        )}
      </aside>
    </div>
  );
}
