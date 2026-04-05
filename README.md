# Mersey

Mersey is a local coding agent prototype.

The repo is organized around a reusable `harness` package and thin apps that sit on top of it. The current apps are `apps/cli` for the readline terminal flow and `apps/ftv` for the Ink-based TUI prototype.

## Goals

- keep `harness` reusable
- keep apps thin
- keep provider integration swappable

## Repository Layout

- `harness/`: reusable runtime for model turns, sessions, tools, and events
- `harness/index.ts`: public package entry point for apps consuming `harness`
- `harness/src/harness.ts`: implementation behind `createHarness()`
- `harness/src/loop/`: provider-agnostic turn loop and tool iteration flow
- `harness/src/turn-stream.ts`: stream-oriented wrapper around a session turn
- `harness/src/models/`: provider contracts and shared request/response types
- `harness/src/providers/`: provider implementations, codecs, and factory
- `harness/src/tools/`: built-in tools and runtime services
- `harness/src/sessions/`: session state and storage implementations
- `harness/src/events/`: event emitter/reporter and safe telemetry
- `harness/plugins/logging/`: built-in JSONL and text logging plugins
- `apps/helpers/cli/`: shared app-side wiring for provider, session, tool, and logging setup
- `apps/cli/`: thin terminal app over `harness`
- `apps/ftv/`: thin Ink TUI app over `harness`
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
pnpm ftv -- --provider openai
```

## Provider Setup

- `fake`: no environment variables required
- `minimax`: requires `MINIMAX_API_KEY`
- `openai`: requires `OPENAI_API_KEY`

The CLI reads environment variables through Node's `--env-file=.env` support in the `pnpm cli` script, so a local `.env` file is enough for provider-backed runs.

## App Notes

Useful flags:

- `--provider <fake|minimax|openai>`
- `--session-id <id>`
- `--session-store <memory|filesystem>`
- `--sessions-dir <path>` when using filesystem sessions
- `--cache` enables provider prompt caching where supported
- `--stream`
- `--debug`

Examples:

```bash
pnpm cli -- --provider fake --stream
pnpm cli -- --provider openai --session-store filesystem --sessions-dir tmp/sessions
pnpm cli -- --provider openai --cache
pnpm ftv -- --provider openai --session-store filesystem --sessions-dir tmp/sessions
```

`apps/cli` and `apps/ftv` both register a small set of tools from `harness` for file and command access, with app-side setup shared through `apps/helpers/cli/`.

## Architecture Summary

- Apps own interaction and presentation.
- `harness` owns turn orchestration, tool execution, session state, and event emission.
- Logging is plugin-based: apps inject logging plugins through `createHarness({ plugins })`.
- Shared app-side provider, session, tool, and logging plugin wiring lives under `apps/helpers/cli/` so apps do not depend on each other.
- The turn loop depends on `ModelProvider`, not SDK-specific request or response types.
- Provider-specific translation belongs in `harness/src/providers/` and `harness/src/providers/codecs/`.
- Tool execution is routed through `harness/src/tools/runtime/`, which applies workspace and output policies.
- Session stores are replaceable. The repo currently ships in-memory and filesystem-backed stores.

## Using Harness

See `docs/harness.md` for the main integration guide, including:

- creating a harness
- configuring providers and sessions
- registering tools
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
