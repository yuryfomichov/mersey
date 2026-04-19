# Harness Guide

`harness` is the reusable runtime behind Mersey. It is responsible for running model turns, executing tools, persisting session state, and exposing events to the app layer.

## Public Entry Point

The main entry point is `createHarness()` from `harness/index.ts`.

Key exports include:

- `createHarness`
- built-in sessions from `harness/sessions/index.ts`
- built-in tools from `harness/tools/index.ts`
- logging, memory, and retrieval plugins from `harness/plugins/index.ts`
- provider-agnostic types like `ModelProvider`
- event and plugin types

`harness/index.ts` stays focused on `createHarness()` and shared types, while built-in implementations remain available from their own submodules such as `harness/providers/index.ts`.

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

Each harness instance uses an injected `HarnessSession` internally, and exposes a read-only `harness.session` view for:

- message history
- turn status
- aggregated usage metrics
- the last turn's token footprint

`createHarness()` does not construct sessions internally. Apps own session wiring and can choose a built-in or custom implementation.
Built-in stores expose atomic turn commits and serialize work per session id.

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

// The app-facing session view is read-only.
console.log(harness.session.id, harness.session.messages.length);
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
Custom tools can depend on the public `ToolExecutionContext`, `ToolFileService`, and `ToolOutputService` types from `harness/tools/types.ts`.

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

Both `sendMessage()` and `streamMessage()` accept `{ signal }` so callers can cancel a turn explicitly.

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

When debug mode is enabled for a harness, `provider_requested` events also include the final request payload that will be sent to the model, so logging plugins can record the exact system prompt and messages after request-prep hooks run.

The core harness is event-only. Logging is implemented through plugins that subscribe with `onEvent`.
Built-in logging plugins create parent directories on demand and surface write failures through the normal hook error path.

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

`harness` supports a request-prep hook that can enrich the outbound provider request just before each provider call.

- request-prep runs before `beforeProviderCall`, so policy hooks validate the final prepared request
- injected context is ephemeral for that provider call only
- synthetic request messages are not persisted into session history
- hook contexts receive immutable, request-prep-safe snapshots rather than live session objects

This keeps retrieval or other request enrichment inside the runtime loop without pushing provider-specific logic into apps or providers.

The generic retrieval contract lives under `harness/plugins/retrieval/`. Concrete backends, such as the built-in LanceDB integration, live under backend-specific submodules like `harness/plugins/retrieval/lancedb/`.

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

`prepareProviderRequest(request, ctx)` receives an immutable provider-request snapshot plus a simplified immutable transcript, and can return `prependMessages`, `appendMessages`, `messages`, and `systemPrompt` overrides.

## Memory Plugins

`harness` also supports a generic memory plugin shape for external memory systems.

- `recall(query, ctx)` runs before the first provider call in a turn
- recalled memory is injected ephemerally and is not persisted into session history
- `remember(ctx)` runs after the turn commit succeeds
- `remember(ctx)` runs after commit in the background, so an immediate follow-up turn may not see freshly written memory yet
- memory stays backend-agnostic and separate from session storage

The generic memory contract lives under `harness/plugins/memory/`.

```ts
import { createMemoryPlugin } from '../harness/plugins/index.js';

const plugin = createMemoryPlugin({
  async recall(query) {
    return [{ id: 'pref-1', content: `Stored memory for: ${query}` }];
  },
  async remember(ctx) {
    const finalAssistantMessage = ctx.turnMessages.at(-1);

    if (finalAssistantMessage?.role === 'assistant') {
      // Persist useful information to your memory backend.
    }
  },
});
```

`swallowRecallErrors` defaults to `true`, so recall is best-effort by default. Swallowed recall failures are intentionally silent in v1; formatter failures still throw. If you need logger-visible recall failures, disable swallowing and let the normal `hook_error` event path handle them.

## Integration Boundaries

Keep the boundary between app code and `harness` sharp:

- app code should own UI and input collection
- app code should choose provider config, session storage, and tool registration
- app code can choose which request-prep plugins to register
- `harness` should own the turn loop, pause/resume semantics, tool execution, and session updates
- provider-specific codecs should stay in `harness/providers/codecs/`

In practice, `apps/cli/src/index.ts` is the best reference for a minimal terminal integration, while `apps/ftv/src/index.tsx` shows the same `harness` contract driving an Ink UI. Shared app-side setup lives in `apps/helpers/cli/`.
