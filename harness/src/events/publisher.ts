import { freezeDeep } from '../utils/object.js';
import type { HarnessEvent, HarnessEventListener } from './types.js';

export type HarnessEventPublisherOptions = {
  onEventPublished?: (event: HarnessEvent) => void;
  onListenerFailed?: (event: HarnessEvent) => void;
};

export type HarnessEventSink = Pick<HarnessEventPublisher, 'publish'>;

export class HarnessEventPublisher {
  private readonly listeners = new Set<HarnessEventListener>();
  private readonly onEventPublished: ((event: HarnessEvent) => void) | undefined;
  private readonly onListenerFailed: ((event: HarnessEvent) => void) | undefined;

  constructor({ onEventPublished, onListenerFailed }: HarnessEventPublisherOptions = {}) {
    this.onEventPublished = onEventPublished;
    this.onListenerFailed = onListenerFailed;
  }

  publish(event: HarnessEvent): void {
    this.onEventPublished?.(event);

    if (this.listeners.size === 0) {
      return;
    }

    const snapshot = this.snapshot(event);

    for (const listener of this.listeners) {
      try {
        const result = listener(snapshot);

        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).catch(() => {
            this.onListenerFailed?.(snapshot);
          });
        }
      } catch {
        this.onListenerFailed?.(snapshot);
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
