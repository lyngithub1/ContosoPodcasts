/**
 * Route-level tests for the deployed API surface.
 *
 * These cover the security-critical claims the docs make:
 *  - workflow transitions are re-validated server-side (edge + role + reason)
 *  - a critical pronunciation-QA mismatch is a hard gate on audio approval
 *  - the generic collection endpoint cannot be used to bypass those gates
 *    (no state changes, no overwriting a publication)
 *  - publish enforces the Publisher role and its preconditions
 *
 * Cosmos is replaced with an in-memory stand-in so the suite runs with no cloud
 * resources. Everything above the persistence boundary is the real code path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => {
  /** collection -> id -> doc */
  const store = new Map<string, Map<string, Record<string, unknown>>>();

  const KNOWN = new Set([
    'projects',
    'scripts',
    'passages',
    'reviews',
    'recipients',
    'auditEvents',
    'pronunciationEntries',
    'researchPlans',
    'sources',
    'claims',
    'structuredEvidence',
    'synthesisJobs',
    'audioVersions',
    'qualityReports',
    'distributionLists',
    'publications',
    'deliveryReceipts',
    'voiceProfiles',
    'scriptTemplates',
  ]);

  function bucket(key: string) {
    let b = store.get(key);
    if (!b) {
      b = new Map();
      store.set(key, b);
    }
    return b;
  }

  return {
    store,
    reset: () => store.clear(),
    seed: (key: string, doc: Record<string, unknown>) => bucket(key).set(doc.id as string, doc),
    cosmos: {
      COLLECTIONS: [...KNOWN].map((key) => ({ key, container: key, pk: 'id' })),
      cosmosEnabled: () => true,
      isKnownCollection: (key: string) => KNOWN.has(key),
      readCollection: async (key: string) => [...bucket(key).values()],
      readAll: async () => Object.fromEntries([...store].map(([k, v]) => [k, [...v.values()]])),
      getItem: async (key: string, id: string) => bucket(key).get(id),
      readByPartition: async (key: string, pk: string) =>
        [...bucket(key).values()].filter((d) => d.projectId === pk),
      upsertItem: async (key: string, item: Record<string, unknown>) => {
        bucket(key).set(item.id as string, item);
        return item;
      },
      deleteItem: async (key: string, id: string) => {
        bucket(key).delete(id);
      },
    },
  };
});

vi.mock('./cosmos.js', () => mocks.cosmos);

const { buildServer } = await import('./server.js');

const CREATOR = { 'x-actor-id': 'u1', 'x-actor-name': 'Casey', 'x-actor-roles': 'Creator' };
const AUDIO_REVIEWER = { 'x-actor-id': 'u2', 'x-actor-name': 'Robin', 'x-actor-roles': 'AudioReviewer' };
const PUBLISHER = { 'x-actor-id': 'u3', 'x-actor-name': 'Pat', 'x-actor-roles': 'Publisher' };
const AUDITOR = { 'x-actor-id': 'u4', 'x-actor-name': 'Alex', 'x-actor-roles': 'Auditor' };

function project(id: string, state: string) {
  return { id, state, title: 'Test project', ownerId: 'u1' };
}

let app: FastifyInstance;

beforeEach(async () => {
  mocks.reset();
  app = await buildServer();
  await app.ready();
});

describe('POST /api/projects/:id/transition', () => {
  it('rejects an unknown target state with 400', async () => {
    mocks.seed('projects', project('p1', 'DRAFT'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/transition',
      headers: CREATOR,
      payload: { to: 'NOT_A_STATE' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('does not treat prototype keys as workflow states', async () => {
    mocks.seed('projects', project('p1', 'DRAFT'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/transition',
      headers: CREATOR,
      payload: { to: 'toString' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a project that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/nope/transition',
      headers: CREATOR,
      payload: { to: 'RESEARCH_CONFIGURED' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('applies a legal, authorized transition and writes an audit event', async () => {
    mocks.seed('projects', project('p1', 'DRAFT'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/transition',
      headers: CREATOR,
      payload: { to: 'RESEARCH_CONFIGURED' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.project.state).toBe('RESEARCH_CONFIGURED');
    expect(body.audit.eventType).toBe('state.transition');
    expect(body.audit.detail).toMatchObject({ from: 'DRAFT', to: 'RESEARCH_CONFIGURED' });
  });

  it('returns 422 for an illegal edge', async () => {
    mocks.seed('projects', project('p1', 'DRAFT'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/transition',
      headers: CREATOR,
      payload: { to: 'PUBLISHED' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('returns 403 when the edge is legal but the role is insufficient', async () => {
    mocks.seed('projects', project('p1', 'AUDIO_REVIEW'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/transition',
      headers: CREATOR, // needs AudioReviewer
      payload: { to: 'AUDIO_APPROVED' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 422 when a rejection edge is missing its reason', async () => {
    mocks.seed('projects', project('p1', 'SCRIPT_REVIEW'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/transition',
      headers: { 'x-actor-id': 'u5', 'x-actor-name': 'Sci', 'x-actor-roles': 'ScientificReviewer' },
      payload: { to: 'SCRIPT_DRAFT' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('never lets an Auditor change state', async () => {
    mocks.seed('projects', project('p1', 'DRAFT'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/transition',
      headers: AUDITOR,
      payload: { to: 'RESEARCH_CONFIGURED' },
    });
    expect(res.statusCode).toBe(403);
    expect(mocks.store.get('projects')?.get('p1')?.state).toBe('DRAFT');
  });

  it('blocks audio approval while a critical pronunciation QA mismatch is open', async () => {
    mocks.seed('projects', project('p1', 'AUDIO_REVIEW'));
    mocks.seed('qualityReports', { id: 'qr1', projectId: 'p1', hasBlockingIssues: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/transition',
      headers: AUDIO_REVIEWER,
      payload: { to: 'AUDIO_APPROVED' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/pronunciation/i);
    expect(mocks.store.get('projects')?.get('p1')?.state).toBe('AUDIO_REVIEW');
  });

  it('allows audio approval once no blocking issues remain', async () => {
    mocks.seed('projects', project('p1', 'AUDIO_REVIEW'));
    mocks.seed('qualityReports', { id: 'qr1', projectId: 'p1', hasBlockingIssues: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/transition',
      headers: AUDIO_REVIEWER,
      payload: { to: 'AUDIO_APPROVED' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('ignores a blocking report belonging to a different project', async () => {
    mocks.seed('projects', project('p1', 'AUDIO_REVIEW'));
    mocks.seed('qualityReports', { id: 'qr1', projectId: 'other', hasBlockingIssues: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/transition',
      headers: AUDIO_REVIEWER,
      payload: { to: 'AUDIO_APPROVED' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/collections/:key — gate-bypass guards', () => {
  it('refuses to change a project state through the generic upsert', async () => {
    mocks.seed('projects', project('p1', 'DRAFT'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/collections/projects',
      headers: CREATOR,
      payload: { ...project('p1', 'PUBLISHED') },
    });
    expect(res.statusCode).toBe(409);
    expect(mocks.store.get('projects')?.get('p1')?.state).toBe('DRAFT');
  });

  it('allows a non-state update to a project', async () => {
    mocks.seed('projects', project('p1', 'DRAFT'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/collections/projects',
      headers: CREATOR,
      payload: { ...project('p1', 'DRAFT'), title: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.store.get('projects')?.get('p1')?.title).toBe('Renamed');
  });

  it('refuses to overwrite an existing publication', async () => {
    mocks.seed('publications', { id: 'pub1', projectId: 'p1', revoked: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/collections/publications',
      headers: PUBLISHER,
      payload: { id: 'pub1', projectId: 'p1', revoked: true },
    });
    expect(res.statusCode).toBe(409);
    expect(mocks.store.get('publications')?.get('pub1')?.revoked).toBe(false);
  });

  it('returns 404 for an unknown collection', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/collections/not-a-collection',
      headers: CREATOR,
      payload: { id: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/projects/:id/publish', () => {
  const validBody = {
    audioVersionId: 'av1',
    scriptVersionId: 'sv1',
    channel: 'internal-link' as const,
    recipientIds: ['r1'],
    disclosureStatement: 'This episode uses synthetic voices.',
    acceptedSourceIds: ['s1'],
    expiresAt: null,
  };

  it('requires the Publisher role', async () => {
    mocks.seed('projects', project('p1', 'READY_TO_PUBLISH'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/publish',
      headers: CREATOR,
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to publish from a state that is not READY_TO_PUBLISH', async () => {
    mocks.seed('projects', project('p1', 'AUDIO_REVIEW'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/publish',
      headers: PUBLISHER,
      payload: validBody,
    });
    expect(res.statusCode).toBe(422);
  });

  it('requires a synthetic-media disclosure', async () => {
    mocks.seed('projects', project('p1', 'READY_TO_PUBLISH'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/publish',
      headers: PUBLISHER,
      payload: { ...validBody, disclosureStatement: '   ' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/disclosure/i);
  });

  it('requires at least one recipient', async () => {
    mocks.seed('projects', project('p1', 'READY_TO_PUBLISH'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/publish',
      headers: PUBLISHER,
      payload: { ...validBody, recipientIds: [] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/recipient/i);
  });

  it('publishes, creates a receipt per recipient, and records an audit event', async () => {
    mocks.seed('projects', project('p1', 'READY_TO_PUBLISH'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/publish',
      headers: PUBLISHER,
      payload: { ...validBody, recipientIds: ['r1', 'r2'] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.project.state).toBe('PUBLISHED');
    expect(body.receipts).toHaveLength(2);
    expect(body.publication.revoked).toBe(false);
    expect(body.audit.eventType).toBe('audio.published');
  });

  it('does not leak recipient addresses across receipts', async () => {
    mocks.seed('projects', project('p1', 'READY_TO_PUBLISH'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/publish',
      headers: PUBLISHER,
      payload: { ...validBody, recipientIds: ['r1', 'r2'] },
    });
    const receipts = res.json().receipts as Array<Record<string, unknown>>;
    for (const receipt of receipts) {
      expect(Object.values(receipt)).not.toContain('r1,r2');
      expect(receipt).not.toHaveProperty('recipientIds');
    }
    expect(new Set(receipts.map((r) => r.recipientId))).toEqual(new Set(['r1', 'r2']));
  });

  describe('onedrive channel', () => {
    // GRAPH_DRIVE_ID is unset in the test env, so the channel is unconfigured.
    it('returns 501 when OneDrive delivery is not configured', async () => {
      mocks.seed('projects', project('p1', 'READY_TO_PUBLISH'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/projects/p1/publish',
        headers: PUBLISHER,
        payload: { ...validBody, channel: 'onedrive' },
      });
      expect(res.statusCode).toBe(501);
      expect(res.json().error).toMatch(/GRAPH_DRIVE_ID/);
    });

    it('publishes nothing when delivery cannot happen (fails closed)', async () => {
      mocks.seed('projects', project('p1', 'READY_TO_PUBLISH'));
      await app.inject({
        method: 'POST',
        url: '/api/projects/p1/publish',
        headers: PUBLISHER,
        payload: { ...validBody, channel: 'onedrive' },
      });
      // The project must remain publishable, with no publication or receipts.
      expect(mocks.store.get('projects')?.get('p1')?.state).toBe('READY_TO_PUBLISH');
      expect(mocks.store.get('publications')?.size ?? 0).toBe(0);
      expect(mocks.store.get('deliveryReceipts')?.size ?? 0).toBe(0);
    });

    it('still enforces the Publisher role before attempting delivery', async () => {
      mocks.seed('projects', project('p1', 'READY_TO_PUBLISH'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/projects/p1/publish',
        headers: CREATOR,
        payload: { ...validBody, channel: 'onedrive' },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

describe('GET /healthz', () => {
  it('reports the active identity mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth).toBe('header');
  });
});
