/**
 * Background queue workers for the audio pipeline.
 *
 * Started from `server.ts` only when Service Bus is configured. Each worker
 * drains one queue and calls the shared `audioPipeline` core so the async path
 * produces byte-for-byte the same result as the synchronous HTTP routes.
 *
 * Failure policy: precondition failures (PipelineError) are terminal — the job
 * is marked `failed` and the message is completed so it is not redelivered.
 * Unexpected errors are rethrown so Service Bus can redeliver, then dead-letter.
 */

import type { FastifyBaseLogger } from 'fastify';
import { readByPartition, upsertItem } from './cosmos.js';
import type { Actor } from './actor.js';
import { renderEpisode, runPronunciationQaCore, PipelineError } from './audioPipeline.js';
import { enqueue, serviceBusEnabled, startWorker } from './servicebus.js';

interface SynthesisMessage {
  kind: 'synthesize';
  projectId: string;
  jobId: string;
  actor: Actor;
  voiceAssignments?: Record<string, string>;
  chainQa?: boolean;
}

interface QaMessage {
  kind: 'pronunciation-qa';
  projectId: string;
  actor: Actor;
}

function asActor(value: unknown): Actor {
  const a = (value ?? {}) as Partial<Actor>;
  return {
    id: String(a.id ?? 'worker'),
    displayName: String(a.displayName ?? 'Background worker'),
    roles: Array.isArray(a.roles) ? (a.roles as Actor['roles']) : (['Creator'] as Actor['roles']),
  };
}

async function markJobFailed(projectId: string, jobId: string, message: string): Promise<void> {
  const job = (await readByPartition('synthesisJobs', projectId)).find((j) => j.id === jobId);
  if (!job) return;
  await upsertItem('synthesisJobs', {
    ...job,
    status: 'failed',
    completedAt: new Date().toISOString(),
    logPath: message.slice(0, 500),
  });
}

export function startWorkers(log: FastifyBaseLogger): void {
  if (!serviceBusEnabled()) {
    log.info('service bus not configured — background workers disabled');
    return;
  }

  startWorker(
    'synthesis-jobs',
    async (body) => {
      const msg = body as SynthesisMessage;
      const actor = asActor(msg.actor);
      log.info({ jobId: msg.jobId, projectId: msg.projectId }, 'processing synthesis job');
      try {
        const overrides =
          msg.voiceAssignments && Object.keys(msg.voiceAssignments).length ? msg.voiceAssignments : undefined;
        await renderEpisode(msg.projectId, actor, msg.jobId, overrides);
      } catch (err) {
        if (err instanceof PipelineError) {
          await markJobFailed(msg.projectId, msg.jobId, err.message);
          log.error({ err, jobId: msg.jobId }, 'synthesis job failed (terminal)');
          return; // complete the message; do not redeliver a deterministic failure
        }
        throw err; // transient — let Service Bus redeliver
      }
      if (msg.chainQa) {
        await enqueue('qa-jobs', { kind: 'pronunciation-qa', projectId: msg.projectId, actor: msg.actor });
        log.info({ projectId: msg.projectId }, 'chained pronunciation-qa job enqueued');
      }
    },
    log,
  );

  startWorker(
    'qa-jobs',
    async (body) => {
      const msg = body as QaMessage;
      const actor = asActor(msg.actor);
      log.info({ projectId: msg.projectId }, 'processing pronunciation-qa job');
      try {
        await runPronunciationQaCore(msg.projectId, actor);
      } catch (err) {
        if (err instanceof PipelineError) {
          log.error({ err, projectId: msg.projectId }, 'pronunciation-qa job failed (terminal)');
          return;
        }
        throw err;
      }
    },
    log,
  );
}
