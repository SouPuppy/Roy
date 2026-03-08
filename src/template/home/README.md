# HOME Directory

## Table of Contents

- [`.env`](#env)
- [`.config.toml`](#configtoml)
- [`HARDCODE`](#hardcode)
- [`memory/`](#memory)
- [`.vault/`](#vault)
- [`.toolbox/`](#toolbox)

---

### `.env`

This is the environment variables file for Roy. It contains the following variables:

- `LOG_LEVEL`: the log level

---

### `config.toml`

This is the global configuration for Roy. It contains the following sections:

- `identity`: identity/profile-related memory

---

### `HARDCODE`

Metadata overrides (prompted at first wakeup). TOML format, no file extension:

```toml
__NAME__ = "Roy"
__SERIAL_SUFFIX__ = "00000"
```

### `memory/`

Memory storage directory:

- `memory.db`: database with `memory_records`, `skills`, `tools`
- `cache/`: session ask logs as `YYYY-MM-DD.md` (append-only, not in db)

---

### `vault/`

This is the vault directory for Roy. It contains:

- `providers/`: LLM providers credentials

---

### `toolbox/`

External tools for Roy.

---
