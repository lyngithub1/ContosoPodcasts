import { Link, useNavigate } from 'react-router-dom';
import { STATE_LABELS, STATE_TO_STAGE } from '@studio/domain';
import { useStudio } from '../store/StudioContext';
import { Badge, stateTone } from '../components/common/Badge';
import { branding } from '../config/branding';

export function Dashboard() {
  const { projects, deleteProject, activeRole } = useStudio();
  const navigate = useNavigate();
  const canDelete = activeRole === 'Administrator' || activeRole === 'Creator';

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">{branding.tagline}</span>
          <h2 className="page-title">Projects</h2>
          <p className="page-sub">
            Turn a topic or mini-prompt into a traceable research collection, an evidence-grounded
            script, natural English/German audio, and a securely distributed episode.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/projects/new')}>
          + New project
        </button>
      </div>

      <div className="grid grid-cards">
        {projects.map((p) => (
          <article
            key={p.id}
            className="panel project-card"
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/projects/${p.id}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(`/projects/${p.id}`);
              }
            }}
          >
            <div className="spread">
              <Badge tone={stateTone(p.state)}>{STATE_LABELS[p.state]}</Badge>
              <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="muted mono">{p.outputLocale}</span>
                {canDelete && (
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Remove this project and its production data"
                    aria-label={`Remove project ${p.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        window.confirm(
                          `Remove “${p.title}”? This permanently deletes the project and all of its research, script, audio, and publication data. This cannot be undone.`,
                        )
                      ) {
                        deleteProject(p.id);
                      }
                    }}
                  >
                    🗑
                  </button>
                )}
              </span>
            </div>
            <h3>{p.title}</h3>
            <p className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>
              {p.topic}
            </p>
            <div className="tag-row">
              {p.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
            <div className="spread" style={{ marginTop: 'auto' }}>
              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                Stage: {STATE_TO_STAGE[p.state]}
              </span>
              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                {p.targetDurationMinutes} min · {p.audience}
              </span>
            </div>
          </article>
        ))}

        <Link to="/projects/new" className="panel project-card" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', borderStyle: 'dashed' }}>
          <span style={{ fontSize: '2rem' }} aria-hidden="true">
            +
          </span>
          <strong>Start a new production</strong>
          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
            Topic → research → script → audio → publish
          </span>
        </Link>
      </div>
    </div>
  );
}
