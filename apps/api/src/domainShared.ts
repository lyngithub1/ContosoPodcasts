/**
 * Small domain helpers shared between the HTTP routes and the background
 * Service Bus workers so the synthesis / QA logic is defined exactly once.
 */

import { createHash, randomUUID } from 'node:crypto';
import { upsertItem } from './cosmos.js';
import type { Actor } from './actor.js';

export type Doc = Record<string, unknown>;

export function contentHash(input: string): string {
  return 'sha256:' + createHash('sha256').update(input).digest('hex');
}

export function actorRef(actor: Actor): Doc {
  return { id: actor.id, displayName: actor.displayName, roles: actor.roles };
}

/** Coerce a Cosmos field into a string[] (drops non-strings). */
export function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Build + persist an immutable audit event. */
export async function writeAudit(
  actor: Actor,
  projectId: string | null,
  eventType: string,
  summary: string,
  detail: Record<string, string | number | boolean | null>,
  hash: string | null,
): Promise<Doc> {
  const event: Doc = {
    id: 'ae-' + randomUUID(),
    projectId,
    at: new Date().toISOString(),
    actor: actorRef(actor),
    eventType,
    summary,
    detail,
    contentHash: hash,
  };
  return upsertItem('auditEvents', event);
}
