/**
 * MSAL browser integration.
 *
 * Loaded lazily and only when {@link authEnabled} is true, so the demo build
 * neither bundles nor initializes MSAL when Entra is not configured.
 *
 * Responsibilities:
 *  - initialize a single {@link PublicClientApplication}
 *  - complete the redirect handshake on first load
 *  - expose {@link getAccessToken} for the API client (silent-first, redirect on
 *    interaction required)
 *  - expose {@link getSignedInActor} so the UI shows the *real* signed-in user
 *    and their *assigned app roles* rather than the demo actor
 */

import type {
  AccountInfo,
  AuthenticationResult,
  PublicClientApplication,
} from '@azure/msal-browser';
import { entraConfig, authEnabled } from '../config/auth';

/** Roles the domain understands; anything else in the token is ignored. */
const KNOWN_ROLES = [
  'Creator',
  'ScientificReviewer',
  'MedicalLegalReviewer',
  'AudioReviewer',
  'Publisher',
  'Administrator',
  'Auditor',
] as const;

export type KnownRole = (typeof KNOWN_ROLES)[number];

export interface SignedInActor {
  id: string;
  displayName: string;
  roles: KnownRole[];
}

let msalPromise: Promise<PublicClientApplication> | null = null;

async function getMsal(): Promise<PublicClientApplication> {
  if (!msalPromise) {
    msalPromise = (async () => {
      const { PublicClientApplication: Pca } = await import('@azure/msal-browser');
      const pca = new Pca({
        auth: {
          clientId: entraConfig.clientId!,
          authority: `https://login.microsoftonline.com/${entraConfig.tenantId}`,
          redirectUri: entraConfig.redirectUri,
        },
        cache: {
          // Session storage keeps tokens out of long-lived browser storage.
          cacheLocation: 'sessionStorage',
          storeAuthStateInCookie: false,
        },
      });
      await pca.initialize();
      const result = await pca.handleRedirectPromise();
      const account = result?.account ?? pca.getAllAccounts()[0];
      if (account) pca.setActiveAccount(account);
      return pca;
    })();
  }
  return msalPromise;
}

/** Complete any pending redirect and report whether a user is signed in. */
export async function initAuth(): Promise<SignedInActor | null> {
  if (!authEnabled()) return null;
  const pca = await getMsal();
  const account = pca.getActiveAccount();
  return account ? actorFromAccount(account) : null;
}

export async function signIn(): Promise<void> {
  if (!authEnabled()) return;
  const pca = await getMsal();
  await pca.loginRedirect({ scopes: [entraConfig.apiScope!] });
}

export async function signOut(): Promise<void> {
  if (!authEnabled()) return;
  const pca = await getMsal();
  await pca.logoutRedirect({ account: pca.getActiveAccount() ?? undefined });
}

function rolesFromClaims(claims: Record<string, unknown> | undefined): KnownRole[] {
  const raw = claims?.roles;
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[ ,]+/) : [];
  return values
    .map((r) => String(r).trim())
    .filter((r): r is KnownRole => (KNOWN_ROLES as readonly string[]).includes(r));
}

function actorFromAccount(account: AccountInfo): SignedInActor {
  const claims = account.idTokenClaims as Record<string, unknown> | undefined;
  return {
    id: (claims?.oid as string) ?? account.localAccountId ?? account.homeAccountId,
    displayName: account.name ?? account.username,
    roles: rolesFromClaims(claims),
  };
}

/** The signed-in user, or null when not authenticated / auth disabled. */
export async function getSignedInActor(): Promise<SignedInActor | null> {
  if (!authEnabled()) return null;
  const pca = await getMsal();
  const account = pca.getActiveAccount();
  return account ? actorFromAccount(account) : null;
}

/**
 * Acquire an access token for the API.
 *
 * Silent first; if the user must interact we fall back to a redirect (which
 * navigates away, so the caller's promise never resolves in that path).
 * Returns null when auth is disabled or no account is present.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!authEnabled()) return null;
  const pca = await getMsal();
  const account = pca.getActiveAccount();
  if (!account) return null;

  const request = { scopes: [entraConfig.apiScope!], account };
  try {
    const result: AuthenticationResult = await pca.acquireTokenSilent(request);
    return result.accessToken;
  } catch {
    // Consent, MFA, or an expired refresh token — needs a full redirect.
    await pca.acquireTokenRedirect(request);
    return null;
  }
}
