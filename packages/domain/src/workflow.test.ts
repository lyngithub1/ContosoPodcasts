import { describe, expect, it } from 'vitest';
import {
  authorizeTransition,
  canTransition,
  evaluateTransition,
  isStageComplete,
  isTerminal,
  nextStates,
  rolesForTransition,
  STAGE_ORDER,
  STATE_TO_STAGE,
  type WorkflowState,
} from './workflow.js';

describe('isStageComplete (timeline checkmarks)', () => {
  it('marks stages the project has moved past as complete', () => {
    expect(isStageComplete('Research', 'SCRIPT_DRAFT')).toBe(true);
    expect(isStageComplete('Evidence', 'SCRIPT_DRAFT')).toBe(true);
  });

  it('does not mark stages the project has not reached', () => {
    expect(isStageComplete('Review', 'SCRIPT_DRAFT')).toBe(false);
    expect(isStageComplete('Publish', 'AUDIO_REVIEW')).toBe(false);
  });

  it('leaves the current stage incomplete while its decision is pending', () => {
    expect(isStageComplete('Review', 'AUDIO_REVIEW')).toBe(false);
    expect(isStageComplete('Script', 'SCRIPT_REVIEW')).toBe(false);
  });

  it('marks the current stage complete once its decision is recorded', () => {
    // AUDIO_APPROVED still maps to the Review stage, but the reviewer is done.
    expect(STATE_TO_STAGE.AUDIO_APPROVED).toBe('Review');
    expect(isStageComplete('Review', 'AUDIO_APPROVED')).toBe(true);

    expect(STATE_TO_STAGE.SCRIPT_APPROVED).toBe('Script');
    expect(isStageComplete('Script', 'SCRIPT_APPROVED')).toBe(true);
  });

  it('keeps Review complete once the project reaches Publish', () => {
    expect(isStageComplete('Review', 'READY_TO_PUBLISH')).toBe(true);
    expect(isStageComplete('Review', 'PUBLISHED')).toBe(true);
  });

  it('marks every stage complete when published', () => {
    for (const stage of STAGE_ORDER) {
      expect(isStageComplete(stage, 'PUBLISHED')).toBe(true);
    }
  });

  it('never regresses along the happy path', () => {
    // Once a stage is complete for some state, it stays complete for every
    // later state on the forward path.
    const forward: WorkflowState[] = [
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
    ];
    for (const stage of STAGE_ORDER) {
      let sawComplete = false;
      for (const state of forward) {
        const complete = isStageComplete(stage, state);
        if (complete) sawComplete = true;
        else if (sawComplete) {
          throw new Error(`Stage "${stage}" regressed to incomplete at state "${state}"`);
        }
      }
    }
  });
});

describe('workflow state machine', () => {
  it('allows the happy-path forward transitions', () => {
    expect(canTransition('DRAFT', 'RESEARCH_CONFIGURED')).toBe(true);
    expect(canTransition('SCRIPT_REVIEW', 'SCRIPT_APPROVED')).toBe(true);
    expect(canTransition('READY_TO_PUBLISH', 'PUBLISHED')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false);
    expect(canTransition('SCRIPT_DRAFT', 'AUDIO_PREVIEW')).toBe(false);
  });

  it('treats PUBLISHED, CANCELLED, and ARCHIVED as terminal', () => {
    expect(isTerminal('PUBLISHED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('ARCHIVED')).toBe(true);
    expect(isTerminal('DRAFT')).toBe(false);
  });

  it('requires a reason for rejection edges', () => {
    const withoutReason = evaluateTransition('SCRIPT_REVIEW', 'SCRIPT_DRAFT');
    expect(withoutReason.allowed).toBe(false);
    expect(withoutReason.isRejection).toBe(true);
    expect(withoutReason.requiresReason).toBe(true);

    const withReason = evaluateTransition('SCRIPT_REVIEW', 'SCRIPT_DRAFT', 'Missing citation on claim 3');
    expect(withReason.allowed).toBe(true);
  });

  it('requires a reason to cancel or archive', () => {
    expect(evaluateTransition('DRAFT', 'CANCELLED').allowed).toBe(false);
    expect(evaluateTransition('DRAFT', 'CANCELLED', 'Duplicate project').allowed).toBe(true);
  });

  it('supports both audio-review rejection paths', () => {
    // wording change -> back to SCRIPT_DRAFT
    expect(evaluateTransition('AUDIO_REVIEW', 'SCRIPT_DRAFT', 'Reword safety section').allowed).toBe(true);
    // delivery-only change -> back to AUDIO_PREVIEW
    expect(evaluateTransition('AUDIO_REVIEW', 'AUDIO_PREVIEW', 'Slow down drug name').allowed).toBe(true);
  });

  it('does not permit escaping a terminal state', () => {
    expect(nextStates('PUBLISHED')).toHaveLength(0);
  });

  it('maps every state to a production stage', () => {
    const states = Object.keys(STATE_TO_STAGE) as WorkflowState[];
    for (const s of states) {
      expect(STATE_TO_STAGE[s]).toBeDefined();
    }
  });
});

describe('workflow role authorization', () => {
  it('maps the audio-approval gate to the AudioReviewer role', () => {
    expect(rolesForTransition('AUDIO_REVIEW', 'AUDIO_APPROVED')).toEqual(['AudioReviewer']);
  });

  it('permits the required role and denies others', () => {
    const ok = authorizeTransition('AUDIO_REVIEW', 'AUDIO_APPROVED', ['AudioReviewer']);
    expect(ok.allowed).toBe(true);
    expect(ok.authorized).toBe(true);

    const denied = authorizeTransition('AUDIO_REVIEW', 'AUDIO_APPROVED', ['Creator']);
    expect(denied.allowed).toBe(false);
    expect(denied.authorized).toBe(false);
    expect(denied.reason).toMatch(/AudioReviewer/);
  });

  it('lets an Administrator perform any legal transition', () => {
    expect(authorizeTransition('READY_TO_PUBLISH', 'PUBLISHED', ['Administrator']).allowed).toBe(true);
  });

  it('still rejects illegal edges regardless of role', () => {
    const bad = authorizeTransition('DRAFT', 'PUBLISHED', ['Administrator']);
    expect(bad.allowed).toBe(false);
    expect(bad.authorized).toBe(false);
  });

  it('gates publication behind the Publisher role', () => {
    expect(authorizeTransition('READY_TO_PUBLISH', 'PUBLISHED', ['Publisher']).allowed).toBe(true);
    expect(authorizeTransition('READY_TO_PUBLISH', 'PUBLISHED', ['AudioReviewer']).allowed).toBe(false);
  });

  it('lets the Creator cancel or archive but not an unrelated reviewer', () => {
    expect(authorizeTransition('DRAFT', 'CANCELLED', ['Creator'], 'Duplicate').allowed).toBe(true);
    expect(authorizeTransition('DRAFT', 'CANCELLED', ['AudioReviewer'], 'Duplicate').allowed).toBe(false);
  });

  it('enforces the reason requirement even for an authorized role', () => {
    const noReason = authorizeTransition('SCRIPT_REVIEW', 'SCRIPT_DRAFT', ['ScientificReviewer']);
    expect(noReason.allowed).toBe(false);
    const withReason = authorizeTransition('SCRIPT_REVIEW', 'SCRIPT_DRAFT', ['ScientificReviewer'], 'Fix claim 3');
    expect(withReason.allowed).toBe(true);
  });
});
