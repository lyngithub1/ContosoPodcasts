/**
 * Server-authoritative workflow state machine + role authorization.
 *
 * This module is a self-contained MIRROR of `packages/domain/src/workflow.ts`.
 * The API's Docker build context is the `apps/api` folder alone (it cannot
 * resolve the `@studio/domain` workspace package at build/runtime), so the
 * gating rules are vendored here. Keep the transition graph, rejection edges,
 * and role map in sync with the domain package — the shared unit tests in
 * `@studio/domain` are the source of truth.
 */

export type WorkflowState =
  | 'DRAFT'
  | 'RESEARCH_CONFIGURED'
  | 'RESEARCH_RUNNING'
  | 'RESEARCH_REVIEW'
  | 'SCRIPT_DRAFT'
  | 'SCRIPT_REVIEW'
  | 'SCRIPT_APPROVED'
  | 'AUDIO_PREVIEW'
  | 'AUDIO_REVIEW'
  | 'AUDIO_APPROVED'
  | 'READY_TO_PUBLISH'
  | 'PUBLISHED'
  | 'CANCELLED'
  | 'ARCHIVED';

export type AppRole =
  | 'Creator'
  | 'ScientificReviewer'
  | 'MedicalLegalReviewer'
  | 'AudioReviewer'
  | 'Publisher'
  | 'Administrator'
  | 'Auditor';

const TRANSITIONS: Record<WorkflowState, readonly WorkflowState[]> = {
  DRAFT: ['RESEARCH_CONFIGURED', 'CANCELLED', 'ARCHIVED'],
  RESEARCH_CONFIGURED: ['RESEARCH_RUNNING', 'CANCELLED', 'ARCHIVED'],
  RESEARCH_RUNNING: ['RESEARCH_REVIEW', 'RESEARCH_CONFIGURED', 'CANCELLED', 'ARCHIVED'],
  RESEARCH_REVIEW: ['SCRIPT_DRAFT', 'RESEARCH_CONFIGURED', 'CANCELLED', 'ARCHIVED'],
  SCRIPT_DRAFT: ['SCRIPT_REVIEW', 'CANCELLED', 'ARCHIVED'],
  SCRIPT_REVIEW: ['SCRIPT_APPROVED', 'SCRIPT_DRAFT', 'CANCELLED', 'ARCHIVED'],
  SCRIPT_APPROVED: ['AUDIO_PREVIEW', 'CANCELLED', 'ARCHIVED'],
  AUDIO_PREVIEW: ['AUDIO_REVIEW', 'CANCELLED', 'ARCHIVED'],
  AUDIO_REVIEW: ['AUDIO_APPROVED', 'SCRIPT_DRAFT', 'AUDIO_PREVIEW', 'CANCELLED', 'ARCHIVED'],
  AUDIO_APPROVED: ['READY_TO_PUBLISH', 'CANCELLED', 'ARCHIVED'],
  READY_TO_PUBLISH: ['PUBLISHED', 'AUDIO_REVIEW', 'CANCELLED', 'ARCHIVED'],
  PUBLISHED: [],
  CANCELLED: [],
  ARCHIVED: [],
};

const REJECTION_EDGES: ReadonlySet<string> = new Set([
  'RESEARCH_REVIEW->RESEARCH_CONFIGURED',
  'SCRIPT_REVIEW->SCRIPT_DRAFT',
  'AUDIO_REVIEW->SCRIPT_DRAFT',
  'AUDIO_REVIEW->AUDIO_PREVIEW',
  'READY_TO_PUBLISH->AUDIO_REVIEW',
]);

const TRANSITION_ROLES: Readonly<Record<string, readonly AppRole[]>> = {
  'DRAFT->RESEARCH_CONFIGURED': ['Creator'],
  'RESEARCH_CONFIGURED->RESEARCH_RUNNING': ['Creator'],
  'RESEARCH_RUNNING->RESEARCH_REVIEW': ['Creator'],
  'RESEARCH_RUNNING->RESEARCH_CONFIGURED': ['Creator'],
  'RESEARCH_REVIEW->SCRIPT_DRAFT': ['ScientificReviewer'],
  'RESEARCH_REVIEW->RESEARCH_CONFIGURED': ['ScientificReviewer'],
  'SCRIPT_DRAFT->SCRIPT_REVIEW': ['Creator'],
  'SCRIPT_REVIEW->SCRIPT_APPROVED': ['ScientificReviewer', 'MedicalLegalReviewer'],
  'SCRIPT_REVIEW->SCRIPT_DRAFT': ['ScientificReviewer', 'MedicalLegalReviewer'],
  'SCRIPT_APPROVED->AUDIO_PREVIEW': ['Creator'],
  'AUDIO_PREVIEW->AUDIO_REVIEW': ['Creator'],
  'AUDIO_REVIEW->AUDIO_APPROVED': ['AudioReviewer'],
  'AUDIO_REVIEW->SCRIPT_DRAFT': ['AudioReviewer'],
  'AUDIO_REVIEW->AUDIO_PREVIEW': ['AudioReviewer'],
  'AUDIO_APPROVED->READY_TO_PUBLISH': ['Publisher'],
  'READY_TO_PUBLISH->PUBLISHED': ['Publisher'],
  'READY_TO_PUBLISH->AUDIO_REVIEW': ['Publisher'],
};

export function isWorkflowState(value: unknown): value is WorkflowState {
  // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so strings like
  // "toString" or "constructor" would otherwise be accepted as workflow states.
  return typeof value === 'string' && Object.hasOwn(TRANSITIONS, value);
}

export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  const allowed = Object.hasOwn(TRANSITIONS, from) ? TRANSITIONS[from] : undefined;
  return allowed?.includes(to) ?? false;
}

export function rolesForTransition(
  from: WorkflowState,
  to: WorkflowState,
): readonly AppRole[] | undefined {
  return TRANSITION_ROLES[`${from}->${to}`];
}

export interface AuthorizationCheck {
  allowed: boolean;
  authorized: boolean;
  isRejection: boolean;
  requiresReason: boolean;
  reason?: string;
}

/**
 * Full server gate: legal edge + reason requirement + role authorization.
 * `Administrator` may perform any legal transition; `Creator` may cancel/archive.
 */
export function authorizeTransition(
  from: WorkflowState,
  to: WorkflowState,
  roles: readonly AppRole[],
  providedReason?: string,
): AuthorizationCheck {
  const allowedEdge = canTransition(from, to);
  const isRejection = REJECTION_EDGES.has(`${from}->${to}`);
  const requiresReason = isRejection || to === 'CANCELLED' || to === 'ARCHIVED';

  if (!allowedEdge) {
    return {
      allowed: false,
      authorized: false,
      isRejection,
      requiresReason,
      reason: `Transition ${from} → ${to} is not permitted.`,
    };
  }
  if (requiresReason && !providedReason?.trim()) {
    return {
      allowed: false,
      authorized: true,
      isRejection,
      requiresReason,
      reason: `A reason is required to move from ${from} to ${to}.`,
    };
  }

  const isAdmin = roles.includes('Administrator');
  const required = rolesForTransition(from, to);
  const authorized = isAdmin
    ? true
    : required
      ? roles.some((r) => required.includes(r))
      : (to === 'CANCELLED' || to === 'ARCHIVED') && roles.includes('Creator');

  if (!authorized) {
    const need = required ?? (['Creator'] as const);
    return {
      allowed: false,
      authorized: false,
      isRejection,
      requiresReason,
      reason: `Your active role is not permitted to move ${from} → ${to}. Required role: ${need.join(' or ')}.`,
    };
  }

  return { allowed: true, authorized: true, isRejection, requiresReason };
}
