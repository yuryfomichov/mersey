import { freezeDeep } from '../utils/object.js';
import type { TurnChunk } from './loop.js';

export function snapshotTurnChunk(chunk: TurnChunk): TurnChunk {
  return freezeDeep(structuredClone(chunk));
}
