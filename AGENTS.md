# AGENTS.md

## Purpose

Mersey is a local coding agent prototype.

Main goals:

- keep `harness` reusable
- keep apps thin
- keep provider integration swappable

## Structure

- `harness/`
  - shared runtime
- `harness/src/harness.ts`
  - main app-facing entry point through `createHarness()`
- `harness/src/loop/`
  - provider-agnostic turn loop and tool iteration logic
- `harness/src/turn-stream.ts`
  - session-aware streaming wrapper around a turn
- `harness/src/models/`
  - provider-agnostic model contracts
- `harness/src/providers/`
  - provider implementations and factory
- `harness/src/providers/codecs/`
  - provider-specific request/response translation
- `harness/src/tools/runtime/`
  - workspace-safe file, command, cancellation, and output services
- `harness/src/sessions/`
  - session types and storage implementations
- `harness/src/events/`
  - event emitter/reporter and safe telemetry
- `harness/plugins/logging/`
  - built-in JSONL/text event logging plugins
- `apps/helpers/cli/`
  - shared app-side wiring for provider, session, tool, and logging setup
- `apps/cli/`
  - thin terminal app over `harness`
- `apps/ftv/`
  - thin Ink TUI app over `harness`

## Architecture

- Always think about architecture and refactoring before adding new code.
- Before adding a new helper or tool-specific logic, check nearby code for reusable pieces and extract the smallest shared abstraction that improves the shape of the system.
- Prefer improving the shape of the system first if that avoids piling messy code on top.
- CLI owns the user interaction loop.
- `harness` owns the model turn loop, tool execution, session updates, and event emission.
- The `harness` client contract is the most important interface in the repo and should stay as simple as possible for apps to connect to.
- `harness/src/harness.ts` is the contract surface apps should build against first.
- `harness/src/loop/loop.ts` should depend on `ModelProvider`, not SDK-specific request or response types.
- `harness/src/turn-stream.ts` should stay responsible for session locking, turn execution, and persisting turn results.
- Provider-specific request/response mapping belongs in `harness/src/providers/` and `harness/src/providers/codecs/`.
- Tool-specific workspace, command, and output policy belongs in `harness/src/tools/runtime/`, not in apps.
- Apps should decide which tools are registered, but the runtime behavior should stay inside `harness`.
- Session persistence details belong in `harness/src/sessions/` so apps can swap storage without changing loop behavior.
- Event shape and safe telemetry belong in `harness/src/events/` so apps can observe runtime behavior without coupling to implementation details.
- Logging is plugin-based and app-injected; core harness stays event-only.
- Tool registration and behavior are unchanged in the logging refactor phase.

## Providers

- Provider selection is string-based through `harness/src/providers/factory.ts`.
- Public providers wired through the factory today: `anthropic`, `minimax`, `openai`, `fake`.

## Commands

- `pnpm build`
- `pnpm test`
- `pnpm lint`
- `pnpm format`
- `pnpm cli -- --provider anthropic`
- `pnpm cli -- --provider minimax`
- `pnpm cli -- --provider openai`
- `pnpm cli -- --provider fake`

## Notes

- Use `oxfmt` and `oxlint`.
- Run `pnpm format` after code changes.
- Keep tests small and important.
- Add or update tests with behavior changes.
- Prefer `FakeProvider` for non-network tests.
- Do not use `git` or `gh` without explicit user permission.
- Every change should keep all documentation files (AGENTS.md, README.md, etc.) in sync; verify docs reflect the current state after any refactoring.
