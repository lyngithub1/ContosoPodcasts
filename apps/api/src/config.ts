/**
 * Runtime configuration for the domain API.
 *
 * Every Azure integration is optional: when an endpoint is unset the matching
 * capability reports as disabled and the API degrades gracefully (the SPA falls
 * back to its in-browser store). All service-to-service auth uses the platform
 * user-assigned managed identity (AZURE_CLIENT_ID) via DefaultAzureCredential —
 * no secrets are read from configuration.
 */

export interface AppConfig {
  port: number;
  host: string;
  /** Allowed CORS origins, or `true` for reflect-any (dev/demo). */
  corsOrigins: string[] | boolean;
  azureClientId?: string;
  speechEndpoint?: string;
  speechResourceId?: string;
  speechDefaultVoice: string;
  cosmosEndpoint?: string;
  cosmosDatabase: string;
  searchEndpoint?: string;
  docIntelEndpoint?: string;
  serviceBusFqdn?: string;
  keyVaultUri?: string;
  storageBlobEndpoint?: string;
  /** Foundry project endpoint, e.g. https://<project>.services.ai.azure.com/api/projects/<name> */
  foundryProjectEndpoint?: string;
  foundryApiVersion: string;
  /**
   * Identity source for the acting user.
   * - 'header' (default): dev shim — id/name/roles from x-actor-* headers.
   * - 'entra': validate a Microsoft Entra Bearer JWT and derive identity from
   *   verified claims (oid/name/roles). Requires authTenantId + authAudience.
   */
  authMode: 'header' | 'entra';
  authTenantId?: string;
  /** Expected token audience — the API app's client id or Application ID URI. */
  authAudience?: string;
  /** Override the expected issuer (defaults to the v2.0 endpoint for the tenant). */
  authIssuer?: string;
  nodeEnv: string;
  /**
   * Explicit opt-in to the insecure `header` identity shim. Defaults to true only
   * when NODE_ENV is development/test. Outside those, the server refuses to start
   * in header mode unless ALLOW_HEADER_AUTH=true is set deliberately.
   */
  allowHeaderAuth: boolean;
}

function origins(value: string | undefined): string[] | boolean {
  if (!value || value.trim() === '' || value.trim() === '*') return true;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

function allowHeaderAuth(): boolean {
  const explicit = process.env.ALLOW_HEADER_AUTH;
  if (explicit !== undefined) return explicit.toLowerCase() === 'true';
  return nodeEnv === 'development' || nodeEnv === 'test';
}

export const config: AppConfig = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigins: origins(process.env.CORS_ORIGINS),
  azureClientId: process.env.AZURE_CLIENT_ID,
  speechEndpoint: process.env.SPEECH_ENDPOINT,
  speechResourceId: process.env.SPEECH_RESOURCE_ID,
  speechDefaultVoice: process.env.SPEECH_DEFAULT_VOICE ?? 'de-DE-KatjaNeural',
  cosmosEndpoint: process.env.COSMOS_ENDPOINT,
  cosmosDatabase: process.env.COSMOS_DATABASE ?? 'podcaststudio',
  searchEndpoint: process.env.SEARCH_ENDPOINT,
  docIntelEndpoint: process.env.DOCINTEL_ENDPOINT,
  serviceBusFqdn: process.env.SERVICEBUS_FQDN,
  keyVaultUri: process.env.KEYVAULT_URI,
  storageBlobEndpoint: process.env.STORAGE_BLOB_ENDPOINT,
  foundryProjectEndpoint: process.env.FOUNDRY_PROJECT_ENDPOINT,
  foundryApiVersion: process.env.FOUNDRY_API_VERSION ?? 'v1',
  authMode: process.env.AUTH_MODE === 'entra' ? 'entra' : 'header',
  authTenantId: process.env.AUTH_TENANT_ID,
  authAudience: process.env.AUTH_AUDIENCE,
  authIssuer: process.env.AUTH_ISSUER,
  nodeEnv,
  allowHeaderAuth: allowHeaderAuth(),
};
