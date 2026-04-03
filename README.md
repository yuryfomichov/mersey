# Mersey

Mersey is a local coding agent prototype.

The repo is organized around a reusable `harness` package and thin apps that sit on top of it. Today the main app is `apps/cli`, which wires terminal input and approval prompts into the shared runtime.

## Goals

- keep `harness` reusable
- keep apps thin
- keep provider integration swappable

## Repository Layout

- `harness/`: reusable runtime for model turns, sessions, tools, approvals, and events
- `harness/index.ts`: public package entry point for apps consuming `harness`
- `harness/src/harness.ts`: implementation behind `createHarness()`
- `harness/src/loop/`: provider-agnostic turn loop and approval resume flow
- `harness/src/turn-stream.ts`: stream-oriented wrapper around a session turn
- `harness/src/models/`: provider contracts and shared request/response types
- `harness/src/providers/`: provider implementations, codecs, and factory
- `harness/src/tools/`: built-in tools and runtime services
- `harness/src/sessions/`: session state and storage implementations
- `harness/src/events/`: event publishing and safe telemetry
- `apps/cli/`: thin terminal app over `harness`
- `docs/`: additional project documentation

## Quick Start

1. Install dependencies.

```bash
pnpm install
```

2. Build the project.

```bash
pnpm build
```

3. Start the CLI with a provider.

```bash
pnpm cli -- --provider fake
pnpm cli -- --provider minimax
pnpm cli -- --provider openai
```

## Provider Setup

- `fake`: no environment variables required
- `minimax`: requires `MINIMAX_API_KEY`
- `openai`: requires `OPENAI_API_KEY`

The CLI reads environment variables through Node's `--env-file=.env` support in the `pnpm cli` script, so a local `.env` file is enough for provider-backed runs.

## CLI Notes

Useful flags:

- `--provider <fake|minimax|openai>`
- `--session-id <id>`
- `--session-store <memory|filesystem>`
- `--sessions-dir <path>` when using filesystem sessions
- `--stream`
- `--debug`

Examples:

```bash
pnpm cli -- --provider fake --stream
pnpm cli -- --provider openai --session-store filesystem --sessions-dir tmp/sessions
```

The CLI registers a small set of tools from `harness` and asks the user to approve each tool call before execution.

## Architecture Summary

- Apps own interaction and presentation.
- `harness` owns turn orchestration, approval pauses/resumes, tool execution, session state, and event emission.
- The turn loop depends on `ModelProvider`, not SDK-specific request or response types.
- Provider-specific translation belongs in `harness/src/providers/` and `harness/src/providers/codecs/`.
- Tool execution is routed through `harness/src/tools/runtime/`, which applies workspace and output policies.
- Session stores are replaceable. The repo currently ships in-memory and filesystem-backed stores.

## Using Harness

See `docs/harness.md` for the main integration guide, including:

- creating a harness
- configuring providers and sessions
- registering tools and approvals
- consuming streaming turn chunks
- subscribing to events

## Development

Common commands:

```bash
pnpm build
pnpm test
pnpm lint
pnpm format
```

Guidelines:

- keep tests small and focused
- prefer `FakeProvider` for non-network tests
- run `pnpm format` after code changes
- preserve the boundary that keeps app code thin and `harness` reusable
