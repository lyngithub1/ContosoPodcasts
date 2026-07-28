/**
 * Azure Service Bus adapter — background job queue for the audio pipeline.
 *
 * The API can either do synthesis / QA inline (the synchronous routes) or hand
 * the work to a background worker by enqueuing a message here. A worker running
 * in the same container drains the queue with a message pump and calls the same
 * `audioPipeline` core functions. This is honest queue-based processing — NOT a
 * durable-orchestration runtime (there is no Durable Functions / workflow host
 * on Container Apps); the SynthesisJob document is the durable record of state.
 *
 * Auth uses the platform managed identity (no connection strings / SAS keys).
 */

import {
  ServiceBusClient,
  type ServiceBusMessage,
  type ServiceBusReceivedMessage,
  type ServiceBusReceiver,
} from '@azure/service-bus';
import { credential } from './azure.js';
import { config } from './config.js';

export function serviceBusEnabled(): boolean {
  return Boolean(config.serviceBusFqdn);
}

let client: ServiceBusClient | undefined;

function sbClient(): ServiceBusClient {
  if (!config.serviceBusFqdn) throw new Error('SERVICEBUS_FQDN is not configured');
  if (!client) client = new ServiceBusClient(config.serviceBusFqdn, credential());
  return client;
}

/** Publish a JSON message to a queue. */
export async function enqueue(queue: string, body: unknown): Promise<void> {
  const sender = sbClient().createSender(queue);
  try {
    const message: ServiceBusMessage = { body, contentType: 'application/json' };
    await sender.sendMessages(message);
  } finally {
    await sender.close();
  }
}

export type QueueHandler = (body: unknown, raw: ServiceBusReceivedMessage) => Promise<void>;

const receivers: ServiceBusReceiver[] = [];

/**
 * Start a message-pump worker on a queue. Successfully handled messages are
 * completed (removed); handler errors abandon the message so Service Bus can
 * redeliver up to the queue's max-delivery-count, then dead-letter it.
 */
export function startWorker(
  queue: string,
  handler: QueueHandler,
  log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void },
): void {
  const receiver = sbClient().createReceiver(queue, {
    receiveMode: 'peekLock',
    // A full-length episode is synthesized inside processMessage. Premium
    // "Dragon HD" voices run roughly 10x slower than standard neural ones, so a
    // 20-minute episode takes ~3 minutes of wall clock — close to the SDK's
    // 5-minute default. If the lock lapses mid-render Service Bus redelivers the
    // message and the in-flight work is wasted. 30 minutes gives long episodes
    // ample headroom.
    maxAutoLockRenewalDurationInMs: 30 * 60 * 1000,
  });
  receivers.push(receiver);
  receiver.subscribe(
    {
      async processMessage(message) {
        try {
          await handler(message.body, message);
          await receiver.completeMessage(message);
        } catch (err) {
          log.error({ err, queue, messageId: message.messageId }, 'queue handler failed; abandoning message');
          await receiver.abandonMessage(message);
        }
      },
      async processError(args) {
        log.error({ err: args.error, queue, source: args.errorSource }, 'service bus receiver error');
      },
    },
    {
      maxConcurrentCalls: 1,
      autoCompleteMessages: false,
    },
  );
  log.info({ queue }, 'service bus worker started');
}

/** Close all receivers and the client (graceful shutdown). */
export async function closeServiceBus(): Promise<void> {
  await Promise.allSettled(receivers.map((r) => r.close()));
  receivers.length = 0;
  if (client) {
    await client.close();
    client = undefined;
  }
}
