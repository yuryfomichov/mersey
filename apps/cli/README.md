# CLI App

`apps/cli` is the readline-based terminal app built on top of `harness`.

## Run

```bash
pnpm cli -- --provider anthropic
pnpm cli -- --provider fake
pnpm cli -- --provider minimax
pnpm cli -- --provider openai
```

The script uses Node's `--env-file=.env` support, so a local `.env` file is enough for provider-backed runs.

Provider setup:

- `anthropic`: requires `ANTHROPIC_API_KEY`
- `fake`: no environment variables required
- `minimax`: requires `MINIMAX_API_KEY`
- `openai`: requires `OPENAI_API_KEY`

## Useful Flags

- `--provider <anthropic|fake|minimax|openai>`
- `--session-id <id>`
- `--session-store <memory|filesystem>`
- `--sessions-dir <path>`
- `--cache`
- `--stream`
- `--debug`

Examples:

```bash
pnpm cli -- --provider fake --stream
pnpm cli -- --provider openai --session-store filesystem --sessions-dir tmp/sessions
pnpm cli -- --provider openai --cache
```

When `--debug` is enabled, `provider_requested` events include the final provider request payload after request-prep hooks run.

`apps/cli` registers a small set of built-in file and command tools from `harness/tools/index.ts`. Shared app-side wiring lives under `apps/helpers/cli/`.
