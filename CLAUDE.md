# Claude Code guide

@AGENTS.md

## Codex delegation

Use Codex for scoped implementation tasks through `scripts/codex-run`; see [docs/agents/codex.md](docs/agents/codex.md) for the full workflow and verification checklist.

Prerequisites:

```sh
PATH="$HOME/.local/bin:$PATH" scripts/codex-run NAME BRIEF [--resume|--fork SESSION] \
  --config 'model_reasoning_effort="medium|high"'
```

Do not use fast mode. Launch with Bash `run_in_background`; in the same turn arm a Monitor on `scripts/codex-watch NAME 20 45`. Codex leaves changes uncommitted because its sandbox keeps `.git` read-only. Review and commit through the orchestrator.
