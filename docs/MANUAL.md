# Roy Manual

## Quick Start

```bash
pnpm install
pnpm roy wakeup
pnpm roy status
```

## Common Commands

### System and Status

```bash
pnpm roy help
pnpm roy version
pnpm roy status
pnpm roy wakeup
pnpm roy start
```

`status` returns:
- LLM provider connection status
- Embedding model status (`not_loaded` / `cached` / `loading` / `ready`)
- RAG storage status (db path, ANN index availability, corpus size)

## Memory Operations

### Store Memory

```bash
pnpm roy remember "Find freedom"
pnpm roy remember "I prefer dark mode" --kind auto
pnpm roy remember "Finish report by Friday" --kind task
pnpm roy remember "Reference: ANN benchmark notes" --classify reference
```

`remember` default kind is `auto`.

### Recall Memory (Human-readable Output)

```bash
pnpm roy recall "freedom"
```

Show score breakdown for debugging (without embedding vectors):

```bash
pnpm roy recall "freedom" --debug
```

Recall modes:

```bash
pnpm roy recall "freedom" --accurate
pnpm roy recall "freedom" --reelated
```

- Default mode is `--accurate`
- `--accurate`: stricter threshold, fewer/higher-confidence results
- `--reelated`: lower threshold, broader recall set

### Delete Memory (Force Required)

Deletion is blocked by default. You must pass `--force`:

```bash
pnpm roy forget <memory_id> --force
```

Typo-compatible alias is also supported:

```bash
pnpm roy forget <memory_id> --forece
```

## Memory Explorer

### Interactive Mode (Scroll/Search/Open/Delete/Filter)

```bash
pnpm roy memory
```

Supported actions:
- Scroll: use arrow keys
- Search: keyword search
- Open: view full memory details
- Delete: delete from menu with `[y/N]` confirmation
- Filter: filter by scope/kind

### Non-interactive Mode (`--plain`)

```bash
pnpm roy memory --plain --limit 20
pnpm roy memory --plain --query "sqlite" --scope global --kind knowledge
```

Available options:
- `--query <text>`
- `--scope session|project|global`
- `--kind auto|identity|task|knowledge|reference|note|unclassified`
- `--limit <n>`
- `--offset <n>`

## Ask via Default Provider

```bash
pnpm roy ask --question "Who am I"
```

This automatically:
- Uses the default provider from `.home/config.toml`
- Builds RAG context
- Writes the Q&A back into conversation memory

## Recommended End-to-end Flow

```bash
pnpm roy wakeup
pnpm roy remember "I prefer TypeScript"
pnpm roy recall "what do I prefer"
pnpm roy ask --question "What language do I prefer?"
pnpm roy memory
```