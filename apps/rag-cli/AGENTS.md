# AGENTS.md

## Purpose

`apps/rag-cli` is the thin retrieval-backed CLI app over `harness`.

It should stay focused on:

- composing the shared CLI loop with retrieval and memory plugins
- selecting the app-specific system prompt
- presenting retrieval and memory status to the user

It should not own retrieval runtime internals or generic harness behavior.

## Architecture

- Keep this app thin.
- Reuse `apps/helpers/cli/` for provider, session, logging, memory, and retrieval wiring.
- Retrieval and memory behavior should stay plugin-based.
- Keep tools disabled here unless the product direction changes intentionally.
- App-specific behavior belongs in prompt selection, plugin composition, and CLI presentation.
- If retrieval or memory logic starts becoming reusable beyond this app, move it into `harness/plugins/` or shared app helpers instead of growing `apps/rag-cli`.

## Main Files

- `src/index.ts`: app entrypoint and plugin composition
- `src/system-prompt.ts`: app-specific system prompt
- `../../helpers/cli/interactive.ts`: shared readline loop
- `../../helpers/cli/memory.ts`: shared local memory plugin wiring
- `../../helpers/cli/rag.ts`: shared markdown RAG plugin wiring
- `data/`: sample markdown corpus for local retrieval runs

## Commands

- `pnpm rag-cli -- --provider openai`
- `pnpm rag-cli -- --provider fake --memory --session-id memory-demo`
- `pnpm test`
- `pnpm lint`
- `pnpm format`

## Notes

- Keep docs up to date when flags, plugin wiring, memory behavior, or data locations change.
- Update `apps/rag-cli/README.md` for user-facing run instructions.
- Update root docs when the app set, repo structure, or harness boundaries change.
- Keep the plugin registration order intentional; prompt-prep ordering affects how recalled memory and retrieval context are injected.
