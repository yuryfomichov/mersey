import type { Session, SessionStatePatch, TurnStatus } from './types.js';

export function assertValidSessionId(sessionId: string): void {
  if (!sessionId || sessionId === '.' || sessionId === '..') {
    throw new Error('Invalid session id.');
  }

  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    throw new Error('Invalid session id.');
  }
}

export function applySessionStatePatch(session: Session, patch: SessionStatePatch): Session {
  if (patch.turnStatus !== undefined) {
    session.turnStatus = patch.turnStatus;
  }

  if (patch.currentTurnId !== undefined) {
    if (patch.currentTurnId === null) {
      delete session.currentTurnId;
    } else {
      session.currentTurnId = patch.currentTurnId;
    }
  }

  if (patch.pendingApproval !== undefined) {
    if (patch.pendingApproval === null) {
      delete session.pendingApproval;
    } else {
      session.pendingApproval = patch.pendingApproval;
    }
  }

  return session;
}

export function getTurnStatus(session: Session): TurnStatus {
  return session.turnStatus ?? 'idle';
}
