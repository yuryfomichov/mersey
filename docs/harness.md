# Harness Guide

`harness` is the reusable runtime behind Mersey. It owns startup diagnostics, turn execution, tool execution, session persistence, event emission, turn context collection, and post-commit observers.

## Public Entry Point

The canonical app entry point is `createHarnessRuntime()` from `harness/index.ts`.

Key exports include:

- `createHarnessRuntime`
- low-level `createHarness` for focused tests and internal assembly
- built-in sessions from `harness/sessions/index.ts`
- built-in tools from `harness/tools/index.ts`
- logging, memory, and retrieval helpers from `harness/plugins/index.ts`
- provider-agnostic runtime, tool, collector, observer, and event types

`createHarnessRuntime()` returns structured startup information on both success and failure paths.

```ts
import { createHarnessRuntime } from '../harness/index.js';
import { FakeProvider } from '../harness/providers/index.js';
import { MemorySessionStore, Session } from '../harness/sessions/index.js';

const result = await createHarnessRuntime({
  providerInstance: new FakeProvider(),
  session: new Session({
    id: 'local-session',
    store: new MemorySessionStore(),
  }),
});

if (!result.ok) {
  throw new Error(result.startup.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
}

const { harness, startup } = result.runtime;
console.log(startup.status);
console.log(await harness.sendMessage('hello'));
```

## Main Concepts

### Provider

`harness` talks to models through the provider-agnostic `ModelProvider` interface. Apps construct provider instances outside core and inject them into `createHarnessRuntime()`.

### Session

Apps own session storage selection. `createHarnessRuntime()` receives an injected `HarnessSession` and exposes a read-only `harness.session` view for messages, usage, and context size.

### Tool Catalogs

The runtime talks to immutable per-turn tool snapshots through `ToolCatalog`.

- tool routing resolves raw model calls into durable `toolId`-based identities
- session-visible tool results persist canonical structured `parts`
- built-in local tools keep backend-agnostic internal names such as `workspace.read_file`, but expose provider-safe public names such as `workspace_read_file`

Passing `tools` into `createHarnessRuntime()` creates a static local tool catalog automatically.

```ts
import { createHarnessRuntime } from '../harness/index.js';
import { FakeProvider } from '../harness/providers/index.js';
import { MemorySessionStore, Session } from '../harness/sessions/index.js';
import { ReadFileTool } from '../harness/tools/index.js';

const result = await createHarnessRuntime({
  providerInstance: new FakeProvider(),
  session: new Session({ id: 'local-session', store: new MemorySessionStore() }),
  tools: [new ReadFileTool({ policy: { workspaceRoot: process.cwd() } })],
});
```

### Turn Context Collectors

Ephemeral context such as retrieval results or memory recall is collected through `TurnContextCollector` registrations.

- collectors are runtime-owned
- collectors run before provider execution
- collected context is normalized and injected without being persisted into session history

### Turn Commit Observers

Post-turn side effects such as memory write-back run through `TurnCommitObserver` registrations.

- observers run only after commit succeeds
- observer failures are visible through normal runtime events
- observer work is runtime-owned and drained by `HarnessRuntime.dispose()`

### Plugins And Events

Plugins now cover policy hooks and event listeners.

- `beforeProviderCall`
- `beforeToolExecution`
- `onEvent`

Logging plugins subscribe through `onEvent`, and app-specific approval flows can block resolved tool execution through `beforeToolExecution`.

## Streaming

Use `harness.sendMessage()` for one-shot replies or `harness.streamMessage()` for incremental output.

```ts
for await (const chunk of harness.streamMessage('hello')) {
  if (chunk.type === 'assistant_delta') {
    process.stdout.write(chunk.delta);
  }

  if (chunk.type === 'final_message') {
    console.log(chunk.message.content);
  }
}
```

## Startup And Disposal

`createHarnessRuntime()` centralizes startup validation and lifecycle ownership.

- required source startup failures return `{ ok: false, startup }`
- optional source failures return `{ ok: true, runtime }` with `runtime.startup.status === 'degraded'`
- apps can surface `runtime.startup` diagnostics as user-visible startup warnings without changing runtime control flow
- `runtime.dispose()` aborts runtime-owned work and drains background observers cleanly

## Low-Level Assembly

`createHarness()` remains available for internal runtime assembly and focused tests. Apps should prefer `createHarnessRuntime()`.
