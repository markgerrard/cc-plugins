---
description: Fan out a code review to multiple models in parallel (diff or full repo)
argument-hint: '[--full] [--models codex,gemini,glm] [--base <ref>] [--scope auto|working-tree|branch] [focus]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Send the current git diff (default) or the full repo (`--full`) to multiple models for parallel code review. Returns all reviews side-by-side plus a consensus synthesis.

- `--full` — each model traverses the repo itself (slower, deeper)
- Default — sends the git diff only (faster, focused on changes)

Default models: codex, gemini, glm. Override with `--models`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/compare-companion.mjs" review $ARGUMENTS
```
