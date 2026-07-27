/**
 * Cosmos DB persistence layer.
 *
 * Each logical collection maps to a Cosmos container (one-container-per-collection).
 * Reads are cross-partition SELECT *; writes are id-keyed upserts. System fields
 * (_rid/_etag/…) are stripped so the SPA receives clean domain shapes. Auth uses
 * the managed identity via AAD data-plane RBAC (no account keys).
 */

import { CosmosClient, type Container, type Database } from '@azure/cosmos';
import { config } from './config.js';
import { credential } from './azure.js';

export interface CollectionDef {
  /** Key used by the SPA bootstrap payload. */
  key: string;
  /** Cosmos container name. */
  container: string;
  /** Partition-key field on each document. */
  pk: string;
}

/**
 * Canonical collection ↔ container ↔ partition-key mapping. Must stay in sync
 * with the containers provisioned in infra/bicep/modules/cosmos.bicep.
 */
export const COLLECTIONS: CollectionDef[] = [
  { key: 'projects', container: 'projects', pk: 'id' },
  { key: 'scripts', container: 'scripts', pk: 'projectId' },
  { key: 'passages', container: 'evidence', pk: 'projectId' },
  { key: 'reviews', container: 'reviews', pk: 'projectId' },
  { key: 'recipients', container: 'recipients', pk: 'id' },
  { key: 'auditEvents', container: 'auditEvents', pk: 'projectId' },
  { key: 'pronunciationEntries', container: 'pronunciations', pk: 'locale' },
  { key: 'researchPlans', container: 'researchPlans', pk: 'projectId' },
  { key: 'sources', container: 'sources', pk: 'projectId' },
  { key: 'claims', container: 'claims', pk: 'projectId' },
  { key: 'structuredEvidence', container: 'structuredEvidence', pk: 'projectId' },
  { key: 'synthesisJobs', container: 'synthesisJobs', pk: 'projectId' },
  { key: 'audioVersions', container: 'audioVersions', pk: 'projectId' },
  { key: 'qualityReports', container: 'qualityReports', pk: 'projectId' },
  { key: 'distributionLists', container: 'distributionLists', pk: 'id' },
  { key: 'publications', container: 'publications', pk: 'projectId' },
  { key: 'deliveryReceipts', container: 'deliveryReceipts', pk: 'publicationId' },
  { key: 'voiceProfiles', container: 'voiceProfiles', pk: 'id' },
  { key: 'scriptTemplates', container: 'scriptTemplates', pk: 'id' },
];

const byKey = new Map(COLLECTIONS.map((c) => [c.key, c]));

export function cosmosEnabled(): boolean {
  return Boolean(config.cosmosEndpoint);
}

let db: Database | undefined;

function database(): Database {
  if (!config.cosmosEndpoint) throw new Error('COSMOS_ENDPOINT is not configured');
  if (!db) {
    const client = new CosmosClient({
      endpoint: config.cosmosEndpoint,
      aadCredentials: credential(),
    });
    db = client.database(config.cosmosDatabase);
  }
  return db;
}

function container(def: CollectionDef): Container {
  return database().container(def.container);
}

type Doc = Record<string, unknown>;

/** Remove Cosmos system properties (keys beginning with `_`). */
function strip(item: Doc): Doc {
  const out: Doc = {};
  for (const [k, v] of Object.entries(item)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

export function isKnownCollection(key: string): boolean {
  return byKey.has(key);
}

export async function readCollection(key: string): Promise<Doc[]> {
  const def = byKey.get(key);
  if (!def) throw new Error(`Unknown collection "${key}"`);
  const { resources } = await container(def).items.query<Doc>('SELECT * FROM c').fetchAll();
  return resources.map(strip);
}

/** Read one item by id, or undefined when it does not exist. */
export async function getItem(key: string, id: string, pk?: string): Promise<Doc | undefined> {
  const def = byKey.get(key);
  if (!def) throw new Error(`Unknown collection "${key}"`);
  const partitionValue = def.pk === 'id' ? id : pk;
  if (partitionValue === undefined) {
    // Partition value unknown: fall back to a cross-partition id lookup.
    const { resources } = await container(def)
      .items.query<Doc>({ query: 'SELECT * FROM c WHERE c.id = @id', parameters: [{ name: '@id', value: id }] })
      .fetchAll();
    return resources[0] ? strip(resources[0]) : undefined;
  }
  try {
    const { resource } = await container(def).item(id, partitionValue).read<Doc>();
    return resource ? strip(resource) : undefined;
  } catch (err) {
    if ((err as { code?: number }).code === 404) return undefined;
    throw err;
  }
}

/** Read all items in one partition (WHERE c.<pk> = value). */
export async function readByPartition(key: string, pkValue: string): Promise<Doc[]> {
  const def = byKey.get(key);
  if (!def) throw new Error(`Unknown collection "${key}"`);
  const { resources } = await container(def)
    .items.query<Doc>({
      query: `SELECT * FROM c WHERE c.${def.pk} = @v`,
      parameters: [{ name: '@v', value: pkValue }],
    })
    .fetchAll();
  return resources.map(strip);
}

/** Read every collection; a failing collection resolves to an empty array. */
export async function readAll(): Promise<Record<string, Doc[]>> {
  const result: Record<string, Doc[]> = {};
  await Promise.all(
    COLLECTIONS.map(async (def) => {
      try {
        result[def.key] = await readCollection(def.key);
      } catch {
        result[def.key] = [];
      }
    }),
  );
  return result;
}

export async function upsertItem(key: string, item: Doc): Promise<Doc> {
  const def = byKey.get(key);
  if (!def) throw new Error(`Unknown collection "${key}"`);
  if (!item || typeof item.id !== 'string') {
    throw new Error('Item must be an object with a string "id"');
  }
  const { resource } = await container(def).items.upsert<Doc>(item);
  return resource ? strip(resource) : item;
}

/**
 * Delete one item by id. When the container's partition key is not `id`, the
 * caller must supply the partition value (`pk`).
 */
export async function deleteItem(key: string, id: string, pk?: string): Promise<void> {
  const def = byKey.get(key);
  if (!def) throw new Error(`Unknown collection "${key}"`);
  const partitionValue = def.pk === 'id' ? id : pk;
  if (partitionValue === undefined) {
    throw new Error(`Deleting from "${key}" requires the "${def.pk}" partition value (pass ?pk=)`);
  }
  await container(def).item(id, partitionValue).delete();
}
