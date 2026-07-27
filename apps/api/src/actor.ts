/**
 * Actor identity for audit + authorization.
 *
 * Two identity sources are supported, selected by `config.authMode`:
 *
 * - 'header' (default): development shim — the acting user's id, name, and roles
 *   are read from request headers (`x-actor-id`, `x-actor-name`,
 *   `x-actor-roles`). This mirrors the SPA's role-selector demo identity and
 *   lets the server enforce role-gated transitions today. Headers are
 *   client-supplied and therefore spoofable — acceptable only for the demo.
 *
 * - 'entra': a Fastify hook (see ./auth.ts) validates the Microsoft Entra Bearer
 *   token on each request and attaches the verified `Actor` to `req.actor`. In
 *   this mode the header shim is ignored and identity comes only from signed
 *   token claims (`oid`/`name`/`roles`). The enforcement logic elsewhere is
 *   unchanged — only the identity source is swapped.
 */

import type { FastifyRequest } from 'fastify';
import type { AppRole } from './workflow.js';

export interface Actor {
  id: string;
  displayName: string;
  roles: AppRole[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Verified actor set by the Entra auth hook (only in authMode 'entra'). */
    actor?: Actor;
  }
}

export const KNOWN_ROLES: readonly AppRole[] = [
  'Creator',
  'ScientificReviewer',
  'MedicalLegalReviewer',
  'AudioReviewer',
  'Publisher',
  'Administrator',
  'Auditor',
];

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function parseRoles(raw: string | undefined): AppRole[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is AppRole => (KNOWN_ROLES as readonly string[]).includes(s));
}

/**
 * Resolve the acting user. Prefers the verified `req.actor` attached by the
 * Entra auth hook; falls back to the header shim (see file header).
 */
export function getActor(req: FastifyRequest): Actor {
  if (req.actor) return req.actor;
  return {
    id: header(req, 'x-actor-id') ?? 'anonymous',
    displayName: header(req, 'x-actor-name') ?? 'Anonymous',
    roles: parseRoles(header(req, 'x-actor-roles')),
  };
}
