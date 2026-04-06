import { render } from 'ink';
import React from 'react';

import { parseArgs } from './app/args.js';
import { FtvApp } from './app/ftv-app.js';

const { cache, debug, providerName, sessionId, sessionStoreDefinition, sessionStoreLabel } = parseArgs();

render(
  <FtvApp
    cache={cache}
    debug={debug}
    providerName={providerName}
    sessionId={sessionId}
    sessionStoreDefinition={sessionStoreDefinition}
    sessionStoreLabel={sessionStoreLabel}
  />,
);
