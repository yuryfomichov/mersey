# Harness Guide

`harness` is the reusable runtime behind Mersey. It is responsible for running model turns, executing tools, persisting session state, and exposing events to the app layer.

## Public Entry Point

The main entry point is `createHarness()` from `harness/index.ts`.

Key exports include:

- `createHarness`
- `Session`, `MemorySessionStore`, `FilesystemSessionStore` from `harness/sessions/index.ts`
- provider-agnostic types like `ModelProvider`
- event and plugin types

Built-in tools are exported from `harness/tools/index.ts`.
Built-in providers are exported from `harness/providers/index.ts`.

## Minimal Example

This is the smallest useful setup for app code inside this repo.

```ts
import { createHarness } from '../harness/index.js';
import { FakeProvider } from '../harness/providers/index.js';
import { MemorySessionStore, Session } from '../harness/sessions/index.js';

const session = new Session({
  id: 'local-session',
  store: new MemorySessionStore(),
});

const harness = createHarness({
  providerInstance: new FakeProvider(),
  session,
});

const reply = await harness.sendMessage('hello');

console.log(reply.content);
```

## Main Concepts

### Provider

`harness` talks to models through the provider-agnostic `ModelProvider` interface.

That keeps the loop independent from provider SDK details. Provider-specific request and response mapping belongs in `harness/providers/`.

Apps construct provider instances outside core and pass them into `createHarness()`.

Example with an OpenAI provider:

```ts
import { createHarness } from '../harness/index.js';
import { OpenAIProvider } from '../harness/providers/index.js';
import { MemorySessionStore, Session } from '../harness/sessions/index.js';

const session = new Session({
  id: 'local-session',
  store: new MemorySessionStore(),
});

const harness = createHarness({
  providerInstance: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY!,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    maxTokens: 2048,
  }),
  session,
});
```

### Session

Each harness instance uses an injected `HarnessSession` to store:

- message history
- turn status
- aggregated usage metrics
- the last turn's token footprint

`createHarness()` does not construct sessions internally. Apps own session wiring and can choose a built-in or custom implementation.

```ts
import { createHarness } from '../harness/index.js';
import { FakeProvider } from '../harness/providers/index.js';
import { FilesystemSessionStore, Session } from '../harness/sessions/index.js';

const session = new Session({
  id: 'local-session',
  store: new FilesystemSessionStore({ rootDir: 'tmp/sessions' }),
});

const harness = createHarness({
  providerInstance: new FakeProvider(),
  session,
});

const usage = await harness.session.getUsage();
const lastTurnTokens = await harness.session.getContextSize();
```

### Tools

Tools are registered as tool instances.

- each tool supplies schema, description, and execution logic
- the harness runtime is responsible for executing tool calls during a turn

Example:

```ts
import { createHarness } from '../harness/index.js';
import { FakeProvider } from '../harness/providers/index.js';
import { EditFileTool, ReadFileTool, RunCommandTool, WriteFileTool } from '../harness/tools/index.js';
import { MemorySessionStore, Session } from '../harness/sessions/index.js';

const session = new Session({
  id: 'local-session',
  store: new MemorySessionStore(),
});

const harness = createHarness({
  providerInstance: new FakeProvider(),
  session,
  tools: [
    new ReadFileTool({ policy: { maxToolResultBytes: 16 * 1024, workspaceRoot: process.cwd() } }),
    new WriteFileTool({ policy: { maxToolResultBytes: 16 * 1024, workspaceRoot: process.cwd() } }),
    new EditFileTool({ policy: { maxToolResultBytes: 16 * 1024, workspaceRoot: process.cwd() } }),
    new RunCommandTool({
      commandAllowlist: ['git', 'ls', 'pwd'],
      defaultTimeoutMs: 5_000,
      maxOutputBytes: 16 * 1024,
      maxTimeoutMs: 15_000,
      policy: { maxToolResultBytes: 16 * 1024, workspaceRoot: process.cwd() },
    }),
  ],
});
```

Each tool owns its own runtime services and enforces workspace and output limits.

## Streaming

Apps that want incremental text output should consume `TurnChunk`s.

```ts
import { createHarness } from '../harness/index.js';
import { FakeProvider } from '../harness/providers/index.js';
import { MemorySessionStore, Session } from '../harness/sessions/index.js';

const session = new Session({
  id: 'local-session',
  store: new MemorySessionStore(),
});

const harness = createHarness({
  providerInstance: new FakeProvider(),
  session,
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

Chunk types come from `harness/runtime/core/loop.ts`:

- `assistant_delta`
- `assistant_message_completed`
- `final_message`

`harness/runtime/core/turn-stream.ts` handles session locking, abort behavior, loop execution, and persisting the resulting turn.

## Events And Logging

Apps can subscribe to structured events without depending on provider SDKs or raw tool output formats.

```ts
const unsubscribe = harness.subscribe((event) => {
  console.log(event.type, event.turnId);
});

unsubscribe();
```

The event stream includes turn lifecycle, provider calls, and tool execution. See `harness/runtime/events/types.ts` for the full event union.

The core harness is event-only. Logging is implemented through plugins that subscribe with `onEvent`.

```ts
import { createHarness } from '../harness/index.js';
import { FakeProvider } from '../harness/providers/index.js';
import { createJsonlEventLoggingPlugin, createTextEventLoggingPlugin } from '../harness/plugins/index.js';
import { MemorySessionStore, Session } from '../harness/sessions/index.js';

const session = new Session({
  id: 'local-session',
  store: new MemorySessionStore(),
});

const harness = createHarness({
  providerInstance: new FakeProvider(),
  plugins: [
    createJsonlEventLoggingPlugin({ path: 'logs/session.jsonl' }),
    createTextEventLoggingPlugin({ path: 'logs/session.log' }),
  ],
  session,
});
```

Under the hood, `HarnessEventEmitter` owns immutable publish/subscribe delivery and `HarnessEventReporter` owns typed event construction, turn/session IDs, timing, and sanitization.

## Request Preparation Hooks

`harness` supports a request-prep hook that can enrich the outbound `ModelRequest` just before each provider call.

- request-prep runs after `beforeProviderCall` allows the iteration
- injected context is ephemeral for that provider call only
- synthetic request messages are not persisted into session history
- hook contexts receive immutable snapshots rather than live session objects

This keeps retrieval or other request enrichment inside the runtime loop without pushing provider-specific logic into apps or providers.

```ts
const plugin = {
  name: 'request-prep',
  prepareProviderRequest(request, ctx) {
    return {
      prependMessages: [{ role: 'user', content: `Context for: ${ctx.userMessage.content}` }],
      systemPrompt: request.systemPrompt,
    };
  },
};
```

`prepareProviderRequest(request, ctx)` can return `prependMessages`, `appendMessages`, and `systemPrompt` overrides.

## Integration Boundaries

Keep the boundary between app code and `harness` sharp:

- app code should own UI and input collection
- app code should choose provider config, session storage, and tool registration
- app code can choose which request-prep plugins to register
- `harness` should own the turn loop, pause/resume semantics, tool execution, and session updates
- provider-specific codecs should stay in `harness/providers/codecs/`

In practice, `apps/cli/src/index.ts` is the best reference for a minimal terminal integration, while `apps/ftv/src/index.tsx` shows the same `harness` contract driving an Ink UI. Shared app-side setup lives in `apps/helpers/cli/`.
