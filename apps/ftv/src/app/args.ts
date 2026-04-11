import type { ProviderName } from '../../../../harness/providers/types.js';
import { getBooleanFlag, getProviderName, getSessionId } from '../../../helpers/cli/args.js';
import {
  getSessionStoreDefinition,
  formatSessionStore,
  type SessionStoreDefinition,
} from '../../../helpers/cli/session-store.js';

export function parseArgs(): {
  cache: boolean;
  debug: boolean;
  providerName: ProviderName;
  sessionId: string;
  sessionStoreDefinition: SessionStoreDefinition;
  sessionStoreLabel: string;
} {
  const args = process.argv.slice(2);
  const sessionStoreDefinition = getSessionStoreDefinition(args);

  return {
    cache: getBooleanFlag(args, '--cache'),
    debug: getBooleanFlag(args, '--debug'),
    providerName: getProviderName(args, 'openai'),
    sessionId: getSessionId(args) ?? 'ftv-session',
    sessionStoreDefinition,
    sessionStoreLabel: formatSessionStore(sessionStoreDefinition),
  };
}
