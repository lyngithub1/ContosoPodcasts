/**
 * Shared primitive types, identity, and versioning contracts for every
 * domain entity in Azure Scientific Podcast Studio.
 *
 * Per the specification (Section 6): "Every versioned entity must have an
 * immutable ID, version, created/modified identity, timestamps, status,
 * parent version, and content hash."
 */

/** ISO-8601 timestamp string. */
export type IsoTimestamp = string;

/** Opaque, immutable identifier. */
export type EntityId = string;

/** SHA-256 (or equivalent) content hash used for immutability + audit. */
export type ContentHash = string;

/** Supported output locales (Section 4.1). */
export type Locale =
  | 'en-US'
  | 'en-GB'
  | 'de-DE'
  | 'de-AT'
  | 'de-CH';

export const SUPPORTED_LOCALES: readonly Locale[] = [
  'en-US',
  'en-GB',
  'de-DE',
  'de-AT',
  'de-CH',
] as const;

/** A user/service principal reference captured for audit. */
export interface ActorRef {
  /** Entra object id or service principal id. */
  id: EntityId;
  displayName: string;
  /** Roles the actor held when performing the action. */
  roles: AppRole[];
}

/** Application roles (Section 2). Enforced server-side, least privilege. */
export type AppRole =
  | 'Creator'
  | 'ScientificReviewer'
  | 'MedicalLegalReviewer'
  | 'AudioReviewer'
  | 'Publisher'
  | 'Administrator'
  | 'Auditor';

/**
 * Base contract for every versioned artifact. Generated scripts,
 * pronunciation overrides, reviewer decisions, research evidence, and
 * published audio are all treated as versioned artifacts (rule 8).
 */
export interface VersionedEntity {
  id: EntityId;
  /** Monotonic version number starting at 1. */
  version: number;
  /** Id of the version this one was derived from, if any. */
  parentVersionId: EntityId | null;
  createdBy: ActorRef;
  createdAt: IsoTimestamp;
  modifiedBy: ActorRef;
  modifiedAt: IsoTimestamp;
  /** Immutable hash of the canonical content payload. */
  contentHash: ContentHash;
}

/** Generic lifecycle status shared by acceptance-style entities. */
export type AcceptanceStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'duplicate'
  | 'failed';

/** Capability availability states used across the admin registry (Section 15). */
export type CapabilityStatus =
  | 'configured'
  | 'verified'
  | 'degraded'
  | 'preview'
  | 'unavailable';
