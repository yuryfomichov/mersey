import { freezeDeep } from '../utils/object.js';
import type { HarnessEvent } from './types.js';

export function snapshotEvent(event: HarnessEvent): HarnessEvent {
  return freezeDeep(structuredClone(event));
}
