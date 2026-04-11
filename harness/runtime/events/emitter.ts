import { snapshot } from '../utils/object.js';
import type { HarnessEvent, HarnessEventListener } from './types.js';

export type HarnessEventSink = Pick<HarnessEventEmitter, 'publish'>;

export class HarnessEventEmitter {
  private readonly listeners = new Set<HarnessEventListener>();

  publish(event: HarnessEvent): void {
    if (this.listeners.size === 0) {
      return;
    }

    const eventSnapshot = snapshot(event);

    for (const listener of this.listeners) {
      try {
        const result = listener(eventSnapshot);

        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).catch(() => {});
        }
      } catch {
        // Listener failures are best-effort and must never break event delivery.
      }
    }
  }

  subscribe(listener: HarnessEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }
}
