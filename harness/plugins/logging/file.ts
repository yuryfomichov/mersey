import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type LoggingFileOptions = {
  path: string;
};

export function createQueuedLineWriter(options: LoggingFileOptions): (line: string) => Promise<void> {
  let pendingWrite = Promise.resolve();

  return (line: string): Promise<void> => {
    const write = pendingWrite.then(async () => {
      await mkdir(dirname(options.path), { recursive: true });
      await appendFile(options.path, line, 'utf8');
    });

    pendingWrite = write.catch(() => {});

    return write;
  };
}
