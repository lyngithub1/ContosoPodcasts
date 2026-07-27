/**
 * Tests for the server-authoritative workflow gate.
 *
 * Two jobs:
 *  1. **Drift guard.** `apps/api/src/workflow.ts` is a hand-vendored mirror of
 *     `packages/domain/src/workflow.ts` (the API's Docker build context is the
 *     `apps/api` folder alone and cannot resolve the workspace package). These
 *     tests compare the two implementations' *behavior* across every state pair
 *     and role combination, so any divergence fails CI instead of silently
 *     shipping two different rulebooks.
 *  2. **Authorization semantics.** Illegal edges, required reasons, role gating,
 *     and the Administrator override.
 */

import { describe, expect, it } from 'vitest';
import {
  authorizeTransition,
  canTransition,
  isWorkflowState,
  rolesForTransition,
  type AppRole,
  type WorkflowState,
} from './workflow.js';
import * as domain from '../../../packages/domain/src/workflow.js';

const ALL_STATES: WorkflowState[] = [
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
  'CANCELLED',
  'ARCHIVED',
];

const ALL_ROLES: AppRole[] = [
  'Creator',
  'ScientificReviewer',
  'MedicalLegalReviewer',
  'AudioReviewer',
  'Publisher',
  'Administrator',
  'Auditor',
];

describe('parity with @studio/domain', () => {
  it('agrees on every legal transition edge', () => {
    const mismatches: string[] = [];
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const mine = canTransition(from, to);
        const theirs = domain.canTransition(from, to);
        if (mine !== theirs) mismatches.push(`${from}->${to}: api=${mine} domain=${theirs}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('agrees on the roles required for every edge', () => {
    const mismatches: string[] = [];
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const mine = rolesForTransition(from, to);
        const theirs = domain.rolesForTransition(from, to);
        if (JSON.stringify(mine ?? null) !== JSON.stringify(theirs ?? null)) {
          mismatches.push(`${from}->${to}: api=${JSON.stringify(mine)} domain=${JSON.stringify(theirs)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('agrees on allow/deny for every state pair x single role, with and without a reason', () => {
    const mismatches: string[] = [];
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        for (const role of ALL_ROLES) {
          for (const reason of [undefined, 'because']) {
            const mine = authorizeTransition(from, to, [role], reason);
            const theirs = domain.authorizeTransition(from, to, [role], reason);
            if (
              mine.allowed !== theirs.allowed ||
              mine.isRejection !== theirs.isRejection ||
              mine.requiresReason !== theirs.requiresReason
            ) {
              mismatches.push(
                `${from}->${to} as ${role} reason=${String(reason)}: ` +
                  `api=${JSON.stringify(mine)} domain=${JSON.stringify(theirs)}`,
              );
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('isWorkflowState', () => {
  it('accepts known states and rejects anything else', () => {
    expect(isWorkflowState('AUDIO_REVIEW')).toBe(true);
    expect(isWorkflowState('NOT_A_STATE')).toBe(false);
    expect(isWorkflowState(undefined)).toBe(false);
    expect(isWorkflowState(42)).toBe(false);
    // Prototype keys must not leak through the `in` check.
    expect(isWorkflowState('toString')).toBe(false);
    expect(isWorkflowState('constructor')).toBe(false);
  });
});

describe('authorizeTransition', () => {
  it('refuses an illegal edge regardless of role', () => {
    const check = authorizeTransition('DRAFT', 'PUBLISHED', ['Administrator']);
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/not permitted/i);
  });

  it('refuses a legal edge when the actor lacks the role', () => {
    const check = authorizeTransition('AUDIO_REVIEW', 'AUDIO_APPROVED', ['Creator']);
    expect(check.allowed).toBe(false);
    expect(check.authorized).toBe(false);
  });

  it('allows a legal edge for the required role', () => {
    const check = authorizeTransition('AUDIO_REVIEW', 'AUDIO_APPROVED', ['AudioReviewer']);
    expect(check.allowed).toBe(true);
  });

  it('requires a reason on rejection edges', () => {
    const without = authorizeTransition('SCRIPT_REVIEW', 'SCRIPT_DRAFT', ['ScientificReviewer']);
    expect(without.allowed).toBe(false);
    expect(without.requiresReason).toBe(true);

    const with_ = authorizeTransition('SCRIPT_REVIEW', 'SCRIPT_DRAFT', ['ScientificReviewer'], 'needs edits');
    expect(with_.allowed).toBe(true);
    expect(with_.isRejection).toBe(true);
  });

  it('requires a reason to cancel or archive', () => {
    expect(authorizeTransition('DRAFT', 'CANCELLED', ['Creator']).allowed).toBe(false);
    expect(authorizeTransition('DRAFT', 'CANCELLED', ['Creator'], 'duplicate').allowed).toBe(true);
  });

  it('treats a whitespace-only reason as missing', () => {
    expect(authorizeTransition('DRAFT', 'CANCELLED', ['Creator'], '   ').allowed).toBe(false);
  });

  it('lets Administrator perform any legal transition', () => {
    expect(authorizeTransition('AUDIO_REVIEW', 'AUDIO_APPROVED', ['Administrator']).allowed).toBe(true);
    expect(authorizeTransition('READY_TO_PUBLISH', 'PUBLISHED', ['Administrator']).allowed).toBe(true);
  });

  it('never lets Auditor change state', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        expect(authorizeTransition(from, to, ['Auditor'], 'reason').allowed).toBe(false);
      }
    }
  });

  it('has no outbound edges from terminal states', () => {
    for (const terminal of ['PUBLISHED', 'CANCELLED', 'ARCHIVED'] as WorkflowState[]) {
      for (const to of ALL_STATES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });
});
