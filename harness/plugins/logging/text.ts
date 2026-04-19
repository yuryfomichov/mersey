import type { HarnessEvent } from '../../runtime/events/types.js';
import type { HarnessPlugin } from '../../runtime/plugins/types.js';
import { createQueuedLineWriter, type LoggingFileOptions } from './file.js';
import { toEventTextLine } from './utils.js';

export type TextEventLoggingPluginOptions = LoggingFileOptions & {
  name?: string;
};

export function createTextEventLoggingPlugin(options: TextEventLoggingPluginOptions): HarnessPlugin {
  const writeLine = createQueuedLineWriter({ path: options.path });

  return {
    name: options.name ?? 'text-event-logger',
    onEvent(event: HarnessEvent): Promise<void> {
      return writeLine(`${toEventTextLine(event)}\n`);
    },
  };
}
