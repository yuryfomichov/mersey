import { emitRuntimeTrace } from '../logger/runtime-trace.js';
import type { HarnessLogger } from '../logger/types.js';
import { freezeDeep } from '../utils/object.js';
import type { HarnessEvent, HarnessEventListener } from './types.js';

export type HarnessEventPublisherOptions = {
  logger?: HarnessLogger;
};

export type HarnessEventSink = Pick<HarnessEventPublisher, 'publish'>;

export class HarnessEventPublisher {
  private readonly listeners = new Set<HarnessEventListener>();
  private readonly logger: HarnessLogger | undefined;

  constructor({ logger }: HarnessEventPublisherOptions = {}) {
    this.logger = logger;
  }

  publish(event: HarnessEvent): void {
    emitRuntimeTrace(this.logger, 'event_emitted', {
      eventType: event.type,
      sessionId: event.sessionId,
      turnId: event.turnId,
    });

    if (this.listeners.size === 0) {
      return;
    }

    const snapshot = this.snapshot(event);

    for (const listener of this.listeners) {
      try {
        const result = listener(snapshot);

        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).catch(() => {
            emitRuntimeTrace(this.logger, 'listener_failed', {
              eventType: snapshot.type,
            });
          });
        }
      } catch {
        emitRuntimeTrace(this.logger, 'listener_failed', {
          eventType: snapshot.type,
        });
      }
    }
  }

  subscribe(listener: HarnessEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private snapshot(event: HarnessEvent): HarnessEvent {
    return freezeDeep(structuredClone(event));
  }
}
