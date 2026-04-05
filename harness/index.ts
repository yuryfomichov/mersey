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

export type { TurnChunk } from './src/core/loop.js';

export type { ModelProvider } from './src/models/provider.js';

export { parseProviderName } from './src/providers/factory.js';
export type { ProviderDefinition, ProviderName } from './src/providers/factory.js';

export { FilesystemSessionStore } from './src/sessions/filesystem-store.js';
export { MemorySessionStore } from './src/sessions/memory-store.js';
export { Session } from './src/sessions/session.js';
export type { Message, SessionState } from './src/sessions/types.js';
export type { SessionStore } from './src/sessions/store.js';
