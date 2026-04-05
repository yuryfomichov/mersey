export { createHarness } from './src/harness.js';
export type { CreateHarnessOptions, Harness } from './src/harness.js';

export { HarnessEventEmitter } from './src/events/emitter.js';
export { HarnessEventReporter } from './src/events/reporter.js';
export type { HarnessEvent, HarnessEventListener } from './src/events/types.js';
export type { HarnessEventSink } from './src/events/emitter.js';

export type {
  BeforeProviderCallContext,
  BeforeToolCallContext,
  HarnessPlugin,
  HookName,
  HookDecision,
  PluginEventContext,
} from './src/plugins/types.js';

export { createJsonlEventLoggingPlugin } from './plugins/logging/jsonl.js';
export type { JsonlEventLoggingPluginOptions } from './plugins/logging/jsonl.js';
export { createTextEventLoggingPlugin } from './plugins/logging/text.js';
export type { TextEventLoggingPluginOptions } from './plugins/logging/text.js';

export type { TurnChunk } from './src/core/loop.js';

export type { ModelProvider } from './src/models/provider.js';

export { parseProviderName } from './src/providers/factory.js';
export type { ProviderDefinition, ProviderName } from './src/providers/factory.js';

export { FilesystemSessionStore } from './src/sessions/filesystem-store.js';
export { MemorySessionStore } from './src/sessions/memory-store.js';
export { Session } from './src/sessions/session.js';
export type { Message, SessionState } from './src/sessions/types.js';
export type { SessionStore } from './src/sessions/store.js';

export { EditFileTool } from './src/tools/edit-file.js';
export { ReadFileTool } from './src/tools/read-file.js';
export { RunCommandTool } from './src/tools/run-command.js';
export type { RunCommandToolOptions } from './src/tools/run-command.js';
export { WriteFileTool } from './src/tools/write-file.js';
export type { ToolExecutionPolicy } from './src/tools/runtime/index.js';
export type { Tool } from './src/tools/types.js';
