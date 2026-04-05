import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createJsonlEventLoggingPlugin,
  createTextEventLoggingPlugin,
  type HarnessPlugin,
} from '../../../harness/index.js';

function assertValidSessionId(sessionId: string): void {
  if (!sessionId || sessionId === '.' || sessionId === '..') {
    throw new Error('Invalid session id.');
  }

  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    throw new Error('Invalid session id.');
  }
}

export type CliLogPaths = {
  jsonlPath: string;
  logsDir: string;
  textPath: string;
};

export function getCliLogPaths(sessionId: string, cwd: string = process.cwd()): CliLogPaths {
  assertValidSessionId(sessionId);

  const logsDir = join(cwd, 'logs');

  return {
    jsonlPath: join(logsDir, `${sessionId}.jsonl`),
    logsDir,
    textPath: join(logsDir, `${sessionId}.log`),
  };
}

export async function createCliLoggingPlugins(
  sessionId: string,
  cwd: string = process.cwd(),
): Promise<{
  logPaths: CliLogPaths;
  plugins: HarnessPlugin[];
}> {
  const logPaths = getCliLogPaths(sessionId, cwd);

  await mkdir(logPaths.logsDir, { recursive: true });
  await Promise.all([
    writeFile(logPaths.jsonlPath, '', { flag: 'a' }),
    writeFile(logPaths.textPath, '', { flag: 'a' }),
  ]);

  return {
    logPaths,
    plugins: [
      createJsonlEventLoggingPlugin({ path: logPaths.jsonlPath }),
      createTextEventLoggingPlugin({ path: logPaths.textPath }),
    ],
  };
}
