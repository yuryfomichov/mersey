export function assertValidSessionId(sessionId: string): void {
  if (!sessionId || sessionId === '.' || sessionId === '..') {
    throw new Error('Invalid session id.');
  }

  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    throw new Error('Invalid session id.');
  }
}
