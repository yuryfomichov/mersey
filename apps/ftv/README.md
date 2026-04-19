# FTV App

`apps/ftv` is the Ink-based TUI app built on top of `harness`.

## Run

```bash
pnpm ftv -- --provider openai
```

The script uses Node's `--env-file=.env` support, so a local `.env` file is enough for provider-backed runs.

Provider setup:

- `fake`: no environment variables required
- `minimax`: requires `MINIMAX_API_KEY`
- `openai`: requires `OPENAI_API_KEY`

## Useful Flags

- `--provider <fake|minimax|openai>`
- `--session-id <id>`
- `--session-store <memory|filesystem>`
- `--sessions-dir <path>`
- `--cache`
- `--debug`

Example:

```bash
pnpm ftv -- --provider openai --session-store filesystem --sessions-dir tmp/sessions
```

`apps/ftv` registers a small set of built-in file and command tools from `harness/tools/index.ts`. Shared app-side wiring lives under `apps/helpers/cli/`.

When `--debug` is enabled, `provider_requested` events include the final provider request payload after request-prep hooks run.
