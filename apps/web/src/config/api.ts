/**
 * API base URL for the domain backend.
 *
 * Set VITE_API_BASE_URL at build time (e.g. the Container App FQDN) to enable
 * real Cosmos persistence and Azure Speech synthesis. When it is unset the SPA
 * runs entirely in-memory against its seed data — every feature still works,
 * nothing is persisted, and audio falls back to the browser speech preview.
 */

const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

/** Normalized base URL without a trailing slash, or undefined when not configured. */
export const API_BASE_URL: string | undefined = raw ? raw.replace(/\/+$/, '') : undefined;

export function apiEnabled(): boolean {
  return Boolean(API_BASE_URL);
}
