import { useStudio } from '../store/StudioContext';
import { Badge } from '../components/common/Badge';

export function Templates() {
  const { scriptTemplates } = useStudio();

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">Reusable formats</span>
          <h2 className="page-title">Script templates</h2>
          <p className="page-sub">
            Templates define the section skeleton, delivery cues, and mandatory safety boilerplate
            that every script inherits. Boilerplate is locked and cannot be removed by authors.
          </p>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {scriptTemplates.map((t) => (
          <section key={t.id} className="panel panel-pad stack">
            <div className="spread">
              <h3>{t.name}</h3>
              <Badge tone="neutral">{t.form}</Badge>
            </div>
            <p className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>{t.description}</p>

            <div>
              <div className="eyebrow">Sections</div>
              <ol className="section-list">
                {t.sections.map((s, i) => (
                  <li key={i}>
                    <strong>{s.heading}</strong>
                    {s.directionCue && <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}> — {s.directionCue}</span>}
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <div className="eyebrow">Mandatory boilerplate</div>
              <ul className="warn-list">
                {t.mandatoryBoilerplate.map((b, i) => (
                  <li key={i} style={{ color: 'var(--text-secondary)' }}>
                    🔒 {b}
                  </li>
                ))}
              </ul>
            </div>

            <div className="row">
              <Badge tone={t.requiresSpeakers ? 'info' : 'neutral'}>
                {t.requiresSpeakers ? 'Requires named speakers' : 'Single narrator'}
              </Badge>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
