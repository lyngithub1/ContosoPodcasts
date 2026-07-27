import { useNavigate, useParams } from 'react-router-dom';
import { STATE_LABELS, STATE_TO_STAGE, type ProductionStage, type WorkflowState } from '@studio/domain';
import { useStudio } from '../store/StudioContext';
import { Badge, stateTone } from '../components/common/Badge';
import { ProductionTimeline } from '../components/ProductionTimeline';
import { ResearchPlanView } from './stages/ResearchPlanView';
import { EvidenceView } from './stages/EvidenceView';
import { ScriptView } from './stages/ScriptView';
import { SpeechView } from './stages/SpeechView';
import { AudioView } from './stages/AudioView';
import { PublishView } from './stages/PublishView';
import { SUPPORTED_LOCALES, type Locale } from '@studio/domain';

const STAGE_TABS: { key: string; label: string; stage: ProductionStage }[] = [
  { key: 'research', label: 'Research plan', stage: 'Research' },
  { key: 'evidence', label: 'Evidence', stage: 'Evidence' },
  { key: 'script', label: 'Script', stage: 'Script' },
  { key: 'speech', label: 'Speech workbench', stage: 'Speech' },
  { key: 'audio', label: 'Audio review', stage: 'Review' },
  { key: 'publish', label: 'Publish', stage: 'Publish' },
];

export function ProjectWorkspace() {
  const { projectId, stage } = useParams();
  const navigate = useNavigate();
  const { getProject, audioVersions, qualityReports, setProjectLocale } = useStudio();
  const project = projectId ? getProject(projectId) : undefined;

  if (!project) {
    return (
      <div className="panel panel-pad">
        <p>Project not found.</p>
        <button className="btn" onClick={() => navigate('/')}>
          Back to projects
        </button>
      </div>
    );
  }

  const activeStageKey = stage ?? 'research';
  const activeTab = STAGE_TABS.find((t) => t.key === activeStageKey) ?? STAGE_TABS[0]!;

  // Compute blockers for the timeline (e.g. QA critical mismatch at Review).
  const audio = audioVersions.find((a) => a.projectId === project.id);
  const report = audio ? qualityReports.find((r) => r.id === audio.qualityReportId) : undefined;
  const blockers: Partial<Record<ProductionStage, string>> = {};
  if (report?.hasBlockingIssues) blockers.Review = 'Critical pronunciation mismatch';

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            ← Projects
          </button>
          <h2 className="page-title" style={{ fontSize: 'var(--fs-xl)', marginTop: 6 }}>
            {project.title}
          </h2>
          <p className="page-sub" style={{ fontSize: 'var(--fs-sm)' }}>
            {project.topic}
          </p>
        </div>
        <div className="stack" style={{ alignItems: 'flex-end', gap: 8 }}>
          <Badge tone={stateTone(project.state)}>{STATE_LABELS[project.state]}</Badge>
          <label className="row" style={{ gap: 6, fontSize: 'var(--fs-sm)' }}>
            Locale
            <select
              className="select"
              style={{ width: 'auto' }}
              value={project.outputLocale}
              onChange={(e) => setProjectLocale(project.id, e.target.value as Locale)}
            >
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <ProductionTimeline projectId={project.id} state={project.state as WorkflowState} activeStage={activeTab.stage} blockers={blockers} />

      <div className="tabs" role="tablist">
        {STAGE_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === activeStageKey}
            className={`tab${t.key === activeStageKey ? ' active' : ''}`}
            onClick={() => navigate(`/projects/${project.id}/${t.key}`)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeStageKey === 'research' && <ResearchPlanView project={project} />}
      {activeStageKey === 'evidence' && <EvidenceView project={project} />}
      {activeStageKey === 'script' && <ScriptView project={project} />}
      {activeStageKey === 'speech' && <SpeechView project={project} />}
      {activeStageKey === 'audio' && <AudioView project={project} />}
      {activeStageKey === 'publish' && <PublishView project={project} />}
      {!STAGE_TABS.some((t) => t.key === activeStageKey) && <ResearchPlanView project={project} />}
      <span className="sr-only">Current stage: {STATE_TO_STAGE[project.state]}</span>
    </div>
  );
}
