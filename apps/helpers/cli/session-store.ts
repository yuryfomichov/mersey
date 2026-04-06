import { join } from 'node:path';

import { FilesystemSessionStore, MemorySessionStore, Session } from '../../../harness/index.js';
import type { SessionStore } from '../../../harness/types.js';
import { getArgValue } from './args.js';

export type SessionStoreDefinition =
  | {
      kind: 'memory';
    }
  | {
      kind: 'filesystem';
      rootDir: string;
    };

export function createSessionStore(definition: SessionStoreDefinition): SessionStore {
  switch (definition.kind) {
    case 'memory':
      return new MemorySessionStore();
    case 'filesystem':
      return new FilesystemSessionStore({
        rootDir: definition.rootDir,
      });
    default:
      throw new Error('Unsupported session store definition.');
  }
}

export function createSession(definition: SessionStoreDefinition, sessionId: string): Session {
  return new Session({
    id: sessionId,
    store: createSessionStore(definition),
  });
}

export function formatSessionStore(definition: SessionStoreDefinition): string {
  switch (definition.kind) {
    case 'memory':
      return 'session store: memory';
    case 'filesystem':
      return `session store: filesystem (${definition.rootDir})`;
    default:
      throw new Error('Unsupported session store definition.');
  }
}

export function getSessionStoreDefinition(args: string[]): SessionStoreDefinition {
  const kind = getArgValue(args, '--session-store') ?? 'memory';

  if (kind !== 'memory' && kind !== 'filesystem') {
    throw new Error(`Unsupported session store: ${kind}`);
  }

  if (kind === 'memory') {
    return {
      kind,
    };
  }

  return {
    kind,
    rootDir: getArgValue(args, '--sessions-dir') ?? join(process.cwd(), 'tmp', 'sessions'),
  };
}
