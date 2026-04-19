# AGENTS.md

## Purpose

`apps/cli` is the thin readline terminal app over `harness`.

It should stay focused on:

- argument parsing and app startup
- wiring provider, session, tools, and logging through shared helpers
- terminal interaction and presentation

It should not grow harness-owned behavior.

## Architecture

- Keep this app thin.
- Reuse `apps/helpers/cli/` for shared app-side wiring before adding app-local setup code.
- `harness` owns turn orchestration, hooks, events, tool execution, and session persistence.
- Do not move provider-specific request shaping, session logic, or tool runtime policy into `apps/cli`.
- Built-in tool wiring should continue to come from `createDefaultTools()` unless there is a clear app-specific reason to diverge.
- Keep the interactive loop in app code and the runtime behavior in `harness`.

## Main Files

- `src/index.ts`: app entrypoint and top-level wiring
- `../../helpers/cli/args.ts`: shared CLI argument parsing
- `../../helpers/cli/harness-config.ts`: shared tool and model wiring
- `../../helpers/cli/interactive.ts`: shared readline loop
- `../../helpers/cli/logging.ts`: shared logging plugin setup
- `../../helpers/cli/provider-config.ts`: provider configuration
- `../../helpers/cli/session-store.ts`: session store wiring

## Commands

- `pnpm cli -- --provider fake`
- `pnpm cli -- --provider openai`
- `pnpm test`
- `pnpm lint`
- `pnpm format`

## Notes

- Keep docs up to date when flags, startup behavior, or app responsibilities change.
- Update `apps/cli/README.md` for user-facing run instructions.
- Update root docs as needed when app boundaries or repo structure change.
- Prefer small app changes and push reusable logic into `harness` or `apps/helpers/cli/` when it improves multiple apps.
