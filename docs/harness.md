# Harness Guide

`harness` is the reusable runtime behind Mersey. It is responsible for running model turns, pausing for approval, executing tools, persisting session state, and exposing events to the app layer.

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

await harness.ready();

const reply = await harness.sendUserMessage('hello');

console.log(reply.content);
```

`ready()` ensures the session is loaded before the app starts using it.

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
- pending approval state
- turn status

The default session uses in-memory storage. Apps can inject a persistent store when they need history or approval state to survive process restarts.

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

Tools are registered as `{ tool, policy }` pairs.

- the tool supplies schema, description, and execution logic
- the policy tells the loop whether tool calls can execute automatically or must wait for approval

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
    { policy: { action: 'require_approval', type: 'fixed' }, tool: new ReadFileTool() },
    { policy: { action: 'require_approval', type: 'fixed' }, tool: new WriteFileTool() },
    { policy: { action: 'require_approval', type: 'fixed' }, tool: new EditFileTool() },
    {
      policy: { action: 'require_approval', type: 'fixed' },
      tool: new RunCommandTool({
        commandAllowlist: ['git', 'ls', 'pwd'],
        defaultTimeoutMs: 5_000,
        maxOutputBytes: 16 * 1024,
        maxTimeoutMs: 15_000,
      }),
    },
  ],
});
```

The tool runtime enforces workspace and output limits through `harness/src/tools/runtime/`.

### Approval Flow

When a turn reaches a tool call that requires approval, `harness` pauses the turn and stores the pending approval in the session.

Apps have two integration styles:

1. Provide an `approvalHandler` and let `harness` call it automatically.
2. Omit `approvalHandler`, catch `ApprovalRequiredError`, and handle approval in app code.

Automatic approval handling, which is what the CLI uses:

```ts
import { createHarness, ReadFileTool, type ApprovalDecision, type PendingApproval } from '../harness/index.js';

async function promptForApproval(pendingApproval: PendingApproval): Promise<ApprovalDecision[]> {
  return pendingApproval.requiredToolCallIds.map((toolCallId) => ({
    toolCallId,
    type: 'approve',
  }));
}

const harness = createHarness({
  approvalHandler: promptForApproval,
  provider: { name: 'fake' },
  toolExecutionPolicy: { workspaceRoot: process.cwd() },
  tools: [{ policy: { action: 'require_approval', type: 'fixed' }, tool: new ReadFileTool() }],
});
```

Manual approval handling:

```ts
import { ApprovalRequiredError, createHarness, ReadFileTool } from '../harness/index.js';

const harness = createHarness({
  provider: { name: 'fake' },
  toolExecutionPolicy: { workspaceRoot: process.cwd() },
  tools: [{ policy: { action: 'require_approval', type: 'fixed' }, tool: new ReadFileTool() }],
});

try {
  await harness.sendUserMessage('read note.txt');
} catch (error) {
  if (error instanceof ApprovalRequiredError) {
    const result = await harness.sendApproval(
      error.pendingApproval.requiredToolCallIds.map((toolCallId) => ({
        toolCallId,
        type: 'approve',
      })),
    );

    console.log(result);
  }
}
```

If the app restarts while approval is pending, call `resumePendingApprovalIfNeeded()` after `ready()` to resume from persisted session state.

## Streaming

Apps that want incremental text output should consume `TurnChunk`s.

```ts
const harness = createHarness({
  provider: { name: 'fake' },
  stream: true,
});

for await (const chunk of harness.streamUserMessage('hello')) {
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
- `approval_requested`
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

The event stream includes turn lifecycle, provider calls, tool execution, and approval state. See `harness/src/events/types.ts` for the full event union.

`createHarness()` also accepts `loggers`, which receive runtime traces. This is how the CLI writes structured and text logs for each session.

## Integration Boundaries

Keep the boundary between app code and `harness` sharp:

- app code should own UI, input collection, and approval presentation
- app code should choose provider config, session storage, and tool registration
- `harness` should own the turn loop, pause/resume semantics, tool execution, and session updates
- provider-specific codecs should stay in `harness/src/providers/codecs/`

In practice, `apps/cli/src/index.ts` is the best reference integration in this repo.
