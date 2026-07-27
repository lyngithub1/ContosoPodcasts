import { useMemo, useState } from 'react';
import { useStudio } from '../store/StudioContext';

export function AuditTrail() {
  const { auditEvents, projects } = useStudio();
  const [projectFilter, setProjectFilter] = useState('');
  const [q, setQ] = useState('');

  const sorted = useMemo(
    () =>
      [...auditEvents]
        .filter((e) => (projectFilter ? e.projectId === projectFilter : true))
        .filter((e) => (q ? (e.summary + e.eventType).toLowerCase().includes(q.toLowerCase()) : true))
        .sort((a, b) => (a.at < b.at ? 1 : -1)),
    [auditEvents, projectFilter, q],
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">Traceability</span>
          <h2 className="page-title">Audit trail</h2>
          <p className="page-sub">
            Every state change, decision, override, and delivery is recorded with actor, timestamp,
            and redacted detail. Secrets and tokens never appear here.
          </p>
        </div>
      </div>

      <section className="panel panel-pad stack">
        <div className="spread">
          <input className="input" style={{ maxWidth: 320 }} placeholder="Search events…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" style={{ width: 'auto' }} value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Actor</th>
              <th>Summary</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id}>
                <td className="mono" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>
                  {new Date(e.at).toLocaleString()}
                </td>
                <td>
                  <span className="tag">{e.eventType}</span>
                </td>
                <td>
                  {e.actor.displayName}
                  <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{e.actor.roles.join(', ')}</div>
                </td>
                <td style={{ fontSize: 'var(--fs-sm)' }}>{e.summary}</td>
                <td className="mono muted" style={{ fontSize: 'var(--fs-xs)' }}>
                  {Object.entries(e.detail)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(' · ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && <p className="muted">No events match.</p>}
      </section>
    </div>
  );
}
