import { join } from 'node:path';

import { FilesystemSessionStore, MemorySessionStore, type SessionStore } from '../../../harness/sessions.js';

export type SessionStoreDefinition =
  | {
      kind: 'memory';
    }
  | {
      kind: 'filesystem';
      rootDir: string;
    };

function getArgValue(args: string[], name: string): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === name) {
      const value = args[index + 1];

      if (!value) {
        throw new Error(`Missing value for ${name}.`);
      }

      return value;
    }

    if (arg.startsWith(`${name}=`)) {
      return arg.slice(`${name}=`.length);
    }
  }

  return null;
}

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
