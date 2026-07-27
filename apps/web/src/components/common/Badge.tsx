import type { CapabilityStatus, WorkflowState } from '@studio/domain';

export type BadgeTone = 'ok' | 'warn' | 'error' | 'info' | 'neutral';

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}

const STATE_TONE: Record<WorkflowState, BadgeTone> = {
  DRAFT: 'neutral',
  RESEARCH_CONFIGURED: 'info',
  RESEARCH_RUNNING: 'info',
  RESEARCH_REVIEW: 'warn',
  SCRIPT_DRAFT: 'neutral',
  SCRIPT_REVIEW: 'warn',
  SCRIPT_APPROVED: 'ok',
  AUDIO_PREVIEW: 'info',
  AUDIO_REVIEW: 'warn',
  AUDIO_APPROVED: 'ok',
  READY_TO_PUBLISH: 'info',
  PUBLISHED: 'ok',
  CANCELLED: 'error',
  ARCHIVED: 'neutral',
};

export function stateTone(state: WorkflowState): BadgeTone {
  return STATE_TONE[state];
}

const CAP_TONE: Record<CapabilityStatus, BadgeTone> = {
  configured: 'info',
  verified: 'ok',
  degraded: 'warn',
  preview: 'info',
  unavailable: 'error',
};

export function capabilityTone(status: CapabilityStatus): BadgeTone {
  return CAP_TONE[status];
}
