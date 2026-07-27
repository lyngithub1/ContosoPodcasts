import { buildServer } from './server.js';
import { config } from './config.js';
import { startWorkers } from './worker.js';
import { closeServiceBus } from './servicebus.js';

async function main(): Promise<void> {
  const app = await buildServer();
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error({ err }, 'failed to start');
    process.exit(1);
  }

  // Start background queue workers (no-op when Service Bus is not configured).
  try {
    startWorkers(app.log);
  } catch (err) {
    app.log.error({ err }, 'failed to start background workers');
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      app.log.info({ signal }, 'shutting down');
      void closeServiceBus()
        .catch(() => undefined)
        .then(() => app.close())
        .then(() => process.exit(0));
    });
  }
}

void main();
