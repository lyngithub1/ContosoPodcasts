/**
 * Durable workflow state machine (Specification Section 3).
 *
 * The project lifecycle is a gated state machine. Transitions are validated
 * server-side; the SPA mirrors these rules for UX affordances only.
 */

import type { AppRole } from './common.js';

/** All project workflow states. */
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

/** Ordered "happy path" used to render the guided production timeline. */
export const HAPPY_PATH: readonly WorkflowState[] = [
  'DRAFT',
  'RESEARCH_CONFIGURED',
  'RESEARCH_RUNNING',
  'RESEARCH_REVIEW',
  'SCRIPT_DRAFT',
  'SCRIPT_REVIEW',
  'SCRIPT_APPROVED',
  'AUDIO_PREVIEW',
  'AUDIO_REVIEW',
  'AUDIO_APPROVED',
  'READY_TO_PUBLISH',
  'PUBLISHED',
] as const;

/** High-level stages surfaced in the Research → Publish timeline (Section 8). */
export type ProductionStage =
  | 'Research'
  | 'Evidence'
  | 'Script'
  | 'Speech'
  | 'Review'
  | 'Publish';

export const STAGE_ORDER: readonly ProductionStage[] = [
  'Research',
  'Evidence',
  'Script',
  'Speech',
  'Review',
  'Publish',
] as const;

/** Maps each workflow state to the timeline stage it belongs to. */
export const STATE_TO_STAGE: Record<WorkflowState, ProductionStage> = {
  DRAFT: 'Research',
  RESEARCH_CONFIGURED: 'Research',
  RESEARCH_RUNNING: 'Research',
  RESEARCH_REVIEW: 'Evidence',
  SCRIPT_DRAFT: 'Script',
  SCRIPT_REVIEW: 'Script',
  SCRIPT_APPROVED: 'Script',
  AUDIO_PREVIEW: 'Speech',
  AUDIO_REVIEW: 'Review',
  AUDIO_APPROVED: 'Review',
  READY_TO_PUBLISH: 'Publish',
  PUBLISHED: 'Publish',
  CANCELLED: 'Publish',
  ARCHIVED: 'Publish',
};

/**
 * Allowed transitions. Forward edges are the happy path; the remainder encode
 * the rejection paths and cancellation/archival rules from Section 3.
 */
const TRANSITIONS: Record<WorkflowState, readonly WorkflowState[]> = {
  DRAFT: ['RESEARCH_CONFIGURED', 'CANCELLED', 'ARCHIVED'],
  RESEARCH_CONFIGURED: ['RESEARCH_RUNNING', 'CANCELLED', 'ARCHIVED'],
  RESEARCH_RUNNING: ['RESEARCH_REVIEW', 'RESEARCH_CONFIGURED', 'CANCELLED', 'ARCHIVED'],
  // Rejection: RESEARCH_REVIEW -> RESEARCH_CONFIGURED
  RESEARCH_REVIEW: ['SCRIPT_DRAFT', 'RESEARCH_CONFIGURED', 'CANCELLED', 'ARCHIVED'],
  SCRIPT_DRAFT: ['SCRIPT_REVIEW', 'CANCELLED', 'ARCHIVED'],
  // Rejection: SCRIPT_REVIEW -> SCRIPT_DRAFT
  SCRIPT_REVIEW: ['SCRIPT_APPROVED', 'SCRIPT_DRAFT', 'CANCELLED', 'ARCHIVED'],
  SCRIPT_APPROVED: ['AUDIO_PREVIEW', 'CANCELLED', 'ARCHIVED'],
  AUDIO_PREVIEW: ['AUDIO_REVIEW', 'CANCELLED', 'ARCHIVED'],
  // Rejection: AUDIO_REVIEW -> SCRIPT_DRAFT (wording) or AUDIO_PREVIEW (delivery-only)
  AUDIO_REVIEW: ['AUDIO_APPROVED', 'SCRIPT_DRAFT', 'AUDIO_PREVIEW', 'CANCELLED', 'ARCHIVED'],
  AUDIO_APPROVED: ['READY_TO_PUBLISH', 'CANCELLED', 'ARCHIVED'],
  // Rejection: READY_TO_PUBLISH -> AUDIO_REVIEW
  READY_TO_PUBLISH: ['PUBLISHED', 'AUDIO_REVIEW', 'CANCELLED', 'ARCHIVED'],
  // Published versions are immutable; corrections create a new version.
  PUBLISHED: [],
  CANCELLED: [],
  ARCHIVED: [],
};

/** Transitions that represent a rejection and therefore require a reason. */
const REJECTION_EDGES: ReadonlySet<string> = new Set([
  'RESEARCH_REVIEW->RESEARCH_CONFIGURED',
  'SCRIPT_REVIEW->SCRIPT_DRAFT',
  'AUDIO_REVIEW->SCRIPT_DRAFT',
  'AUDIO_REVIEW->AUDIO_PREVIEW',
  'READY_TO_PUBLISH->AUDIO_REVIEW',
]);

export interface TransitionCheck {
  allowed: boolean;
  isRejection: boolean;
  requiresReason: boolean;
  reason?: string;
}

/** Returns true when `to` is a legal next state from `from`. */
export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Evaluates a proposed transition. A rejection edge always requires a reason
 * (Section 3 gating rules) and creates a new task for the appropriate stage.
 */
export function evaluateTransition(
  from: WorkflowState,
  to: WorkflowState,
  providedReason?: string,
): TransitionCheck {
  const allowed = canTransition(from, to);
  const isRejection = REJECTION_EDGES.has(`${from}->${to}`);
  const requiresReason = isRejection || to === 'CANCELLED' || to === 'ARCHIVED';

  if (!allowed) {
    return {
      allowed: false,
      isRejection,
      requiresReason,
      reason: `Transition ${from} → ${to} is not permitted.`,
    };
  }
  if (requiresReason && !providedReason?.trim()) {
    return {
      allowed: false,
      isRejection,
      requiresReason,
      reason: `A reason is required to move from ${from} to ${to}.`,
    };
  }
  return { allowed: true, isRejection, requiresReason };
}

/** Convenience list of legal next states, for populating UI actions. */
export function nextStates(from: WorkflowState): readonly WorkflowState[] {
  return TRANSITIONS[from];
}

/** Published, cancelled, and archived are terminal. */
export function isTerminal(state: WorkflowState): boolean {
  return TRANSITIONS[state].length === 0;
}

// ---------------------------------------------------------------------------
// Role authorization (Section 2 — least-privilege, enforced server-side)
// ---------------------------------------------------------------------------

/**
 * Roles permitted to perform each transition, keyed by `${from}->${to}`.
 * `Administrator` is always allowed (handled in {@link authorizeTransition}).
 * Cancellation/archival from any state is allowed for the Creator and
 * Administrator (handled as a fallback), so those edges are omitted here.
 */
export const TRANSITION_ROLES: Readonly<Record<string, readonly AppRole[]>> = {
  // Authoring / research configuration is driven by the Creator.
  'DRAFT->RESEARCH_CONFIGURED': ['Creator'],
  'RESEARCH_CONFIGURED->RESEARCH_RUNNING': ['Creator'],
  'RESEARCH_RUNNING->RESEARCH_REVIEW': ['Creator'],
  'RESEARCH_RUNNING->RESEARCH_CONFIGURED': ['Creator'],
  // Research sign-off is a scientific-review gate.
  'RESEARCH_REVIEW->SCRIPT_DRAFT': ['ScientificReviewer'],
  'RESEARCH_REVIEW->RESEARCH_CONFIGURED': ['ScientificReviewer'],
  // Script authoring vs. script sign-off.
  'SCRIPT_DRAFT->SCRIPT_REVIEW': ['Creator'],
  'SCRIPT_REVIEW->SCRIPT_APPROVED': ['ScientificReviewer', 'MedicalLegalReviewer'],
  'SCRIPT_REVIEW->SCRIPT_DRAFT': ['ScientificReviewer', 'MedicalLegalReviewer'],
  // Synthesis preview is a creator action; audio sign-off is an audio-review gate.
  'SCRIPT_APPROVED->AUDIO_PREVIEW': ['Creator'],
  'AUDIO_PREVIEW->AUDIO_REVIEW': ['Creator'],
  'AUDIO_REVIEW->AUDIO_APPROVED': ['AudioReviewer'],
  'AUDIO_REVIEW->SCRIPT_DRAFT': ['AudioReviewer'],
  'AUDIO_REVIEW->AUDIO_PREVIEW': ['AudioReviewer'],
  // Publication gates are Publisher-only.
  'AUDIO_APPROVED->READY_TO_PUBLISH': ['Publisher'],
  'READY_TO_PUBLISH->PUBLISHED': ['Publisher'],
  'READY_TO_PUBLISH->AUDIO_REVIEW': ['Publisher'],
};

/**
 * Roles permitted to perform a transition, or `undefined` when the edge is not
 * role-restricted (e.g. cancellation/archival, handled by the caller).
 */
export function rolesForTransition(
  from: WorkflowState,
  to: WorkflowState,
): readonly AppRole[] | undefined {
  return TRANSITION_ROLES[`${from}->${to}`];
}

export interface AuthorizationCheck extends TransitionCheck {
  /** True when the actor's roles satisfy the transition's role requirement. */
  authorized: boolean;
}

/**
 * Full server-side gate: validates the edge + reason ({@link evaluateTransition})
 * and the actor's role authorization. `Administrator` may perform any legal
 * transition; `Creator` may always cancel or archive.
 */
export function authorizeTransition(
  from: WorkflowState,
  to: WorkflowState,
  roles: readonly AppRole[],
  providedReason?: string,
): AuthorizationCheck {
  const base = evaluateTransition(from, to, providedReason);
  if (!base.allowed) return { ...base, authorized: false };

  if (roles.includes('Administrator')) return { ...base, authorized: true };

  const required = rolesForTransition(from, to);
  const authorized = required
    ? roles.some((r) => required.includes(r))
    : // Un-mapped edges are cancellation/archival: the Creator may perform them.
      (to === 'CANCELLED' || to === 'ARCHIVED') && roles.includes('Creator');

  if (!authorized) {
    const need = required ?? (['Creator'] as const);
    return {
      ...base,
      allowed: false,
      authorized: false,
      reason: `Your active role is not permitted to move ${from} → ${to}. Required role: ${need.join(' or ')}.`,
    };
  }
  return { ...base, authorized: true };
}

/** Human-friendly labels for states. */
export const STATE_LABELS: Record<WorkflowState, string> = {
  DRAFT: 'Draft',
  RESEARCH_CONFIGURED: 'Research configured',
  RESEARCH_RUNNING: 'Research running',
  RESEARCH_REVIEW: 'Research review',
  SCRIPT_DRAFT: 'Script draft',
  SCRIPT_REVIEW: 'Script review',
  SCRIPT_APPROVED: 'Script approved',
  AUDIO_PREVIEW: 'Audio preview',
  AUDIO_REVIEW: 'Audio review',
  AUDIO_APPROVED: 'Audio approved',
  READY_TO_PUBLISH: 'Ready to publish',
  PUBLISHED: 'Published',
  CANCELLED: 'Cancelled',
  ARCHIVED: 'Archived',
};
