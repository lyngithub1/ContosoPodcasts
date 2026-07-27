/**
 * Azure AI Search adapter (data-plane REST + managed identity).
 *
 * The Search service has `disableLocalAuth: true`, so there are no admin/query
 * keys — every call authenticates with an AAD bearer token for the platform
 * managed identity (scope https://search.azure.com/.default). The MI holds
 * "Search Service Contributor" (create index) and "Search Index Data
 * Contributor" (write/query documents).
 *
 * Index `research-index` holds retrievable grounding units — approved sources,
 * the structured-evidence brief, and individual claims — so the script stage
 * can retrieve the most relevant passages for a topic (factual grounding).
 */

import { getToken } from './azure.js';
import { config } from './config.js';

const SEARCH_SCOPE = 'https://search.azure.com/.default';
const API_VERSION = '2024-07-01';
export const SEARCH_INDEX = 'research-index';

export function searchEnabled(): boolean {
  return Boolean(config.searchEndpoint);
}

function base(): string {
  const ep = config.searchEndpoint;
  if (!ep) throw new Error('SEARCH_ENDPOINT is not configured');
  return ep.replace(/\/$/, '');
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken(SEARCH_SCOPE);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export interface SearchDoc {
  id: string;
  projectId: string;
  kind: 'source' | 'evidence' | 'claim';
  title: string;
  content: string;
  url: string;
  tags: string[];
  createdAt: string;
}

const INDEX_SCHEMA = {
  name: SEARCH_INDEX,
  fields: [
    { name: 'id', type: 'Edm.String', key: true, filterable: true, sortable: false, facetable: false },
    { name: 'projectId', type: 'Edm.String', filterable: true, sortable: false, facetable: true, searchable: false },
    { name: 'kind', type: 'Edm.String', filterable: true, facetable: true, searchable: false },
    { name: 'title', type: 'Edm.String', searchable: true, filterable: false },
    { name: 'content', type: 'Edm.String', searchable: true, filterable: false },
    { name: 'url', type: 'Edm.String', searchable: false, filterable: false },
    { name: 'tags', type: 'Collection(Edm.String)', searchable: true, filterable: true, facetable: true },
    { name: 'createdAt', type: 'Edm.String', searchable: false, filterable: true, sortable: true },
  ],
  semantic: {
    configurations: [
      {
        name: 'research-semantic',
        prioritizedFields: {
          titleField: { fieldName: 'title' },
          prioritizedContentFields: [{ fieldName: 'content' }],
          prioritizedKeywordsFields: [{ fieldName: 'tags' }],
        },
      },
    ],
  },
};

/** Create the research index if it does not already exist (idempotent). */
export async function ensureIndex(): Promise<void> {
  const headers = await authHeaders();
  const getRes = await fetch(`${base()}/indexes/${SEARCH_INDEX}?api-version=${API_VERSION}`, { headers });
  if (getRes.ok) return;
  if (getRes.status !== 404) {
    throw new Error(`Search index probe failed: HTTP ${getRes.status} ${await getRes.text()}`);
  }
  const putRes = await fetch(`${base()}/indexes/${SEARCH_INDEX}?api-version=${API_VERSION}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(INDEX_SCHEMA),
  });
  if (!putRes.ok) {
    throw new Error(`Search index create failed: HTTP ${putRes.status} ${await putRes.text()}`);
  }
}

/** Upsert (mergeOrUpload) a batch of documents into the research index. */
export async function indexDocuments(docs: SearchDoc[]): Promise<number> {
  if (docs.length === 0) return 0;
  const headers = await authHeaders();
  const body = JSON.stringify({ value: docs.map((d) => ({ '@search.action': 'mergeOrUpload', ...d })) });
  const res = await fetch(`${base()}/indexes/${SEARCH_INDEX}/docs/index?api-version=${API_VERSION}`, {
    method: 'POST',
    headers,
    body,
  });
  if (!res.ok) throw new Error(`Search index write failed: HTTP ${res.status} ${await res.text()}`);
  return docs.length;
}

export interface SearchHit {
  id: string;
  kind: string;
  title: string;
  content: string;
  url: string;
  score: number;
}

/** Full-text (optionally semantic) search scoped to one project. */
export async function searchProject(projectId: string, query: string, top = 5): Promise<SearchHit[]> {
  const headers = await authHeaders();
  const useSemantic = query.trim().length > 0;
  const payload: Record<string, unknown> = {
    search: query.trim() || '*',
    filter: `projectId eq '${projectId.replace(/'/g, "''")}'`,
    top,
    select: 'id,kind,title,content,url',
  };
  if (useSemantic) {
    payload.queryType = 'semantic';
    payload.semanticConfiguration = 'research-semantic';
  }
  const res = await fetch(`${base()}/indexes/${SEARCH_INDEX}/docs/search?api-version=${API_VERSION}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    // Semantic search can 400 if not enabled on the SKU/tier — retry as simple.
    if (useSemantic && res.status === 400) {
      const simple = await fetch(`${base()}/indexes/${SEARCH_INDEX}/docs/search?api-version=${API_VERSION}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          search: query.trim() || '*',
          filter: `projectId eq '${projectId.replace(/'/g, "''")}'`,
          top,
          select: 'id,kind,title,content,url',
        }),
      });
      if (!simple.ok) throw new Error(`Search query failed: HTTP ${simple.status} ${await simple.text()}`);
      return mapHits(await simple.json());
    }
    throw new Error(`Search query failed: HTTP ${res.status} ${await res.text()}`);
  }
  return mapHits(await res.json());
}

function mapHits(json: unknown): SearchHit[] {
  const value = (json as { value?: unknown[] }).value ?? [];
  return value.map((v) => {
    const d = v as Record<string, unknown>;
    return {
      id: String(d.id ?? ''),
      kind: String(d.kind ?? ''),
      title: String(d.title ?? ''),
      content: String(d.content ?? ''),
      url: String(d.url ?? ''),
      score: Number((d['@search.rerankerScore'] as number | undefined) ?? (d['@search.score'] as number | undefined) ?? 0),
    };
  });
}
