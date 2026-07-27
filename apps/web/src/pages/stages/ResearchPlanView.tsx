import { useStudio } from '../../store/StudioContext';
import { STATE_LABELS } from '@studio/domain';
import type { Project } from '@studio/domain';
import { Badge } from '../../components/common/Badge';

export function ResearchPlanView({ project }: { project: Project }) {
  const { researchPlans, transitionProject } = useStudio();
  const plan = researchPlans.find((p) => p.projectId === project.id);

  if (!plan) return <div className="panel panel-pad">No research plan for this project.</div>;

  const canRun = project.state === 'DRAFT' || project.state === 'RESEARCH_CONFIGURED';

  return (
    <div className="stack">
      <section className="panel panel-pad stack">
        <div className="spread">
          <h3>Research plan</h3>
          <Badge tone={plan.approvedForAcquisition ? 'ok' : 'warn'}>
            {plan.approvedForAcquisition ? 'Approved for acquisition' : 'Needs approval'}
          </Badge>
        </div>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
          You control exactly which queries, source categories, filters, and domains the studio will
          use. Nothing is acquired until this plan is approved.
        </p>

        <div>
          <div className="eyebrow">Queries</div>
          {plan.queries.map((q) => (
            <div key={q.id} className="segment" style={{ marginTop: 8 }}>
              <div className="segment-head">
                <span className="speaker-chip">{q.sourceCategory}</span>
                <span className="cue-chip">{q.targetDomains.join(', ') || 'allowlist'}</span>
              </div>
              <div className="segment-text" style={{ fontSize: 'var(--fs-sm)' }}>
                {q.text}
              </div>
            </div>
          ))}
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <PlanField label="Source policies" values={plan.sourcePolicies} />
          <PlanField label="Evidence hierarchy" values={plan.evidenceHierarchy} />
          <PlanField label="Languages" values={plan.languages} />
          <PlanField label="Geography" values={plan.geography} />
          <PlanField label="Allowlisted domains" values={plan.allowlistedDomains} />
          <PlanField label="Denylisted domains" values={plan.denylistedDomains.length ? plan.denylistedDomains : ['—']} />
        </div>
      </section>

      <section className="panel panel-pad">
        <div className="spread">
          <div>
            <h3>Acquisition</h3>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              Current state: {STATE_LABELS[project.state]}. Uploads land in a quarantine container and
              are validated + malware-scanned before use.
            </p>
          </div>
          <div className="row">
            {project.state === 'DRAFT' && (
              <button className="btn" onClick={() => transitionProject(project.id, 'RESEARCH_CONFIGURED')}>
                Confirm plan
              </button>
            )}
            <button
              className="btn btn-primary"
              disabled={!canRun}
              onClick={() => transitionProject(project.id, 'RESEARCH_RUNNING')}
            >
              Run acquisition
            </button>
            {project.state === 'RESEARCH_RUNNING' && (
              <button className="btn" onClick={() => transitionProject(project.id, 'RESEARCH_REVIEW')}>
                Acquisition complete → review evidence
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function PlanField({ label, values }: { label: string; values: readonly string[] }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="tag-row" style={{ marginTop: 6 }}>
        {values.map((v) => (
          <span key={v} className="tag">
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}
