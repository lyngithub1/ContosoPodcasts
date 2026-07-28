/**
 * HTTP routes for the domain API.
 *
 * - GET  /healthz                      liveness + capability report
 * - GET  /api/bootstrap                hydrate all collections from Cosmos
 * - POST /api/collections/:key         upsert one item into a collection
 * - DELETE /api/collections/:key/:id   delete one item (?pk= when pk != id)
 * - POST /api/speech/tts               synthesize audio (audio/mpeg)
 * - POST /api/agents/:name/generate    run a Foundry agent (501 if not wired)
 *
 * Workflow state changes and publication are NOT done through the generic
 * collection endpoint — they go through the authoritative routes in
 * ./domainRoutes.ts, and this endpoint refuses to bypass those gates.
 */

import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import { cosmosEnabled, deleteItem, getItem, isKnownCollection, readAll, upsertItem } from './cosmos.js';
import { speechEnabled, synthesize, type TtsRequest } from './speech.js';
import { foundryEnabled, runAgent } from './foundry.js';
import { blobEnabled } from './blob.js';
import { transcribeEnabled } from './transcribe.js';
import { serviceBusEnabled } from './servicebus.js';
import { searchEnabled } from './search.js';
import { docIntelEnabled } from './docintel.js';
import { oneDriveEnabled } from './onedrive.js';
import { entraAuthEnabled } from './auth.js';
import { registerDomainRoutes } from './domainRoutes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({
    status: 'ok',
    time: new Date().toISOString(),
    auth: entraAuthEnabled() ? 'entra' : 'header',
    services: {
      cosmos: cosmosEnabled(),
      speech: speechEnabled(),
      transcription: transcribeEnabled(),
      blob: blobEnabled(),
      serviceBus: serviceBusEnabled(),
      search: searchEnabled(),
      documentIntelligence: docIntelEnabled(),
      foundry: foundryEnabled(),
      oneDrive: oneDriveEnabled(),
    },
  }));

  // Hydrate the SPA. Returns {} for collections when Cosmos is not configured so
  // the client transparently keeps its in-memory seed.
  app.get('/api/bootstrap', async (_req, reply) => {
    if (!cosmosEnabled()) {
      return { collections: {}, persistence: false };
    }
    try {
      const collections = await readAll();
      return { collections, persistence: true };
    } catch (err) {
      app.log.error({ err }, 'bootstrap read failed');
      return reply.code(200).send({ collections: {}, persistence: false });
    }
  });

  app.post<{ Params: { key: string }; Body: Record<string, unknown> }>(
    '/api/collections/:key',
    async (req, reply) => {
      const { key } = req.params;
      if (!isKnownCollection(key)) return reply.code(404).send({ error: `Unknown collection "${key}"` });
      if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });

      const item = req.body ?? {};
      const itemId = typeof item.id === 'string' ? item.id : undefined;

      // Integrity guards so the generic upsert cannot bypass the workflow gates.
      if (itemId) {
        // A project's workflow state may only change via /transition or /publish.
        if (key === 'projects' && typeof item.state === 'string') {
          const existing = (await getItem('projects', itemId)) as { state?: string } | undefined;
          if (existing && existing.state !== item.state) {
            return reply.code(409).send({
              error: 'Project state can only be changed via POST /api/projects/:id/transition (or /publish).',
            });
          }
        }
        // Publications are immutable once created (corrections create a new version).
        if (key === 'publications') {
          const existing = await getItem('publications', itemId, (item.projectId as string) ?? undefined);
          if (existing) {
            return reply.code(409).send({ error: 'Publications are immutable and cannot be overwritten.' });
          }
        }
      }

      try {
        const saved = await upsertItem(key, item);
        return reply.code(200).send(saved);
      } catch (err) {
        app.log.error({ err, key }, 'upsert failed');
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete<{ Params: { key: string; id: string }; Querystring: { pk?: string } }>(
    '/api/collections/:key/:id',
    async (req, reply) => {
      const { key, id } = req.params;
      if (!isKnownCollection(key)) return reply.code(404).send({ error: `Unknown collection "${key}"` });
      if (!cosmosEnabled()) return reply.code(503).send({ error: 'Persistence is not configured' });
      try {
        await deleteItem(key, id, req.query?.pk);
        return reply.code(204).send();
      } catch (err) {
        app.log.error({ err, key, id }, 'delete failed');
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{ Body: TtsRequest }>('/api/speech/tts', async (req, reply) => {
    if (!speechEnabled()) return reply.code(503).send({ error: 'Speech synthesis is not configured' });
    const body = req.body ?? {};
    if (!body.ssml && !body.text) return reply.code(400).send({ error: 'Provide "ssml" or "text"' });
    try {
      const { audio, contentType } = await synthesize(body);
      reply.header('Content-Type', contentType);
      reply.header('Cache-Control', 'no-store');
      return reply.send(audio);
    } catch (err) {
      req.log.error({ err }, 'tts failed');
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { name: string }; Body: { prompt?: string } }>(
    '/api/agents/:name/generate',
    async (req, reply) => {
      if (!foundryEnabled()) {
        return reply.code(501).send({
          error:
            'Foundry generation is not wired. Set FOUNDRY_PROJECT_ENDPOINT and grant the platform identity the Azure AI Developer role on the Foundry project.',
        });
      }
      const prompt = req.body?.prompt;
      if (!prompt) return reply.code(400).send({ error: 'Provide "prompt"' });
      try {
        const text = await runAgent(req.params.name, prompt);
        return reply.code(200).send({ agent: req.params.name, text });
      } catch (err) {
        req.log.error({ err }, 'agent run failed');
        return reply.code(502).send({ error: (err as Error).message });
      }
    },
  );

  app.log.info(
    { cosmos: cosmosEnabled(), speech: speechEnabled(), foundry: foundryEnabled(), db: config.cosmosDatabase },
    'domain API routes registered',
  );

  await registerDomainRoutes(app);
}
