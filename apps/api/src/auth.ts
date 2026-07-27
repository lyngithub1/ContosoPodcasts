/**
 * Microsoft Entra ID access-token validation (opt-in).
 *
 * Enabled by setting `AUTH_MODE=entra` plus `AUTH_TENANT_ID` and `AUTH_AUDIENCE`.
 * When enabled, {@link registerAuth} installs a Fastify `onRequest` hook that:
 *   1. lets unauthenticated public routes through (health/readiness),
 *   2. requires an `Authorization: Bearer <jwt>` header on every other route,
 *   3. verifies the JWT signature against the tenant's JWKS and validates the
 *      issuer + audience, then
 *   4. maps the verified claims to an {@link Actor} and attaches it to
 *      `req.actor` (consumed by {@link getActor}).
 *
 * Role source: the app registration must expose **app roles** whose values match
 * our {@link AppRole} names (Creator, ScientificReviewer, MedicalLegalReviewer,
 * AudioReviewer, Publisher, Administrator, Auditor). Entra emits assigned app
 * roles in the `roles` claim.
 *
 * When `AUTH_MODE` is unset/`header`, this module is inert and the header shim in
 * ./actor.ts remains active — the demo keeps working unchanged.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config } from './config.js';
import { KNOWN_ROLES, type Actor } from './actor.js';
import type { AppRole } from './workflow.js';

/** Routes that never require a token. */
const PUBLIC_PATHS = new Set<string>(['/healthz', '/readyz']);

/** True when Entra token validation is configured and should be enforced. */
export function entraAuthEnabled(): boolean {
  return config.authMode === 'entra' && Boolean(config.authTenantId) && Boolean(config.authAudience);
}

function expectedIssuer(): string {
  return config.authIssuer ?? `https://login.microsoftonline.com/${config.authTenantId}/v2.0`;
}

// Lazily-created remote JWKS (cached + auto-refreshed by jose).
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${config.authTenantId}/discovery/v2.0/keys`),
    );
  }
  return jwks;
}

function rolesFromClaims(payload: JWTPayload): AppRole[] {
  const raw = payload.roles;
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[ ,]+/) : [];
  return values
    .map((r) => String(r).trim())
    .filter((r): r is AppRole => (KNOWN_ROLES as readonly string[]).includes(r));
}

function actorFromClaims(payload: JWTPayload): Actor {
  const id = (payload.oid as string) ?? (payload.sub as string) ?? 'unknown';
  const displayName =
    (payload.name as string) ?? (payload.preferred_username as string) ?? (payload.upn as string) ?? id;
  return { id, displayName, roles: rolesFromClaims(payload) };
}

function bearerToken(req: FastifyRequest): string | undefined {
  const raw = req.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const [scheme, token] = value.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token.trim() : undefined;
}

/**
 * Install the auth hook.
 *
 * Fails **closed**: if `AUTH_MODE=entra` is requested but the tenant/audience are
 * missing, we throw at startup rather than silently degrading to the spoofable
 * header shim. A half-configured deployment must not look like a secured one.
 *
 * In `header` mode the hook is inert and the shim in ./actor.ts stays active. That
 * is a demo-only posture, so we log it loudly (and refuse it outright when
 * `ALLOW_HEADER_AUTH` is not explicitly opted into for a non-development
 * `NODE_ENV`).
 */
export function registerAuth(app: FastifyInstance): void {
  if (config.authMode === 'entra' && !entraAuthEnabled()) {
    throw new Error(
      'AUTH_MODE=entra requires AUTH_TENANT_ID and AUTH_AUDIENCE. ' +
        'Refusing to start, because falling back to the x-actor-* header shim would ' +
        'silently accept client-supplied identities and roles.',
    );
  }

  if (!entraAuthEnabled()) {
    if (!config.allowHeaderAuth) {
      throw new Error(
        `Identity is in 'header' mode (client-supplied x-actor-* identity and roles), ` +
          `which is insecure and intended only for the local demo. NODE_ENV=${config.nodeEnv}. ` +
          `Set AUTH_MODE=entra (with AUTH_TENANT_ID + AUTH_AUDIENCE) for a real deployment, ` +
          `or set ALLOW_HEADER_AUTH=true to acknowledge running the unauthenticated demo.`,
      );
    }
    app.log.warn(
      'INSECURE IDENTITY MODE: trusting client-supplied x-actor-* headers. ' +
        'Anyone who can reach this API can claim any role. Demo use only.',
    );
    return;
  }

  app.log.info({ issuer: expectedIssuer(), audience: config.authAudience }, 'Entra token validation enabled');

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? req.url;
    if (req.method === 'OPTIONS' || PUBLIC_PATHS.has(path)) return;

    const token = bearerToken(req);
    if (!token) {
      return reply.code(401).send({ error: 'Missing Bearer token' });
    }
    try {
      const { payload } = await jwtVerify(token, getJwks(), {
        issuer: expectedIssuer(),
        audience: config.authAudience,
      });
      req.actor = actorFromClaims(payload);
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'token validation failed');
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }
  });
}
