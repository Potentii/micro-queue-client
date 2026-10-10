export type EQueueDeduplicationMode = 'PAYLOAD_HASH' | 'MANUAL' | 'AUTO' | 'NONE';

export interface QueueUpsertConfig {
  id: string;
  visibilityTimeout: number;
  retentionTime: number | null;
  maxReceiveCount: number | null;
  redriveQueueId: string | null;
  deduplicationMode: EQueueDeduplicationMode;
}

export type QueueUpsertResult = QueueUpsertConfig;

export type HeadersRecord = Record<string, string>;

export type Message = {
  id: string;
  payload: string;
  headers: HeadersRecord | null;
};

export type MessageConsumer = (
  payload: string,
  headers: HeadersRecord | null | undefined,
  ack: () => Promise<void>
) => void | Promise<void>;

export type MessageErrorHandler = (
  queueId: string,
  payload: string,
  headers: HeadersRecord | null | undefined,
  error: Error
) => void | Promise<void>;

export interface MicroQueueClientOptions {
  /** Base URL of the micro-queue service (no trailing slash). */
  url: string;
  /** Long-poll timeout in milliseconds per request. */
  pollingTimeout?: number | null;
  /** Max number of messages to request per poll. */
  maxItemsPerPolling?: number | null;
  /** If a listener resolves without calling `ack`, auto-ack the message. */
  autoAck?: boolean | null;
}

export default class MicroQueueClient {
  constructor(opts: MicroQueueClientOptions);

  /** Upsert (create or update) a queue by id. */
  upsertQueue(queueConfig: QueueUpsertConfig): Promise<QueueUpsertResult>;

  /** Post a message to a queue. */
  postMessage(
    queueId: string,
    payload: string,
    headers?: HeadersRecord
  ): Promise<{ id: string }>;

  /**
   * Registers a listener for messages on a queue and start polling.
   * Returns an unsubscribe function.
   */
  onMessage(queueId: string, listener: MessageConsumer): () => void;

  /** Registers a message error handler. */
  onError(handler: MessageErrorHandler): void;

  /** Remove a previously registered listener for a queue. */
  offMessage(queueId: string): void;

  /** Stop all polling loops. */
  stop(): void;

  /** Allow polling loops to run again. Existing queues with listeners will resume automatically. */
  start(): void;
}
