---
description: Compare X reception of two topics or framings
argument-hint: '[--background] [--model <model>] <topic A> vs <topic B>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Search X for both topics and produce a comparative analysis — sentiment, volume, themes, and a recommendation on which framing is landing better.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" compare $ARGUMENTS
```
