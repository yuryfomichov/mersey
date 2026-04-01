import type { Session } from './types.js';
import type { SessionStore } from './store.js';

export type EnsureSessionOptions = {
  session: Session;
  sessionStore: SessionStore;
};

export async function ensureSession({ session, sessionStore }: EnsureSessionOptions): Promise<void> {
  const existingSession = await sessionStore.getSession(session.id);

  if (existingSession) {
    session.createdAt = existingSession.createdAt;
    session.messages = existingSession.messages;
    return;
  }

  const createdSession = await sessionStore.createSession(session);

  session.createdAt = createdSession.createdAt;
  session.messages = createdSession.messages;
}
