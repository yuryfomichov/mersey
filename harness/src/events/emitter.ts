import { snapshot } from '../utils/object.js';
import type { HarnessEvent, HarnessEventListener } from './types.js';

export type HarnessEventSink = Pick<HarnessEventEmitter, 'publish'>;

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidEventShape(event: HarnessEvent): boolean {
  if (!isString(event.type) || !isString(event.timestamp) || !isString(event.sessionId)) {
    return false;
  }

  if (event.type !== 'session_started' && !isString((event as { turnId?: unknown }).turnId)) {
    return false;
  }

  return true;
}

function shouldValidateEventShape(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export class HarnessEventEmitter {
  private readonly listeners = new Set<HarnessEventListener>();

  publish(event: HarnessEvent): void {
    if (shouldValidateEventShape() && !isValidEventShape(event)) {
      throw new Error('Invalid harness event payload.');
    }

    const eventSnapshot = snapshot(event);

    if (this.listeners.size === 0) {
      return;
    }

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
