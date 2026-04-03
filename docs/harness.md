# Harness Guide

`harness` is the reusable runtime behind Mersey. It is responsible for running model turns, executing tools, persisting session state, and exposing events to the app layer.

## Public Entry Point

The main entry point is `createHarness()` from `harness/index.ts`.

Key exports include:

- `createHarness`
- `Session`, `MemorySessionStore`, `FilesystemSessionStore`
- provider types like `ProviderDefinition`, `ProviderName`, and `ModelProvider`
- built-in tools like `ReadFileTool`, `WriteFileTool`, `EditFileTool`, `RunCommandTool`
- event and logger types

## Minimal Example

This is the smallest useful setup for app code inside this repo.

```ts
import { createHarness } from '../harness/index.js';

const harness = createHarness({
  provider: { name: 'fake' },
});

const reply = await harness.sendMessage('hello');

console.log(reply.content);
```

## Main Concepts

### Provider

`harness` talks to models through the provider-agnostic `ModelProvider` interface.

That keeps the loop independent from provider SDK details. Provider-specific request and response mapping belongs in `harness/src/providers/`.

You can pass either:

- `providerInstance` when the app constructs a provider itself
- `provider` when the app wants `createHarness()` to instantiate from a provider definition

Example with a provider definition:

```ts
import { createHarness } from '../harness/index.js';

const harness = createHarness({
  provider: {
    name: 'openai',
    config: {
      apiKey: process.env.OPENAI_API_KEY!,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4-mini',
      maxTokens: 2048,
    },
  },
});
```

### Session

Each harness instance uses a `Session` to store:

- message history
- turn status

The default session uses in-memory storage. Apps can inject a persistent store when they need history to survive process restarts.

```ts
import { createHarness, FilesystemSessionStore, Session } from '../harness/index.js';

const session = new Session({
  id: 'local-session',
  store: new FilesystemSessionStore({ rootDir: 'tmp/sessions' }),
});

const harness = createHarness({
  provider: { name: 'fake' },
  session,
});
```

### Tools

Tools are registered as tool instances.

- each tool supplies schema, description, and execution logic
- the harness runtime is responsible for executing tool calls during a turn

Example:

```ts
import { createHarness, EditFileTool, ReadFileTool, RunCommandTool, WriteFileTool } from '../harness/index.js';

const harness = createHarness({
  provider: { name: 'fake' },
  toolExecutionPolicy: {
    maxToolResultBytes: 16 * 1024,
    workspaceRoot: process.cwd(),
  },
  tools: [
    new ReadFileTool(),
    new WriteFileTool(),
    new EditFileTool(),
    new RunCommandTool({
      commandAllowlist: ['git', 'ls', 'pwd'],
      defaultTimeoutMs: 5_000,
      maxOutputBytes: 16 * 1024,
      maxTimeoutMs: 15_000,
    }),
  ],
});
```

The tool runtime enforces workspace and output limits through `harness/src/tools/runtime/`.

## Streaming

Apps that want incremental text output should consume `TurnChunk`s.

```ts
const harness = createHarness({
  provider: { name: 'fake' },
});

for await (const chunk of harness.streamMessage('hello')) {
  if (chunk.type === 'assistant_delta') {
    process.stdout.write(chunk.delta);
  }

  if (chunk.type === 'final_message') {
    process.stdout.write(`\nfinal: ${chunk.message.content}\n`);
  }
}
```

Chunk types come from `harness/src/loop/loop.ts`:

- `assistant_delta`
- `assistant_message_completed`
- `final_message`

`harness/src/turn-stream.ts` handles session locking, abort behavior, loop execution, and persisting the resulting turn.

## Events And Logging

Apps can subscribe to structured events without depending on provider SDKs or raw tool output formats.

```ts
const unsubscribe = harness.subscribe((event) => {
  console.log(event.type, event.turnId);
});

unsubscribe();
```

The event stream includes turn lifecycle, provider calls, and tool execution. See `harness/src/events/types.ts` for the full event union.

`createHarness()` also accepts `loggers`, which receive runtime traces. This is how the CLI writes structured and text logs for each session.

## Integration Boundaries

Keep the boundary between app code and `harness` sharp:

- app code should own UI and input collection
- app code should choose provider config, session storage, and tool registration
- `harness` should own the turn loop, pause/resume semantics, tool execution, and session updates
- provider-specific codecs should stay in `harness/src/providers/codecs/`

In practice, `apps/cli/src/index.ts` is the best reference integration in this repo.
