import type { ActorRef, AppRole } from '@studio/domain';

/** Deterministic pseudo-hash for demo content (NOT cryptographic). */
export function demoHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return 'sha256:demo-' + (h >>> 0).toString(16).padStart(8, '0');
}

export function iso(daysAgo = 0, hour = 9): string {
  const d = new Date('2026-07-22T09:00:00Z');
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour);
  return d.toISOString();
}

export const ALL_ROLES: AppRole[] = [
  'Creator',
  'ScientificReviewer',
  'MedicalLegalReviewer',
  'AudioReviewer',
  'Publisher',
  'Administrator',
  'Auditor',
];

/**
 * The signed-in demo user holds multiple roles (Spec §2). `Administrator` is
 * included so a single operator can drive the full walkthrough without
 * switching roles at every gate; switch to a specific role to demo gating.
 */
export const currentUser: ActorRef = {
  id: 'user-avery',
  displayName: 'Avery Ng',
  roles: ['Administrator', 'Creator', 'ScientificReviewer', 'AudioReviewer', 'Publisher'],
};

export const people: Record<string, ActorRef> = {
  avery: currentUser,
  lena: { id: 'user-lena', displayName: 'Dr. Lena Vogt', roles: ['ScientificReviewer'] },
  marco: { id: 'user-marco', displayName: 'Marco Feldt', roles: ['MedicalLegalReviewer'] },
  priya: { id: 'user-priya', displayName: 'Priya Raman', roles: ['AudioReviewer'] },
  sam: { id: 'user-sam', displayName: 'Sam Okoro', roles: ['Administrator'] },
};
