import { appendFile } from 'node:fs/promises';

export type LoggingFileOptions = {
  path: string;
};

export function createQueuedLineWriter(options: LoggingFileOptions): (line: string) => Promise<void> {
  let pendingWrite = Promise.resolve();

  return (line: string): Promise<void> => {
    const write = pendingWrite.then(() => appendFile(options.path, line, 'utf8'));

    pendingWrite = write.catch(() => {});

    return write;
  };
}
