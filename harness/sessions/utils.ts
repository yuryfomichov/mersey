import { basename, sep } from 'node:path';

export function assertValidSessionId(sessionId: string): void {
  if (!sessionId || sessionId === '.' || sessionId === '..') {
    throw new Error('Invalid session id.');
  }

  if (sessionId !== basename(sessionId) || sessionId.includes(sep)) {
    throw new Error('Invalid session id.');
  }
}
