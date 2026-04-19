# Mersey

Mersey is a reusable harness for building local LLM applications with pluggable tools, hooks, events, sessions, and providers.

The repo is organized around a reusable `harness` package and thin apps that sit on top of it. The current apps are `apps/cli` for the readline terminal flow and `apps/ftv` for the Ink-based TUI prototype.

## Goals

- keep `harness` reusable
- keep apps thin
- keep provider integration swappable

## Repository Layout

- `harness/`: reusable runtime for model turns, sessions, tools, and events
- `harness/index.ts`: public package entry point for apps consuming `harness`
- `harness/runtime/harness.ts`: implementation behind `createHarness()`
- `harness/runtime/core/`: provider-agnostic turn loop and streaming turn wrapper
- `harness/runtime/models/`: provider contracts and shared request/response types
- `harness/providers/`: provider implementations, codecs, factory, and provider-facing types
- `harness/tools/`: built-in tools and tool-owned services
- `harness/runtime/sessions/`: core session contracts and runtime-facing session interfaces
- `harness/sessions/`: built-in `Session`, `MemorySessionStore`, and `FilesystemSessionStore`
- `harness/runtime/events/`: event emitter/reporter and safe telemetry
- `harness/plugins/logging/`: built-in JSONL and text logging plugins
- `harness/plugins/memory/`: backend-agnostic memory recall/remember plugin helpers
- `harness/plugins/retrieval/`: backend-agnostic request-prep retrieval contract and helpers
- `harness/plugins/retrieval/lancedb/`: built-in LanceDB retrieval backend and index helpers
- `apps/helpers/cli/`: shared app-side wiring for provider, session, tool, and logging setup
- `apps/cli/`: thin terminal app over `harness`
- `apps/rag-cli/`: thin RAG-backed CLI over `harness`
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
pnpm rag-cli -- --provider openai
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

When `--debug` is enabled, event logs also include the final provider request payload for each `provider_requested` event, including debug-only request messages and system prompt after request-prep hooks run.

RAG flags for `apps/rag-cli`:

- `--rag`
- `--rag-dir <path>`
- `--rag-index-dir <path>`
- `--rebuild-rag`
- `--rag-top-k <n>`
- `--rag-max-context-chars <n>`
- `--memory`
- `--memory-file <path>`
- `--memory-top-k <n>`
- `--memory-max-context-chars <n>`

Examples:

```bash
pnpm cli -- --provider fake --stream
pnpm rag-cli -- --stream
pnpm rag-cli -- --provider openai --rebuild-rag
pnpm rag-cli -- --provider fake --memory --session-id memory-demo
pnpm cli -- --provider openai --session-store filesystem --sessions-dir tmp/sessions
pnpm cli -- --provider openai --cache
pnpm ftv -- --provider openai --session-store filesystem --sessions-dir tmp/sessions
```

`apps/cli` and `apps/ftv` both register a small set of tools from `harness/tools/index.ts` for file and command access, with app-side setup shared through `apps/helpers/cli/`.

`apps/rag-cli` reads markdown data from `./apps/rag-cli/data` by default when RAG is enabled.

RAG indexes are reused across restarts by default. Pass `--rebuild-rag` to rebuild the LanceDB index from the current markdown files.

`apps/rag-cli` uses the same interactive shell but disables tools and turns on RAG by default unless `--rag=false` is passed.

For local memory testing, `apps/rag-cli` can also register an opt-in file-backed memory plugin with `--memory`. It stores remembered turns in newline-delimited JSON under `tmp/memory/rag-cli.jsonl` by default so you can test recall across sessions without adding a real external memory backend.

## Architecture Summary

- Apps own interaction and presentation.
- `harness` owns turn orchestration, tool execution, session state, and event emission.
- `harness/index.ts` exports `createHarness` and shared runtime types.
- Built-in plugins, sessions, and tools stay namespaced under `harness/plugins/`, `harness/sessions/`, and `harness/tools/`.
- Apps must inject both `providerInstance` and `session` into `createHarness()`.
- Logging is plugin-based: apps inject logging plugins through `createHarness({ plugins, providerInstance, session })`.
- Memory is also plugin-based: memory plugins can recall external memory ephemerally before the first provider call in a turn, then remember useful turn data after commit.
- Retrieval is also plugin-based: request-prep plugins can inject ephemeral RAG context without persisting it into session messages.
- Shared app-side provider, session, tool, and logging plugin wiring lives under `apps/helpers/cli/` so apps do not depend on each other.
- The turn loop depends on `ModelProvider`, not SDK-specific request or response types.
- Provider-specific translation belongs in `harness/providers/` and `harness/providers/codecs/`.
- Tool services (files, commands, output) are constructed by each built-in tool, enforce workspace and output policies directly, and are exposed through the public tool types.
- Core depends on `HarnessSession` and `SessionStore` abstractions only.
- `SessionStore` owns atomic turn persistence and per-session exclusivity.
- Built-in session implementations ship under `harness/sessions/` and remain swappable.

## Using Harness

See `docs/harness.md` for the main integration guide, including:

- creating a harness
- configuring providers and sessions
- registering tools
- consuming streaming turn chunks
- subscribing to events
- wiring request-prep plugins such as the built-in LanceDB retrieval backend

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
