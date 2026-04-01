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
- `harness/src/loop.ts`
  - single model turn loop
- `harness/src/models/`
  - provider-agnostic model contracts
- `harness/src/providers/`
  - provider implementations and factory
- `harness/src/sessions/`
  - session types and storage implementations
- `apps/cli/`
  - thin terminal app over `harness`

## Architecture

- Always think about architecture and refactoring before adding new code.
- Before adding a new helper or tool-specific logic, check nearby code for reusable pieces and extract the smallest shared abstraction that improves the shape of the system.
- Prefer improving the shape of the system first if that avoids piling messy code on top.
- CLI owns the user interaction loop.
- `harness` owns the model turn loop.
- The `harness` client contract is the most important interface in the repo and should stay as simple as possible for apps to connect to.
- `harness/src/loop.ts` should depend on `ModelProvider`, not SDK-specific request or response types.
- Provider-specific request/response mapping belongs in `harness/src/providers/`.

## Providers

- Provider selection is string-based through `harness/src/providers/factory.ts`.
- Supported now: `minimax`, `openai`, `fake`.

## Commands

- `pnpm build`
- `pnpm test`
- `pnpm lint`
- `pnpm format`
- `pnpm cli -- --provider minimax`
- `pnpm cli -- --provider openai`
- `pnpm cli -- --provider fake`

## Notes

- Use `oxfmt` and `oxlint`.
- Keep tests small and important.
- Add or update tests with behavior changes.
- Prefer `FakeProvider` for non-network tests.
- Do not use `git` or `gh` without explicit user permission.
