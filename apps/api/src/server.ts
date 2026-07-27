import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { registerRoutes } from './routes.js';
import { registerAuth } from './auth.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Never log request/response bodies — they may carry review content.
      redact: ['req.headers.authorization'],
    },
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  // Opt-in Entra token validation (no-op unless AUTH_MODE=entra is configured).
  registerAuth(app);

  await registerRoutes(app);
  return app;
}
