/**
 * Microsoft Entra ID sign-in configuration for the SPA.
 *
 * Auth is **opt-in**: unless a tenant, client id, and API scope are all supplied
 * at build time the app keeps its demo identity (a role selector plus `x-actor-*`
 * headers), so the in-browser walkthrough continues to work with no cloud setup.
 *
 * Set these in `.env.local` (or as CI build variables):
 *   VITE_ENTRA_TENANT_ID   the directory (tenant) id
 *   VITE_ENTRA_CLIENT_ID   the SPA app registration's application (client) id
 *   VITE_ENTRA_API_SCOPE   the API's exposed scope, e.g. api://podstudio-api/access_as_user
 *   VITE_ENTRA_REDIRECT_URI  (optional) defaults to the current origin
 *
 * NOTE: none of these are secrets. A SPA is a public client — it holds no
 * credential. All privileged calls are authorized server-side from the token.
 */

const tenantId = (import.meta.env.VITE_ENTRA_TENANT_ID as string | undefined)?.trim();
const clientId = (import.meta.env.VITE_ENTRA_CLIENT_ID as string | undefined)?.trim();
const apiScope = (import.meta.env.VITE_ENTRA_API_SCOPE as string | undefined)?.trim();
const redirectUri = (import.meta.env.VITE_ENTRA_REDIRECT_URI as string | undefined)?.trim();

/** A placeholder client id from `.env.example` must not count as configured. */
const PLACEHOLDER_CLIENT_ID = '00000000-0000-0000-0000-000000000000';

export const entraConfig = {
  tenantId,
  clientId,
  apiScope,
  redirectUri: redirectUri || (typeof window !== 'undefined' ? window.location.origin : undefined),
};

/** True when real Entra sign-in is configured and should replace the demo identity. */
export function authEnabled(): boolean {
  return Boolean(tenantId && clientId && clientId !== PLACEHOLDER_CLIENT_ID && apiScope);
}
