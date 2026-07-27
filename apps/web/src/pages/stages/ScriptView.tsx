import { useMemo, useState } from 'react';
import { useStudio } from '../../store/StudioContext';
import type { Project, ScriptSegment } from '@studio/domain';
import { Badge } from '../../components/common/Badge';
import { apiEnabled } from '../../config/api';

export function ScriptView({ project }: { project: Project }) {
  const { scripts, claims, structuredEvidence, pronunciationEntries, transitionProject, addReview, reviews, generateScript, activeRole } =
    useStudio();
  const script = scripts.find((s) => s.projectId === project.id);
  const [comment, setComment] = useState('');
  const [generating, setGenerating] = useState(false);

  const canGenerate = apiEnabled() && (activeRole === 'Creator' || activeRole === 'Administrator');

  // Grounded generation needs accepted evidence or non-excluded claims (mirrors
  // the server gate). Imported scripts have neither, so the AI (re)generate CTA
  // is hidden for them — it would only return "nothing to ground a script".
  const hasGrounding = useMemo(
    () =>
      claims.some((c) => c.projectId === project.id && !c.excluded) ||
      structuredEvidence.some((e) => e.projectId === project.id),
    [claims, structuredEvidence, project.id],
  );

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateScript(project.id);
    } finally {
      setGenerating(false);
    }
  }

  const candidateTerms = useMemo(
    () => pronunciationEntries.map((p) => p.canonicalForm).sort((a, b) => b.length - a.length),
    [pronunciationEntries],
  );

  if (!script) {
    return (
      <div className="panel panel-pad stack">
        <h3>Script</h3>
        <p className="muted">
          No script generated yet. Complete evidence review, then generate a grounded{' '}
          {project.scriptForm.replace('-', ' ')} script from only the accepted evidence and claims.
        </p>
        {canGenerate && hasGrounding ? (
          <div>
            <button className="btn btn-primary" disabled={generating} onClick={handleGenerate}>
              {generating ? 'Generating with Foundry agent…' : 'Generate grounded script (AI)'}
            </button>
            <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 6 }}>
              Runs the deployed Foundry <span className="mono">podcast-script-generator</span> agent on the
              project&rsquo;s accepted evidence. Output opens with a synthetic-media disclosure and is a draft
              for reviewers.
            </p>
          </div>
        ) : canGenerate && !hasGrounding ? (
          <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            Grounded generation needs accepted evidence or claims. Accept evidence in the Evidence stage first,
            or upload a finished script from the projects list.
          </p>
        ) : (
          <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            {apiEnabled()
              ? 'Grounded generation requires the Creator role.'
              : 'Grounded generation runs the Foundry agent and requires the connected backend (not available offline).'}
          </p>
        )}
      </div>
    );
  }

  const speakerLabel = (id: string | null) => script.speakers.find((s) => s.id === id)?.label ?? 'Narrator';
  const scriptReviews = reviews.filter((r) => r.targetId === script.id);

  function findClaim(id: string) {
    return claims.find((c) => c.id === id);
  }

  return (
    <div className="ws-layout">
      <div className="ws-main stack">
        <section className="panel panel-pad stack">
          <div className="spread">
            <div>
              <h3>{script.title}</h3>
              <span className="muted mono" style={{ fontSize: 'var(--fs-xs)' }}>
                v{script.version} · {script.form} · {script.locale} · ~{Math.round(script.estimatedDurationSeconds / 60)} min ·
                hash {script.contentHash.slice(0, 18)}…
              </span>
            </div>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              {canGenerate && !script.approved && hasGrounding ? (
                <button
                  className="btn"
                  disabled={generating}
                  onClick={() => {
                    if (window.confirm('Regenerate this script with the Foundry agent? The current draft will be replaced by a new version.')) {
                      void handleGenerate();
                    }
                  }}
                  title="Re-run the Foundry podcast-script-generator agent on the accepted evidence"
                >
                  {generating ? 'Regenerating…' : 'Regenerate (AI)'}
                </button>
              ) : canGenerate && !script.approved && !hasGrounding ? (
                <span className="muted" style={{ fontSize: 'var(--fs-xs)', maxWidth: 260, textAlign: 'right' }}>
                  Imported draft — no mapped evidence, so AI regeneration is unavailable.
                </span>
              ) : null}
              <Badge tone={script.approved ? 'ok' : 'warn'}>{script.approved ? 'Approved' : 'Draft'}</Badge>
            </div>
          </div>

          {script.segments.map((seg) => (
            <SegmentBlock
              key={seg.id}
              seg={seg}
              speaker={speakerLabel(seg.speakerId)}
              candidateTerms={candidateTerms}
              claimStatements={seg.claimIds.map((id) => findClaim(id)).filter(Boolean).map((c) => c!.statement)}
              unsupported={seg.claimIds.some((id) => {
                const c = findClaim(id);
                return c && c.kind !== 'generated-transition' && c.supportingPassageIds.length === 0;
              })}
            />
          ))}
        </section>
      </div>

      <aside className="inspector panel panel-pad stack">
        <h3 className="inspector-title">Review</h3>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
          Terminology highlighted with a dotted underline are pronunciation candidates. Approving
          records your identity, role, timestamp, and the content hash.
        </p>

        <div className="field">
          <label htmlFor="sc-comment">Comment</label>
          <textarea id="sc-comment" className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment or @mention…" />
        </div>

        <div className="stack" style={{ gap: 8 }}>
          {project.state === 'SCRIPT_DRAFT' && (
            <button
              className="btn btn-primary"
              disabled={script.approved}
              onClick={() => transitionProject(project.id, 'SCRIPT_REVIEW')}
              title="Submit this draft for review. Approval is a separate, audited step."
            >
              Submit for review →
            </button>
          )}
          {project.state === 'SCRIPT_REVIEW' && (
            <>
              <button
                className="btn btn-primary"
                onClick={() => {
                  addReview({
                    projectId: project.id,
                    targetId: script.id,
                    targetVersion: script.version,
                    targetContentHash: script.contentHash,
                    stage: 'script',
                    action: 'approve',
                    comment: comment || 'Approved',
                    rejectionCategory: null,
                    delegatedTo: null,
                  });
                  transitionProject(project.id, 'SCRIPT_APPROVED');
                }}
              >
                Approve script
              </button>
              <button
                className="btn"
                disabled={!comment.trim()}
                onClick={() => {
                  if (!comment.trim()) return;
                  addReview({
                    projectId: project.id,
                    targetId: script.id,
                    targetVersion: script.version,
                    targetContentHash: script.contentHash,
                    stage: 'script',
                    action: 'request-changes',
                    comment,
                    rejectionCategory: 'factual-script',
                    delegatedTo: null,
                  });
                  transitionProject(project.id, 'SCRIPT_DRAFT', comment);
                }}
              >
                Request changes (requires comment)
              </button>
            </>
          )}
          {project.state === 'SCRIPT_APPROVED' && (
            <button className="btn btn-primary" onClick={() => transitionProject(project.id, 'AUDIO_PREVIEW')}>
              Proceed to speech →
            </button>
          )}
        </div>

        <hr className="hr" />
        <div className="eyebrow">Decision history</div>
        {scriptReviews.length ? (
          scriptReviews.map((r) => (
            <div key={r.id} className="stack" style={{ gap: 2 }}>
              <div className="row">
                <Badge tone={r.action === 'approve' ? 'ok' : 'warn'}>{r.action}</Badge>
                <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                  {r.by.displayName}
                </span>
              </div>
              {r.comment && <span className="secondary" style={{ fontSize: 'var(--fs-xs)' }}>{r.comment}</span>}
            </div>
          ))
        ) : (
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No decisions yet.</p>
        )}
      </aside>
    </div>
  );
}

function SegmentBlock({
  seg,
  speaker,
  candidateTerms,
  claimStatements,
  unsupported,
}: {
  seg: ScriptSegment;
  speaker: string;
  candidateTerms: string[];
  claimStatements: string[];
  unsupported: boolean;
}) {
  return (
    <div className="segment">
      <div className="segment-head">
        <span className="speaker-chip">{speaker}</span>
        {seg.heading && <span className="cue-chip">{seg.heading}</span>}
        {seg.directionCue && <span className="cue-chip">— {seg.directionCue}</span>}
        {seg.claimIds.length > 0 && <Badge tone="info">{seg.claimIds.length} citation(s)</Badge>}
        {unsupported && <Badge tone="error">Missing citation</Badge>}
      </div>
      <p className="segment-text">{highlightTerms(seg.text, candidateTerms)}</p>
      {claimStatements.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="muted" style={{ fontSize: 'var(--fs-xs)', cursor: 'pointer' }}>
            Claim-to-source mapping
          </summary>
          <ul className="warn-list" style={{ color: 'var(--text-secondary)' }}>
            {claimStatements.map((s, i) => (
              <li key={i} style={{ color: 'var(--text-secondary)' }}>
                {s}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Highlights known pronunciation-candidate terms with a dotted underline. */
function highlightTerms(text: string, terms: string[]) {
  if (terms.length === 0) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  const parts = text.split(re);
  return parts.map((part, i) =>
    terms.includes(part) ? (
      <span key={i} className="token candidate">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
