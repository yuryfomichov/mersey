# AGENTS.md

## Purpose

`apps/ftv` is the thin Ink-based TUI app over `harness`.

It should stay focused on:

- terminal UI rendering and input handling
- controller state for the TUI flow
- app-side wiring for provider, session, tools, logging, and tool approval

It should not take over harness-owned runtime behavior.

## Architecture

- Keep this app thin.
- UI components belong under `src/ui/` and should stay presentation-focused.
- TUI coordination belongs in `src/app/controller/` and `src/app/services/`.
- `createHarnessRuntime()` is the app-side composition point; keep provider, session, tool, and plugin wiring there.
- The tool approval flow is app-specific UI behavior layered on top of harness hooks. Keep approval UI here, but keep generic hook mechanics in `harness` when they become reusable.
- Reuse `apps/helpers/cli/` for shared provider, session, logging, and tool configuration.
- Do not move provider-specific logic, session persistence rules, or tool runtime policy into the TUI layer.

## Main Files

- `src/index.tsx`: app entrypoint
- `src/app/ftv-app.tsx`: top-level Ink layout
- `src/app/controller/use-ftv-controller.ts`: TUI state and actions
- `src/app/services/harness-runtime.ts`: harness composition and subscription setup
- `src/tool-approval-plugin.ts`: app-specific tool approval hook wrapper
- `src/ui/`: terminal presentation components

## Commands

- `pnpm ftv -- --provider openai`
- `pnpm ftv -- --provider openai --session-store filesystem --sessions-dir tmp/sessions`
- `pnpm test`
- `pnpm lint`
- `pnpm format`

## Notes

- Keep docs up to date when flags, UI flows, approval behavior, or startup wiring change.
- Update `apps/ftv/README.md` for user-facing run instructions.
- Update root docs when app boundaries or repo structure change.
- Preserve the separation between presentation, controller logic, and harness wiring.
