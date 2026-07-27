import { useMemo, useState } from 'react';
import { useStudio } from '../../store/StudioContext';
import type { AcceptanceStatus, Project } from '@studio/domain';
import { Badge, type BadgeTone } from '../../components/common/Badge';

const STATUS_TONE: Record<AcceptanceStatus, BadgeTone> = {
  accepted: 'ok',
  rejected: 'error',
  pending: 'warn',
  duplicate: 'neutral',
  failed: 'error',
};

export function EvidenceView({ project }: { project: Project }) {
  const { sources, passages, claims, acceptSource, rejectSource, toggleClaimPinned, toggleClaimExcluded, transitionProject } = useStudio();
  const [filter, setFilter] = useState<AcceptanceStatus | 'all'>('all');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const projectSources = useMemo(() => sources.filter((s) => s.projectId === project.id), [sources, project.id]);
  const shown = projectSources.filter((s) => filter === 'all' || s.status === filter);
  const acceptedCount = projectSources.filter((s) => s.status === 'accepted').length;
  const projectClaims = claims.filter((c) => c.projectId === project.id);
  const selectedPassages = passages.filter((p) => p.sourceId === selectedSourceId);

  const canGenerate = acceptedCount > 0 && project.state === 'RESEARCH_REVIEW';

  return (
    <div className="ws-layout">
      <div className="ws-main stack">
        <div className={`gate ${acceptedCount > 0 ? 'ready' : 'blocked'}`}>
          <span aria-hidden="true">{acceptedCount > 0 ? '✓' : '⚠'}</span>
          <span>
            {acceptedCount > 0
              ? `${acceptedCount} accepted source(s). Research can be finalized.`
              : 'Research cannot be finalized without at least one accepted source.'}
          </span>
        </div>

        <section className="panel panel-pad stack">
          <div className="spread">
            <h3>Evidence board</h3>
            <div className="chip-row">
              {(['all', 'accepted', 'pending', 'rejected'] as const).map((f) => (
                <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cards">
            {shown.map((s) => (
              <article
                key={s.id}
                className={`panel source-card${selectedSourceId === s.id ? ' selected' : ''}`}
                onClick={() => setSelectedSourceId(s.id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="spread">
                  <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                  <span className="tag">{s.evidenceClass}</span>
                </div>
                <strong style={{ fontSize: 'var(--fs-sm)' }}>{s.title}</strong>
                <div className="source-meta">
                  <span>{s.authors.join(', ') || '—'}</span>
                  {s.doi && <span className="mono">DOI {s.doi}</span>}
                  {s.pmid && <span className="mono">PMID {s.pmid}</span>}
                </div>
                <div className="tag-row">
                  {s.trustFlags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
                {s.statusReason && <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{s.statusReason}</p>}
                {s.status !== 'accepted' && (
                  <div className="row">
                    <button
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        acceptSource(s.id);
                      }}
                    >
                      Accept
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        const reason = prompt('Reason for rejection?') ?? '';
                        if (reason.trim()) rejectSource(s.id, reason.trim());
                      }}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="panel panel-pad stack">
          <h3>Evidence claims</h3>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
            Every material claim maps to accepted sources. Unsupported claims and contradictions are
            surfaced, never blended away. Pin claims to include them; excluded claims remain in the
            audit record.
          </p>
          {projectClaims.map((c) => {
            const unsupported = c.kind !== 'generated-transition' && c.supportingPassageIds.length === 0;
            const contradicted = c.contradictingPassageIds.length > 0;
            return (
              <div key={c.id} className="segment" style={{ opacity: c.excluded ? 0.5 : 1 }}>
                <div className="segment-head">
                  <span className="speaker-chip">{c.kind}</span>
                  {unsupported && <Badge tone="error">Unsupported</Badge>}
                  {contradicted && <Badge tone="warn">Contradiction</Badge>}
                  {c.supportingPassageIds.length > 0 && <Badge tone="ok">{c.supportingPassageIds.length} source(s)</Badge>}
                </div>
                <div className="segment-text" style={{ fontSize: 'var(--fs-sm)' }}>
                  {c.statement}
                </div>
                {c.clinicalQualifiers.length > 0 && (
                  <div className="tag-row" style={{ marginTop: 6 }}>
                    {c.clinicalQualifiers.map((q) => (
                      <span key={q} className="tag">
                        {q}
                      </span>
                    ))}
                  </div>
                )}
                <div className="row" style={{ marginTop: 8 }}>
                  <button className={`btn btn-sm${c.pinned ? ' btn-primary' : ''}`} onClick={() => toggleClaimPinned(c.id)}>
                    {c.pinned ? '📌 Pinned' : 'Pin'}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => toggleClaimExcluded(c.id)}>
                    {c.excluded ? 'Include' : 'Exclude'}
                  </button>
                </div>
              </div>
            );
          })}
        </section>

        <div className="row">
          <button className="btn btn-primary" disabled={!canGenerate} onClick={() => transitionProject(project.id, 'SCRIPT_DRAFT')}>
            Generate grounded script →
          </button>
          {project.state === 'RESEARCH_REVIEW' && (
            <button className="btn btn-ghost" onClick={() => transitionProject(project.id, 'RESEARCH_CONFIGURED', prompt('Reason to send back for more research?') ?? 'More research needed')}>
              Send back for more research
            </button>
          )}
        </div>
      </div>

      <aside className="inspector panel panel-pad stack">
        <h3 className="inspector-title">Source detail</h3>
        {selectedSourceId ? (
          selectedPassages.length ? (
            selectedPassages.map((p) => (
              <div key={p.id} className="stack" style={{ gap: 6 }}>
                <div className="spread">
                  <Badge tone={p.evidenceStrength === 'high' ? 'ok' : p.evidenceStrength === 'low' || p.evidenceStrength === 'very-low' ? 'warn' : 'info'}>
                    {p.evidenceStrength}
                  </Badge>
                  <span className="mono muted" style={{ fontSize: 'var(--fs-xs)' }}>
                    {p.anchor}
                  </span>
                </div>
                <p className="finding">{p.keyFinding}</p>
                <p className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>{p.text}</p>
                {p.pronunciationCandidates.length > 0 && (
                  <div>
                    <div className="eyebrow">Pronunciation candidates</div>
                    <div className="tag-row" style={{ marginTop: 4 }}>
                      {p.pronunciationCandidates.map((t) => (
                        <span key={t} className="tag">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <hr className="hr" />
              </div>
            ))
          ) : (
            <p className="muted">No extracted passages for this source.</p>
          )
        ) : (
          <p className="muted">Select a source card to inspect extracted passages, anchors, and findings.</p>
        )}
      </aside>
    </div>
  );
}
