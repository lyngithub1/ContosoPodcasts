import { useNavigate } from 'react-router-dom';
import { STAGE_ORDER, STATE_TO_STAGE, type ProductionStage, type WorkflowState } from '@studio/domain';

const STAGE_ROUTE: Record<ProductionStage, string> = {
  Research: 'research',
  Evidence: 'evidence',
  Script: 'script',
  Speech: 'speech',
  Review: 'audio',
  Publish: 'publish',
};

const STAGE_ICON: Record<ProductionStage, string> = {
  Research: '🔎',
  Evidence: '🧬',
  Script: '✍',
  Speech: '🗣',
  Review: '🎧',
  Publish: '📡',
};

interface Props {
  projectId: string;
  state: WorkflowState;
  activeStage: ProductionStage;
  /** Optional blockers per stage, e.g. QA critical mismatch. */
  blockers?: Partial<Record<ProductionStage, string>>;
}

export function ProductionTimeline({ projectId, state, activeStage, blockers }: Props) {
  const navigate = useNavigate();
  const currentStage = STATE_TO_STAGE[state];
  const currentIdx = STAGE_ORDER.indexOf(currentStage);

  return (
    <nav className="timeline" aria-label="Production timeline">
      <ol className="timeline-track">
        {STAGE_ORDER.map((stage, idx) => {
          const done = idx < currentIdx || state === 'PUBLISHED';
          const active = stage === activeStage;
          const reached = idx <= currentIdx;
          const blocker = blockers?.[stage];
          const status = blocker ? 'blocked' : done ? 'done' : reached ? 'current' : 'pending';
          return (
            <li key={stage} className={`timeline-step ${status}${active ? ' selected' : ''}`}>
              <button
                className="timeline-node"
                onClick={() => navigate(`/projects/${projectId}/${STAGE_ROUTE[stage]}`)}
                aria-current={active ? 'step' : undefined}
              >
                <span className="timeline-icon" aria-hidden="true">
                  {blocker ? '⚠' : done ? '✓' : STAGE_ICON[stage]}
                </span>
                <span className="timeline-label">{stage}</span>
                <span className="sr-only">
                  {status === 'done'
                    ? ' (completed)'
                    : status === 'blocked'
                      ? ` (blocked: ${blocker})`
                      : status === 'current'
                        ? ' (in progress)'
                        : ' (not started)'}
                </span>
              </button>
              {idx < STAGE_ORDER.length - 1 && <span className="timeline-connector" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
