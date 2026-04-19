# RAG CLI App

`apps/rag-cli` is the retrieval-backed CLI variant built on top of `harness`.

## Run

```bash
pnpm rag-cli -- --provider anthropic
pnpm rag-cli -- --provider openai
pnpm rag-cli -- --provider fake --memory --session-id memory-demo
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
- `--stream`
- `--cache`
- `--debug`
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
pnpm rag-cli -- --stream
pnpm rag-cli -- --provider openai --rebuild-rag
pnpm rag-cli -- --provider fake --memory --session-id memory-demo
```

`apps/rag-cli` reads markdown data from `./apps/rag-cli/data` by default when RAG is enabled.

RAG indexes are reused across restarts by default. Pass `--rebuild-rag` to rebuild the LanceDB index from the current markdown files.

`apps/rag-cli` uses the same interactive shell but disables tools and turns on RAG by default unless `--rag=false` is passed.

For local memory testing, `--memory` enables a file-backed memory plugin that stores remembered turns in newline-delimited JSON under `tmp/memory/rag-cli.jsonl` by default.

When `--debug` is enabled, `provider_requested` events include the final provider request payload after request-prep hooks run.
