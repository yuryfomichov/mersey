import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createJsonlFileLogger, createTextFileLogger, type HarnessLogger } from '../../../harness/index.js';
import { assertValidSessionId } from '../../../harness/sessions.js';

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

export async function createCliLoggers(sessionId: string, cwd: string = process.cwd()): Promise<{
  logPaths: CliLogPaths;
  loggers: HarnessLogger[];
}> {
  const logPaths = getCliLogPaths(sessionId, cwd);

  await mkdir(logPaths.logsDir, { recursive: true });
  await Promise.all([
    writeFile(logPaths.jsonlPath, '', { flag: 'a' }),
    writeFile(logPaths.textPath, '', { flag: 'a' }),
  ]);

  return {
    logPaths,
    loggers: [createJsonlFileLogger({ path: logPaths.jsonlPath }), createTextFileLogger({ path: logPaths.textPath })],
  };
}
