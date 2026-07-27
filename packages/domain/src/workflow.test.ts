import { describe, expect, it } from 'vitest';
import {
  authorizeTransition,
  canTransition,
  evaluateTransition,
  isTerminal,
  nextStates,
  rolesForTransition,
  STATE_TO_STAGE,
  type WorkflowState,
} from './workflow.js';

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
