# Mersey

Mersey is a reusable harness for building local LLM applications with pluggable tools, hooks, events, sessions, and providers.

The repo is organized around a reusable `harness` package and thin apps that sit on top of it.

## Goals

- keep `harness` reusable
- keep apps thin
- keep provider integration swappable

## Repository Layout

- `harness/`: reusable runtime for model turns, sessions, tools, and events
- `harness/index.ts`: public package entry point for apps consuming `harness`
- `harness/runtime/harness.ts`: runtime assembly and `createHarnessRuntime()` implementation
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

## Apps

- `apps/cli`: readline terminal app. See `apps/cli/README.md`.
- `apps/rag-cli`: retrieval-backed CLI variant. See `apps/rag-cli/README.md`.
- `apps/ftv`: Ink TUI app. See `apps/ftv/README.md`.

## Architecture Summary

- Apps own interaction and presentation.
- `harness` owns turn orchestration, tool execution, session state, and event emission.
- `harness/index.ts` exports `createHarnessRuntime`, low-level `createHarness`, and shared runtime types.
- Built-in plugins, sessions, and tools stay namespaced under `harness/plugins/`, `harness/sessions/`, and `harness/tools/`.
- Apps compose providers, sessions, tool catalogs, collectors, commit observers, and plugins through `createHarnessRuntime()`.
- Logging remains event-driven and plugin-based.
- Memory and retrieval use runtime-owned collectors and commit observers instead of request-mutation hooks.
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
- registering collectors and commit observers
- consuming streaming turn chunks
- subscribing to events
- wiring retrieval and memory integrations through collectors and observers

## Getting Started

```bash
pnpm install
pnpm build
```

For runnable app commands and flags, use the app-specific READMEs under `apps/`.

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
