/**
 * Managed-identity credential + cached AAD token acquisition.
 *
 * In Azure the container runs as the user-assigned managed identity referenced
 * by AZURE_CLIENT_ID. Locally, DefaultAzureCredential falls back to the signed-in
 * Azure CLI / Developer CLI identity, so the same code path works for dev.
 */

import { DefaultAzureCredential, type AccessToken, type TokenCredential } from '@azure/identity';
import { config } from './config.js';

let cred: TokenCredential | undefined;

export function credential(): TokenCredential {
  if (!cred) {
    cred = new DefaultAzureCredential(
      config.azureClientId ? { managedIdentityClientId: config.azureClientId } : {},
    );
  }
  return cred;
}

const tokenCache = new Map<string, AccessToken>();

/** Acquire (and cache) a bearer token for the given scope. */
export async function getToken(scope: string): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresOnTimestamp - Date.now() > 60_000) return cached.token;
  const token = await credential().getToken(scope);
  if (!token) throw new Error(`Failed to acquire a token for scope ${scope}`);
  tokenCache.set(scope, token);
  return token.token;
}
