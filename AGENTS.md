# AGENTS.md

## Purpose

Mersey is a reusable harness for building local LLM applications with pluggable tools, hooks, events, sessions, and providers.

Main goals:

- keep `harness` reusable
- keep apps thin
- keep provider integration swappable

## Structure

- `harness/`
  - shared runtime
- `harness/runtime/harness.ts`
  - main app-facing entry point through `createHarness()`
- `harness/runtime/core/`
  - provider-agnostic turn loop and session-aware streaming wrapper around a turn
- `harness/runtime/models/`
  - provider-agnostic model contracts
- `harness/providers/`
  - provider implementations, factory, and provider-facing types
- `harness/providers/codecs/`
  - provider-specific request/response translation
- `harness/runtime/tools/runtime/`
  - workspace-safe file, command, cancellation, and output services
- `harness/runtime/sessions/`
  - core session contracts and runtime-facing session interface
- `harness/sessions/`
  - built-in `Session`, `MemorySessionStore`, and `FilesystemSessionStore`
- `harness/runtime/events/`
  - event emitter/reporter and safe telemetry
- `harness/plugins/logging/`
  - built-in JSONL/text event logging plugins
- `harness/plugins/retrieval/`
  - backend-agnostic request-prep retrieval contract and helpers
- `harness/plugins/retrieval/lancedb/`
  - built-in LanceDB retrieval backend and index helpers
- `apps/helpers/cli/`
  - shared app-side wiring for provider, session, tool, and logging setup
- `apps/cli/`
  - thin terminal app over `harness`
- `apps/rag-cli/`
  - thin RAG-backed terminal app over `harness`
- `apps/ftv/`
  - thin Ink TUI app over `harness`

## Architecture

- Always think about architecture and refactoring before adding new code.
- Before adding a new helper or tool-specific logic, check nearby code for reusable pieces and extract the smallest shared abstraction that improves the shape of the system.
- Prefer improving the shape of the system first if that avoids piling messy code on top.
- CLI owns the user interaction loop.
- `harness` owns the model turn loop, tool execution, session updates, and event emission.
- The `harness` client contract is the most important interface in the repo and should stay as simple as possible for apps to connect to.
- `harness/runtime/harness.ts` is the contract surface apps should build against first.
- The turn-loop code in `harness/runtime/core/` should depend on `ModelProvider`, not SDK-specific request or response types.
- The turn-streaming code in `harness/runtime/core/` should stay responsible for session locking, turn execution, and persisting turn results.
- Provider-specific request/response mapping belongs in `harness/providers/` and `harness/providers/codecs/`.
- Tool-specific workspace, command, and output policy belongs in `harness/runtime/tools/runtime/`, not in apps.
- Apps should decide which tools are registered, but the runtime behavior should stay inside `harness`.
- `createHarness()` should receive provider and session instances from app-side wiring; core should not construct built-in sessions internally.
- Core session contracts belong in `harness/runtime/sessions/`; built-in session implementations belong in `harness/sessions/` so apps can swap them without changing loop behavior.
- Event shape and safe telemetry belong in `harness/runtime/events/` so apps can observe runtime behavior without coupling to implementation details.
- Logging is plugin-based and app-injected; core harness stays event-only.
- Retrieval context injection should happen through request-prep plugins around provider request creation, not inside providers or apps.
- Tool registration and behavior are unchanged in the logging refactor phase.

## Providers

- Provider selection is string-based through `harness/providers/factory.ts`.
- Public providers wired through the factory today: `anthropic`, `minimax`, `openai`, `fake`.

## Commands

- `pnpm build`
- `pnpm test`
- `pnpm lint`
- `pnpm format`
- `pnpm cli -- --provider anthropic`
- `pnpm cli -- --provider minimax`
- `pnpm cli -- --provider openai`
- `pnpm rag-cli -- --provider openai`
- `pnpm cli -- --provider fake`

## Notes

- Use `oxfmt` and `oxlint`.
- Run `pnpm format` after code changes.
- Keep tests small and important.
- Add or update tests with behavior changes.
- Prefer `FakeProvider` for non-network tests.
- Do not use `git` or `gh` without explicit user permission.
- Every change should keep all documentation files (AGENTS.md, README.md, etc.) in sync; verify docs reflect the current state after any refactoring.
- Use conventional commits
- When writing PR summaries, do not add a `Testing` section.
