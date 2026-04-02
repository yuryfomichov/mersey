import { snapshot } from '../utils/object.js';
import type { HarnessEvent, HarnessEventListener } from './types.js';

export type HarnessEventPublisherOptions = {
  onEventPublished?: (event: HarnessEvent) => unknown;
  onListenerFailed?: (event: HarnessEvent) => unknown;
};

export type HarnessEventSink = Pick<HarnessEventPublisher, 'publish'>;

export class HarnessEventPublisher {
  private readonly listeners = new Set<HarnessEventListener>();
  private readonly onEventPublished: ((event: HarnessEvent) => unknown) | undefined;
  private readonly onListenerFailed: ((event: HarnessEvent) => unknown) | undefined;

  constructor({ onEventPublished, onListenerFailed }: HarnessEventPublisherOptions = {}) {
    this.onEventPublished = onEventPublished;
    this.onListenerFailed = onListenerFailed;
  }

  publish(event: HarnessEvent): void {
    const eventSnapshot = snapshot(event);

    this.invokeHook(this.onEventPublished, eventSnapshot);

    if (this.listeners.size === 0) {
      return;
    }

    for (const listener of this.listeners) {
      try {
        const result = listener(eventSnapshot);

        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).catch(() => {
            this.invokeHook(this.onListenerFailed, eventSnapshot);
          });
        }
      } catch {
        this.invokeHook(this.onListenerFailed, eventSnapshot);
      }
    }
  }

  subscribe(listener: HarnessEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private invokeHook(hook: ((event: HarnessEvent) => unknown) | undefined, event: HarnessEvent): void {
    if (!hook) {
      return;
    }

    try {
      const result = hook(event);

      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
      }
    } catch {
      // Hook failures are best-effort and must never break event delivery.
    }
  }
}
