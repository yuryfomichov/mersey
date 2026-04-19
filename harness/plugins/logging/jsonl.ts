import type { HarnessEvent } from '../../runtime/events/types.js';
import type { HarnessPlugin } from '../../runtime/plugins/types.js';
import { createQueuedLineWriter, type LoggingFileOptions } from './file.js';

export type JsonlEventLoggingPluginOptions = LoggingFileOptions & {
  name?: string;
};

export function createJsonlEventLoggingPlugin(options: JsonlEventLoggingPluginOptions): HarnessPlugin {
  const writeLine = createQueuedLineWriter({ path: options.path });

  return {
    name: options.name ?? 'jsonl-event-logger',
    onEvent(event: HarnessEvent): Promise<void> {
      return writeLine(`${JSON.stringify(event)}\n`);
    },
  };
}
