import { freezeDeep } from '../utils/object.js';
import type { Message, SessionState } from './types.js';

function cloneMessage<T extends Message>(message: T): T {
  return structuredClone(message);
}

export function snapshotMessage<T extends Message>(message: T): T {
  return freezeDeep(cloneMessage(message));
}

export function snapshotMessages(messages: readonly Message[]): readonly Message[] {
  return freezeDeep(messages.map((message) => cloneMessage(message)));
}

export function snapshotSessionState(state: SessionState): SessionState {
  return freezeDeep({
    createdAt: state.createdAt,
    id: state.id,
    messages: state.messages.map((message) => cloneMessage(message)),
  });
}
